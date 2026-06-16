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
import subprocess
import sys
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


def extract_text(content) -> str:
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


def write_raw_md(messages: list, turns_dir: Path) -> Path:
    """格式化消息 → raw.md"""
    raw_dir = turns_dir / "raw"
    ensure_dir(raw_dir)

    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    parts = [f"# Turn — {timestamp}\n\n"]
    for msg in messages:
        parts.append(format_message(msg, raw_dir))

    md = "".join(parts)
    out_path = turns_dir / "raw.md"
    out_path.write_text(md, encoding="utf-8")
    print(f"[extract] ✓ raw.md: {len(messages)} msgs → {out_path} ({len(md)} bytes)", file=sys.stderr)
    return out_path


def write_turn_summary(messages: list, turns_dir: Path):
    """从 messages 中提取最后一条 assistant 消息 → turn-summary.md"""
    last_assistant = None
    for msg in reversed(messages):
        if msg.get("role") == "assistant":
            last_assistant = msg
            break

    if not last_assistant:
        return

    content = last_assistant.get("content", "")
    # Extract text blocks only
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", ""))
        text = "\n".join(texts).strip()
    elif isinstance(content, str):
        text = content.strip()
    else:
        return

    if not text:
        return

    timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    block = f"# 主脑上一轮回复 ({timestamp})\n\n{text}\n"
    out_path = turns_dir / "turn-summary.md"
    out_path.write_text(block, encoding="utf-8")
    print(f"[extract] ✓ turn-summary.md: {len(text)} chars", file=sys.stderr)


# ============================================================
# 子代理启动
# ============================================================

def spawn_subagent(turns_dir: Path):
    """启动 pi -p 进程进行记忆提取

    Streaming 模式：子代理的 stdout/stderr 实时输出到终端，
    用户能看到进度而非黑屏。用 bytes 模式 + UTF-8 解码
    避免 Windows GBK 编码崩溃。
    """
    raw_md = turns_dir / "raw.md"
    extractor_prompt = AGENTS_DIR / "memory-extractor.md"
    error_log = turns_dir / "extraction-error.log"

    if not raw_md.exists():
        print(f"[extract] ✗ raw.md not found, skipping subagent", file=sys.stderr)
        return

    cmd = [
        "pi",
        "-p",
        "--no-session",
        "--tools", "read,write,edit,remember,recall,notebook,forget,supersede",
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
    prompt_text = f"Read {raw_md} and perform the memory extraction tasks."

    # 继承环境，但设置 PI_SUBAGENT 防止递归
    env = os.environ.copy()
    env["PI_SUBAGENT"] = "1"

    print("[extract] Starting memory extraction subagent...", file=sys.stderr)

    # ── Streaming mode ──
    # Pipe prompt via stdin (pi -p reads from stdin, command-line prompt arg doesn't work in WSL)
    try:
        proc = subprocess.Popen(
            full_cmd,
            shell=True,
            cwd=turns_dir.parent,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # 合并 stderr → stdout
            env=env,
        )
        # Send prompt via stdin and close
        proc.stdin.write(prompt_text.encode("utf-8"))
        proc.stdin.close()
    except Exception as e:
        error_msg = f"Failed to spawn subagent: {e}"
        print(f"[extract] ✗ {error_msg}", file=sys.stderr)
        error_log.write_text(f"# Extraction Error — {datetime.now(timezone.utc).isoformat()}\n\n{error_msg}\n", encoding="utf-8")
        raise RuntimeError(error_msg)

    # 逐行读取并输出，bytes → UTF-8 避免 GBK 崩溃
    assert proc.stdout is not None
    for raw_line in iter(proc.stdout.readline, b""):
        line = raw_line.decode("utf-8", errors="replace").rstrip()
        if line:
            print(f"  {line}", file=sys.stderr)

    try:
        proc.wait(timeout=360)  # 最长等 6 分钟，防止子代理卡死导致僵尸进程
    except subprocess.TimeoutExpired:
        proc.kill()
        error_msg = "Subagent timed out after 360s, killed process"
        print(f"[extract] ✗ {error_msg}", file=sys.stderr)
        error_log.write_text(f"# Extraction Error — {datetime.now(timezone.utc).isoformat()}\n\n{error_msg}\n", encoding="utf-8")
        raise RuntimeError(error_msg)

    if proc.returncode == 0:
        # Success — clear any old error log
        if error_log.exists():
            error_log.unlink()
        print(f"[extract] ✓ subagent: done", file=sys.stderr)
    else:
        error_msg = f"subagent failed (exit={proc.returncode})"
        print(f"[extract] ✗ {error_msg}", file=sys.stderr)
        error_log.write_text(f"# Extraction Error — {datetime.now(timezone.utc).isoformat()}\n\n{error_msg}\n", encoding="utf-8")
        raise RuntimeError(error_msg)


# ============================================================
# 主入口
# ============================================================

def main():
    sys.stdin.reconfigure(encoding="utf-8")

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

    # 项目路径推导（和 memory.ts 的 PATHS 一致）
    cwd = os.getcwd()
    proj_name = os.path.basename(cwd)
    turns_dir = PROJECTS_DIR / proj_name / "turns"

    try:
        # 1+2. 并行写 raw.md 和 turn-summary.md（无依赖，写不同文件）
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=2) as pool:
            pool.submit(write_raw_md, messages, turns_dir)
            pool.submit(write_turn_summary, messages, turns_dir)

        # 3. 启动子代理（依赖 raw.md 已存在）
        spawn_subagent(turns_dir)

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
