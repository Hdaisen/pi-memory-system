#!/usr/bin/env python3
"""
记忆提取管线 — Python 端

由 memory.ts 的 agent_end 在子进程中调用。
功能：
1. 从 stdin 读取本轮消息 JSON
2. 格式化 → turns/raw.md（过滤 system + read）
3. 启动子代理 Pi 进程 → essence.md + notebook + remember

用法（由 memory.ts 调用）:
    python3 run_extraction.py < turns/raw/messages.json

环境变量:
    PI_SUBAGENT=1 — 子进程会继承，防止递归
"""

import json
import os
import re
import subprocess
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path

# ============================================================
# 常量 — 和 memory.ts 的 PATHS 保持同步
# ============================================================

HOME = Path.home()
AGENT_DIR = HOME / ".pi" / "agent"
SCRIPTS_DIR = AGENT_DIR / "scripts"
PROJECTS_DIR = AGENT_DIR / "memory" / "projects"
AGENTS_DIR = AGENT_DIR / "agents"
SUBAGENT_MODEL_FILE = AGENT_DIR / "memory" / "subagent-model.txt"


# ============================================================
# raw.md 格式化（复用 write_raw.py 的逻辑）
# ============================================================

LARGE_OUTPUT_THRESHOLD = 5120
REDACTED_KEYS = {"token", "apiKey", "key", "password", "secret", "authorization"}


def ensure_dir(p: Path):
    p.mkdir(parents=True, exist_ok=True)


def redact_args(args: dict) -> dict:
    if not isinstance(args, dict):
        return args
    result = {}
    for k, v in args.items():
        if k.lower() in REDACTED_KEYS:
            result[k] = "***"
        elif isinstance(v, dict):
            result[k] = redact_args(v)
        elif isinstance(v, list):
            result[k] = [redact_args(item) if isinstance(item, dict) else item for item in v]
        else:
            result[k] = v
    return result


def extract_text(content, include_thinking: bool = True) -> str:
    """提取消息的纯文本。

    include_thinking=False 时跳过 thinking 块(对话摘要用——
    工作记忆只保留实际回复文本,thinking 不注入下一轮上下文)。
    """
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for block in content:
            if not isinstance(block, dict):
                texts.append(str(block))
                continue
            bt = block.get("type", "")
            if bt == "text":
                texts.append(block.get("text", ""))
            elif bt == "thinking":
                if include_thinking:
                    texts.append(f"[thinking]\n{block.get('thinking', '')}\n[/thinking]")
            elif bt == "toolCall":
                continue
            elif bt == "image":
                texts.append(f"[image: {block.get('mimeType', 'unknown')}]")
            else:
                texts.append(str(block))
        return "\n".join(texts)
    return str(content)


def extract_tool_calls(content) -> list:
    calls = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "toolCall":
                calls.append(block)
    return calls


def hash_content(text: str) -> str:
    import hashlib
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


def format_content_block(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                bt = block.get("type", "")
                if bt == "text":
                    parts.append(block.get("text", ""))
                elif bt == "thinking":
                    # Strip thinking content — too verbose, not useful for memory
                    parts.append("[thinking block — filtered]")
                elif bt == "toolCall":
                    continue
                elif bt == "image":
                    parts.append(f"[image: {block.get('mimeType', 'unknown')}]")
                else:
                    parts.append(str(block))
            else:
                parts.append(str(block))
        return "\n".join(parts)
    return str(content)


def format_system(msg: dict, raw_dir: Path) -> str:
    text = extract_text(msg.get("content", ""))
    return f"## System\n> [System prompt, {len(text)} bytes - 已过滤]\n\n"


def format_user(msg: dict, raw_dir: Path) -> str:
    text = extract_text(msg.get("content", ""))
    return f"## User\n{text}\n\n"


def format_assistant(msg: dict, raw_dir: Path) -> str:
    content = msg.get("content", [])
    parts = []
    text_content = format_content_block(content)
    if text_content.strip():
        parts.append(f"## Assistant\n{text_content.strip()}")
    for tc in extract_tool_calls(content):
        tool_name = tc.get("name", "unknown")
        tool_args = tc.get("arguments", {})
        if isinstance(tool_args, dict):
            tool_args = redact_args(tool_args)
        parts.append(f"## Tool Call: {tool_name}\n```json\n{json.dumps(tool_args, indent=2, ensure_ascii=False)}\n```")
    return "\n\n".join(parts) + "\n\n" if parts else ""


def format_tool_result(msg: dict, raw_dir: Path) -> str:
    tool_name = msg.get("toolName", "") or msg.get("name", "") or ""
    content = msg.get("content", [])
    is_error = msg.get("isError", False)
    text = extract_text(content)
    error_tag = " ⚠️ ERROR" if is_error else ""

    # read 工具的结果：只留路径和大小
    if tool_name in ("read", "read_file", "file_read"):
        return f"## Tool Result: {tool_name}{error_tag}\n> [read result, {len(text)} bytes - 已截断]\n\n"

    result = f"## Tool Result: {tool_name}{error_tag}\n"
    if len(text) > LARGE_OUTPUT_THRESHOLD or tool_name in ("bash", "grep", "find"):
        lines = text.split("\n")
        total_lines = len(lines)
        head = "\n".join(lines[:50])
        tail = "\n".join(lines[-20:]) if total_lines > 70 else ""
        truncated = total_lines - 70 if total_lines > 70 else 0
        c_hash = hash_content(text)
        full_path = raw_dir / f"{c_hash}.txt"
        full_path.write_text(text, encoding="utf-8")
        result += f"> (截断, full → raw/{c_hash}.txt) 共 {len(text)} bytes\n\n```\n{head}\n"
        if truncated > 0:
            result += f"\n... ({truncated} 行截断) ...\n\n{tail}\n"
        result += "```\n\n"
    else:
        result += f"```\n{text}\n```\n\n"
    return result


def format_bash_execution(msg: dict, raw_dir: Path) -> str:
    command = msg.get("command", "")
    output = msg.get("output", "")
    exit_code = msg.get("exitCode")
    cancelled = msg.get("cancelled", False)
    flags = []
    if cancelled:
        flags.append("cancelled")
    if exit_code is not None and exit_code != 0:
        flags.append(f"exit={exit_code}")
    flag_str = f" ({', '.join(flags)})" if flags else ""

    result = f"## Bash Execution{flag_str}\n\n```bash\n{command}\n```\n\n"
    if output:
        if len(output) > LARGE_OUTPUT_THRESHOLD:
            lines = output.split("\n")
            head = "\n".join(lines[:50])
            tail = "\n".join(lines[-20:]) if len(lines) > 70 else ""
            truncated = len(lines) - 70 if len(lines) > 70 else 0
            c_hash = hash_content(output)
            (raw_dir / f"{c_hash}.txt").write_text(output, encoding="utf-8")
            result += f"> (截断, full → raw/{c_hash}.txt) 共 {len(output)} bytes\n\n```\n{head}\n"
            if truncated > 0:
                result += f"\n... ({truncated} 行截断) ...\n\n{tail}\n"
            result += "```\n\n"
        else:
            result += f"```\n{output}\n```\n\n"
    return result


def format_custom(msg: dict, raw_dir: Path) -> str:
    custom_type = msg.get("customType", "unknown")
    text = extract_text(msg.get("content", ""))
    return f"## Custom: {custom_type}\n{text}\n\n"


def format_branch_summary(msg: dict, raw_dir: Path = None) -> str:
    return f"## Branch Summary\nFrom: {msg.get('fromId', '')}\n\n{msg.get('summary', '')}\n\n"


def format_compaction(msg: dict, raw_dir: Path = None) -> str:
    return f"## Compaction Summary\nTokens before: {msg.get('tokensBefore', 0)}\n\n{msg.get('summary', '')}\n\n"


def format_message(msg: dict, raw_dir: Path) -> str:
    role = msg.get("role", "unknown")
    handlers = {
        "system": format_system,
        "developer": format_system,
        "user": format_user,
        "assistant": format_assistant,
        "toolResult": format_tool_result,
        "bashExecution": format_bash_execution,
        "custom": format_custom,
        "branchSummary": format_branch_summary,
        "compactionSummary": format_compaction,
    }
    handler = handlers.get(role)
    if handler:
        return handler(msg, raw_dir)
    text = extract_text(msg.get("content", "")) if msg.get("content") else json.dumps(msg, ensure_ascii=False)
    return f"## {role}\n{text}\n\n"


def write_raw_md(messages: list, turns_dir: Path, round_no: int) -> Path:
    """格式化消息 → raw-<round_no>.md(每轮完整备份,不覆盖)。

    超长工具输出(>5KB)仍截断并存 hash 到 raw/ 目录。
    """
    raw_dir = turns_dir / "raw"
    ensure_dir(raw_dir)

    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    parts = [f"# Turn {round_no} — {timestamp}\n\n"]
    for msg in messages:
        parts.append(format_message(msg, raw_dir))

    md = "".join(parts)
    out_path = turns_dir / f"raw-{round_no}.md"
    out_path.write_text(md, encoding="utf-8")
    print(f"[extract] ✓ raw-{round_no}.md: {len(messages)} msgs → {out_path} ({len(md)} bytes)", file=sys.stderr)
    return out_path


# ============================================================
# 对话摘要累积(工作记忆) + 固化轮次控制
# ============================================================

CONSOLIDATE_EVERY = 5  # 每 5 轮跑一次完整子代理(essence+notebook+remember)


def count_rounds(turns_dir: Path) -> int:
    """当前轮次 = dialogue-summary.md 已有的节数。文件即状态,无额外计数器。"""
    f = turns_dir / "dialogue-summary.md"
    if not f.exists():
        return 0
    return f.read_text(encoding="utf-8").count("### 轮次")


# 关键动作提取:白名单工具 + 容错解析(失败降级,不影响摘要主体)
ACTION_TOOLS = {"edit", "write", "read", "bash", "delete", "move"}


def extract_key_actions(messages: list) -> list:
    """从 messages 的 toolCall 块提取关键动作,返回 ['📝 edit src/a.ts', ...]。

    容错:参数缺失/非 dict → 跳过该动作;宁缺毋滥,绝不产生错误信息。
    """
    actions = []
    for msg in messages:
        content = msg.get("content", [])
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "toolCall":
                continue
            name = block.get("name", "")
            if name not in ACTION_TOOLS:
                continue
            args = block.get("arguments")
            if not isinstance(args, dict):
                continue
            target = args.get("path") or args.get("file") or args.get("from")
            if name == "bash":
                cmd = str(args.get("command", "")).replace("\n", " ").strip()[:80]
                if cmd:
                    actions.append(f"🖥️ {cmd}")
            elif target:
                icon = {"edit": "📝", "write": "➕", "read": "📖", "delete": "🗑️", "move": "↔️"}.get(name, "⚙️")
                actions.append(f"{icon} {name} {target}")
            # 其余缺失参数的动作直接跳过
    return actions[:6]  # 每轮最多 6 个,避免过长


def append_dialogue_summary(messages: list, turns_dir: Path, round_no: int):
    """追加本轮完整对话摘要一节(带轮次序号)到 dialogue-summary.md。

    收录本轮**所有**用户消息与**所有**助手回复(文本部分)——不削减用户信息。
    每轮 append,永久保留(不归档不覆盖);轮次 = 节数,固化点由节数判定。
    """
    # 只取 text 块,过滤 thinking(工作记忆不注入思考内容)
    user_texts = [
        extract_text(m.get("content", ""), include_thinking=False).strip()
        for m in messages
        if m.get("role") == "user"
    ]
    asst_texts = [
        extract_text(m.get("content", ""), include_thinking=False).strip()
        for m in messages
        if m.get("role") == "assistant"
    ]
    asst_texts = [t for t in asst_texts if t]
    if not asst_texts:
        return

    user_block = "\n".join(f"- {t}" for t in user_texts if t) or "(空)"
    asst_block = "\n\n".join(asst_texts)

    ensure_dir(turns_dir)
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    # 节标题带 raw 回查链接 + 关键动作行(容错:无动作则省略)
    actions = extract_key_actions(messages)
    action_line = f"\n**关键动作**: {' | '.join(actions)}\n" if actions else ""
    block = (
        f"### 轮次 {round_no} {ts} → 📄 raw-{round_no}.md\n\n"
        f"**用户**:\n{user_block}\n\n"
        f"**助手**:\n{asst_block}\n"
        f"{action_line}"
    )
    out = turns_dir / "dialogue-summary.md"
    with open(out, "a", encoding="utf-8") as f:
        f.write(block + "\n")
    print(
        f"[extract] ✓ dialogue-summary.md: +1 turn (user {len(user_block)} + asst {len(asst_block)} chars)",
        file=sys.stderr,
    )



# ============================================================
# 子代理启动
# ============================================================

def _forward_stream(src, dest, prefix=b""):
    """Read lines from src, prefix each, write to dest (binary mode)."""
    for line in iter(src.readline, b""):
        if line:
            dest.write(prefix + line)
            dest.flush()
    src.close()


def last_sections(text: str, n: int) -> str:
    """从 dialogue-summary.md 提取最后 n 节(增量窗口)。

    子代理输入 = 增量窗口(本次固化点之间的新轮次),而非全部历史:
    输入恒定 ≤ n 节(成本不随总轮次增长),system prompt 稳定(前缀缓存可命中)。
    用行首正则切分,避免首节(无前导换行)被留在头部导致多一节/少计一节。
    """
    sections = re.split(r"(?m)^### 轮次 ", text)
    parts = ["### 轮次 " + p for p in sections[1:] if p.strip()]
    return "\n\n".join(parts[-n:])


def spawn_subagent(turns_dir: Path):
    """启动 pi -p 进程进行记忆提取

    Streaming 模式：子代理的 stdout/stderr 实时输出到终端，
    用户能看到进度而非黑屏。用 bytes 模式 + UTF-8 解码
    避免 Windows GBK 编码崩溃。

    stderr 不再合并到 stdout — 分开读取，确保 TypeScript
    进度面板能实时捕获子代理的所有输出。
    """
    raw_md = turns_dir / "raw.md"
    extractor_prompt = AGENTS_DIR / "memory-extractor.md"
    error_log = turns_dir / "extraction-error.log"

    # 增量输入:只喂本次固化窗口的最后 CONSOLIDATE_EVERY 节(不膨胀、缓存友好)
    summary_file = turns_dir / "dialogue-summary.md"
    input_file = turns_dir / "consolidation-input.md"
    summary_text = summary_file.read_text(encoding="utf-8") if summary_file.exists() else ""
    if not summary_text.strip():
        print(f"[extract] ✗ dialogue-summary empty, skipping subagent", file=sys.stderr)
        return
    input_file.write_text(last_sections(summary_text, CONSOLIDATE_EVERY), encoding="utf-8")

    # 会话目录下最新的 raw-<n>.md 不再自动喂给子代理(体积大,缓存不友好);
    # 子代理需要细节时自己 read raw-<n>.md 回查。

    cmd = [
        "pi",
        "-p",
        "--no-session",
        "--tools", "read,write,edit,remember,recall,forget,supersede",
    ]

    # Read subagent model from config file (set via /subagent-model command)
    if SUBAGENT_MODEL_FILE.exists():
        model = SUBAGENT_MODEL_FILE.read_text(encoding="utf-8").strip()
        if model:
            cmd.extend(["--model", model])
            print(f"[extract] Using subagent model: {model}", file=sys.stderr)

    # Use --append-system-prompt with direct file path (no @ prefix)
    # @ prefix is for positional file args, not for --append-system-prompt
    cmd.extend([
        f'--append-system-prompt', str(extractor_prompt),
    ])
    full_cmd = " ".join(cmd)

    # The prompt text to send via stdin (pi -p reads from stdin when piped)
    # cwd 是当前会话目录。子代理只读增量输入文件 + 沉淀长期记忆,不写 notebook。
    prompt_text = (
        f"执行记忆固化。你的当前工作目录(cwd)是记忆会话目录:\n"
        f"- 读 consolidation-input.md(本次窗口的对话摘要,含关键动作行)\n"
        f"- 需要细节时 read raw-<n>.md 回查;查重时 read 项目记忆索引 ../<project>/memories/_index.md\n"
        f"- 只沉淀长期记忆(remember)。不写 notebook(主 LLM 独家维护),不清理记忆文件(海马体的活)\n"
        f"cwd: {turns_dir}"
    )

    # 继承环境，但设置 PI_SUBAGENT 防止递归 + PI_SESSION_DIR 指向会话目录
    env = os.environ.copy()
    env["PI_SUBAGENT"] = "1"
    env["PI_SESSION_DIR"] = str(turns_dir)

    print("[extract] Starting memory consolidation subagent (async, background)...", file=sys.stderr)

    # ── Async mode ──
    # 子代理 detached 后台运行,不阻塞用户进入下一轮(用户无感,像大脑在睡眠时加工记忆)。
    # 输出重定向到会话目录 consolidation-<ts>.log,便于事后查阅;失败不抛异常(后台任务)。
    log_path = turns_dir / f"consolidation-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.log"
    try:
        log_file = open(log_path, "a", encoding="utf-8", buffering=1)
    except OSError:
        log_file = None
    if log_file:
        log_file.write(f"# Consolidation {datetime.now(timezone.utc).isoformat()}\ncwd: {turns_dir}\n\n")

    flags = 0
    if os.name == "nt":
        # DETACHED_PROCESS + shell=True + 管道 stdio 会让子进程 stdin 句柄失效,
        # pi -p 永远等输入 → 固化子代理挂起、日志只有头部无输出(8/5 起全挂)。
        # CREATE_NO_WINDOW 无控制台窗口但保留句柄继承,子进程正常产出。
        flags = subprocess.CREATE_NO_WINDOW
    try:
        proc = subprocess.Popen(
            full_cmd,
            shell=True,
            cwd=turns_dir,
            stdin=subprocess.PIPE,
            stdout=log_file if log_file else subprocess.DEVNULL,
            stderr=subprocess.STDOUT,
            env=env,
            creationflags=flags if os.name == "nt" else 0,
            start_new_session=(os.name != "nt"),
        )
        # 通过 stdin 发送 prompt 并关闭 → 子代理读到完整输入后独立运行
        proc.stdin.write(prompt_text.encode("utf-8"))
        proc.stdin.close()
        # 不 wait —— 父进程(python/pi)退出后子代理继续;日志句柄 OS 级 dup,不受影响
        print(f"[extract] ✓ consolidation subagent spawned in background (log: {log_path.name})", file=sys.stderr)
        if log_file:
            log_file.close()
    except Exception as e:
        error_msg = f"Failed to spawn consolidation subagent: {e}"
        print(f"[extract] ✗ {error_msg}", file=sys.stderr)
        error_log.write_text(f"# Extraction Error — {datetime.now(timezone.utc).isoformat()}\n\n{error_msg}\n", encoding="utf-8")
        # 后台任务失败不阻塞主流程


# ============================================================
# 主入口
# ============================================================

def main():
    sys.stdin.reconfigure(encoding="utf-8")
    # Force line-buffered stderr so TypeScript progress UI gets updates immediately.
    # When Python's stderr is piped (not a TTY), it defaults to block buffering,
    # which means the progress panel shows nothing until the buffer fills or flushes.
    sys.stderr.reconfigure(line_buffering=True)

    # 从 stdin 读取消息
    raw = sys.stdin.read()
    messages = json.loads(raw)
    if not isinstance(messages, list):
        messages = [messages]

    if not messages:
        print("[extract] ✗ no messages", file=sys.stderr)
        sys.exit(1)

    # Defense-in-depth: skip if messages are incomplete (only system or < 2 total).
    # Catches any edge case where memory.ts's agent_end guards miss an abort.
    non_system = [m for m in messages if m.get("role") not in ("system", "developer")]
    if len(non_system) < 2:
        roles = [m.get("role", "?") for m in messages]
        print(f"[extract] ✗ messages too few/trivial ({roles}), skipping extraction", file=sys.stderr)
        sys.exit(0)  # exit 0 — nothing to extract, not an error

    # 会话目录优先(env PI_SESSION_DIR,由扩展传入);
    # 兼容旧路径:无 env 时按 cwd 推导(单会话旧布局)。
    session_dir = os.environ.get("PI_SESSION_DIR")
    if session_dir:
        turns_dir = Path(session_dir)
    else:
        cwd = os.getcwd()
        proj_name = os.path.basename(cwd)
        turns_dir = PROJECTS_DIR / proj_name / "turns"
    ensure_dir(turns_dir)

    try:
        # 1+2. 并行写 raw-<n>.md(每轮备份) + 追加对话摘要(工作记忆,含全部用户/助手消息)
        round_no = count_rounds(turns_dir) + 1  # 本轮轮次 = 已有节数 + 1
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            pool.submit(write_raw_md, messages, turns_dir, round_no)
            pool.submit(append_dialogue_summary, messages, turns_dir, round_no)

        # 3. 固化判定:节数即轮次,每 CONSOLIDATE_EVERY 轮异步跑一次固化子代理
        #    (只沉淀长期记忆;notebook 由主 LLM 维护)。中间轮只写文件,不启动子代理。
        if round_no % CONSOLIDATE_EVERY == 0:
            spawn_subagent(turns_dir)
            print(f"[extract] ✓ consolidation triggered (round {round_no})", file=sys.stderr)
        else:
            print(f"[extract] · 非固化轮 ({round_no}/{CONSOLIDATE_EVERY}),跳过子代理", file=sys.stderr)

        print("[extract] ✓ extraction complete", file=sys.stderr)
    except Exception as e:
        # Log any unhandled error to file
        error_log = turns_dir / "extraction-error.log"
        error_msg = f"Unhandled error: {e}\n\n{traceback.format_exc()}"
        print(f"[extract] ✗ {error_msg}", file=sys.stderr)
        try:
            error_log.write_text(
                f"# Extraction Error — {datetime.now(timezone.utc).isoformat()}\n\n{error_msg}\n",
                encoding="utf-8"
            )
        except:
            pass
        sys.exit(1)


if __name__ == "__main__":
    main()
