#!/usr/bin/env python3
"""
Pi AgentMessage → raw.md 格式化引擎

从 Pi 的 agent_end 事件中拿到 AgentMessage[] JSON，格式化为
子代理能读懂的 Markdown 文档（turns/raw.md）。

用法:
    # JSON 输入（messages.json）
    python write_raw.py --input <messages.json> --output <raw.md> --raw-dir <raw/>

    # JSONL 输入（session 文件）
    python write_raw.py --input <session.jsonl> --output <raw.md> --raw-dir <raw/>

输入: .json（消息数组）或 .jsonl（Pi 会话文件，取 type=message）
输出:
    1. <output> — 格式化的 Markdown 对话记录
    2. <raw-dir>/<hash>.txt — 截断的超大工具输出（>5KB）
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Optional

# ============================================================
# 常量
# ============================================================

LARGE_OUTPUT_THRESHOLD = 5120  # 5KB

# 需要脱敏的字段
REDACTED_KEYS = {"token", "apiKey", "key", "password", "secret", "authorization"}


# ============================================================
# 辅助函数
# ============================================================

def ensure_dir(path: str) -> None:
    os.makedirs(path, exist_ok=True)


def redact_args(args: dict) -> dict:
    """递归脱敏敏感字段"""
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


def extract_text_from_content(content: Any) -> str:
    """
    从 content 中提取纯文本。
    Pi 的 content 可以是 string 或 ContentBlock[]。
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
                texts.append(f"[thinking]\n{block.get('thinking', '')}\n[/thinking]")
            elif bt == "toolCall":
                # ToolCall 单独处理，不在文本里混入
                continue
            elif bt == "image":
                texts.append(f"[image: {block.get('mimeType', 'unknown')}]")
            else:
                texts.append(str(block))
        return "\n".join(texts)
    return str(content)


def extract_tool_calls(content: Any) -> list[dict]:
    """从 content 中提取所有 toolCall 块"""
    calls = []
    if isinstance(content, list):
        for block in content:
            if isinstance(block, dict) and block.get("type") == "toolCall":
                calls.append(block)
    return calls


def hash_content(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:12]


# ============================================================
# 消息格式化
# ============================================================

def format_content_block(content: Any, indent: str = "") -> str:
    """格式化 ContentBlock 为可读文本（非 toolCall）"""
    if isinstance(content, str):
        return indent + content
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict):
                bt = block.get("type", "")
                if bt == "text":
                    parts.append(indent + block.get("text", ""))
                elif bt == "thinking":
                    parts.append(f"{indent}[thinking]\n{indent}{block.get('thinking', '')}\n{indent}[/thinking]")
                elif bt == "toolCall":
                    continue  # 单独处理
                elif bt == "image":
                    parts.append(f"{indent}[image: {block.get('mimeType', 'unknown')} ({len(block.get('data', ''))} bytes)]")
                else:
                    parts.append(f"{indent}{json.dumps(block, ensure_ascii=False)}")
            else:
                parts.append(indent + str(block))
        return "\n".join(parts)
    return indent + str(content)


def format_system_message(msg: dict, raw_dir: str = "") -> str:
    """system/developer 角色 — 只保留大小信息，内容已过滤"""
    text = extract_text_from_content(msg.get("content", ""))
    size = len(text)
    return f"## System\n> [System prompt, {size} bytes - 已过滤]\n\n"


def format_user_message(msg: dict, raw_dir: str = "") -> str:
    """user 角色"""
    text = extract_text_from_content(msg.get("content", ""))
    return f"## User\n{text}\n\n"


def format_assistant_message(msg: dict, raw_dir: str) -> str:
    """assistant 角色 — 文本 + thinking + toolCall"""
    content = msg.get("content", [])
    parts = []

    # 1. 提取并格式化文本 + thinking 内容
    text_content = format_content_block(content)
    if text_content.strip():
        parts.append(f"## Assistant\n{text_content.strip()}")

    # 2. 提取 toolCall 块
    tool_calls = extract_tool_calls(content)
    for tc in tool_calls:
        tool_name = tc.get("name", "unknown")
        tool_args = tc.get("arguments", {})
        if isinstance(tool_args, dict):
            tool_args = redact_args(tool_args)
        args_json = json.dumps(tool_args, indent=2, ensure_ascii=False)
        parts.append(f"## Tool Call: {tool_name}\n```json\n{args_json}\n```")

    return "\n\n".join(parts) + "\n\n" if parts else ""


def format_tool_result_message(msg: dict, raw_dir: str) -> str:
    """toolResult 角色"""
    tool_name = msg.get("toolName", "") or msg.get("name", "") or ""
    content = msg.get("content", [])
    is_error = msg.get("isError", False)

    text = extract_text_from_content(content)
    error_tag = " ⚠️ ERROR" if is_error else ""

    # read 工具的结果：只保留路径和大小，subagent 可按需 read 源文件
    if tool_name in ("read", "read_file", "file_read"):
        return f"## Tool Result: {tool_name}{error_tag}\n> [read result, {len(text)} bytes - 已截断，subagent 可按需 read 源文件]\n\n"

    result = f"## Tool Result: {tool_name}{error_tag}\n"

    if len(text) > LARGE_OUTPUT_THRESHOLD:
        lines = text.split("\n")
        total_lines = len(lines)
        head = "\n".join(lines[:50])
        tail = "\n".join(lines[-20:]) if total_lines > 70 else ""
        truncated_lines = total_lines - 70 if total_lines > 70 else 0

        content_hash = hash_content(text)
        full_path = os.path.join(raw_dir, f"{content_hash}.txt")
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(text)

        result += f"> (截断, full → turns/raw/{content_hash}.txt) 共 {len(text)} bytes\n\n```\n{head}\n"
        if truncated_lines > 0:
            result += f"\n... ({truncated_lines} 行截断) ...\n\n{tail}\n"
        result += "```\n\n"
    else:
        result += f"```\n{text}\n```\n\n"

    return result


def format_bash_execution_message(msg: dict, raw_dir: str) -> str:
    """bashExecution 角色"""
    command = msg.get("command", "")
    output = msg.get("output", "")
    exit_code = msg.get("exitCode")
    truncated = msg.get("truncated", False)
    cancelled = msg.get("cancelled", False)

    flags = []
    if cancelled:
        flags.append("cancelled")
    if exit_code is not None and exit_code != 0:
        flags.append(f"exit={exit_code}")
    flag_str = f" ({', '.join(flags)})" if flags else ""

    result = f"## Bash Execution{flag_str}\n\n```bash\n{command}\n```\n\n"

    if output:
        if len(output) > LARGE_OUTPUT_THRESHOLD or truncated:
            output_lines = output.split("\n")
            total_lines = len(output_lines)
            head = "\n".join(output_lines[:50])
            tail = "\n".join(output_lines[-20:]) if total_lines > 70 else ""
            truncated_lines = total_lines - 70 if total_lines > 70 else 0

            content_hash = hash_content(output)
            full_path = os.path.join(raw_dir, f"{content_hash}.txt")
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(output)

            result += f"> (截断, full → turns/raw/{content_hash}.txt) 共 {len(output)} bytes\n\n```\n{head}\n"
            if truncated_lines > 0:
                result += f"\n... ({truncated_lines} 行截断) ...\n\n{tail}\n"
            result += "```\n\n"
        else:
            result += f"```\n{output}\n```\n\n"

    return result


def format_custom_message(msg: dict, raw_dir: str) -> str:
    """custom 角色（扩展注入的消息）"""
    custom_type = msg.get("customType", "unknown")
    content = msg.get("content", "")
    text = extract_text_from_content(content)
    return f"## Custom: {custom_type}\n{text}\n\n"


def format_branch_summary(msg: dict, raw_dir: str = "") -> str:
    summary = msg.get("summary", "")
    from_id = msg.get("fromId", "")
    return f"## Branch Summary\nFrom: {from_id}\n\n{summary}\n\n"


def format_compaction_summary(msg: dict, raw_dir: str = "") -> str:
    summary = msg.get("summary", "")
    tokens = msg.get("tokensBefore", 0)
    return f"## Compaction Summary\nTokens before: {tokens}\n\n{summary}\n\n"


# ============================================================
# 主流程
# ============================================================

def format_message(msg: dict, raw_dir: str) -> str:
    """根据 role 路由到不同的格式化函数"""
    role = msg.get("role", "unknown")

    handlers = {
        "system": format_system_message,
        "developer": format_system_message,
        "user": format_user_message,
        "assistant": format_assistant_message,
        "toolResult": format_tool_result_message,
        "bashExecution": format_bash_execution_message,
        "custom": format_custom_message,
        "branchSummary": format_branch_summary,
        "compactionSummary": format_compaction_summary,
    }

    handler = handlers.get(role)
    if handler:
        return handler(msg, raw_dir)

    # Fallback for unknown roles
    content = msg.get("content", "")
    text = extract_text_from_content(content) if content else json.dumps(msg, ensure_ascii=False)
    return f"## {role}\n{text}\n\n"


def load_messages_from_jsonl(path: str) -> list[dict]:
    """从 JSONL session 文件中提取所有 type=message 的消息"""
    messages = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("type") == "message" and "message" in entry:
                messages.append(entry["message"])
    return messages


def load_messages_from_json(path: str) -> list[dict]:
    """从标准 JSON 文件中加载消息数组"""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data
    if isinstance(data, dict) and "messages" in data:
        return data["messages"]
    return [data]


def process_with_paths(input_path: str, output_path: str, raw_dir: str) -> Optional[str]:
    """
    主处理流程（显式传路径版）。
    支持 .json 和 .jsonl 输入。input_path 为 "-" 时从 stdin 读取。
    """
    ensure_dir(raw_dir)

    # 从 stdin 读取
    if input_path == "-":
        sys.stdin.reconfigure(encoding="utf-8")
        messages = json.loads(sys.stdin.read())
        if not isinstance(messages, list):
            messages = [messages]
    # 根据扩展名选择加载方式
    elif input_path.endswith(".jsonl"):
        messages = load_messages_from_jsonl(input_path)
    else:
        if not os.path.exists(input_path):
            print(f"[write_raw] Input not found: {input_path}", file=sys.stderr)
            return None
        messages = load_messages_from_json(input_path)

    if not isinstance(messages, list) or len(messages) == 0:
        print(f"[write_raw] No messages found in {input_path}", file=sys.stderr)
        return None

    timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    md = f"# Turn — {timestamp}\n\n"

    for msg in messages:
        md += format_message(msg, raw_dir)

    with open(output_path, "w", encoding="utf-8") as f:
        f.write(md)

    print(f"[write_raw] ✓ Written {len(messages)} messages → {output_path} ({len(md)} bytes)", file=sys.stderr)
    return output_path


def process(cwd: str) -> Optional[str]:
    """
    主处理流程（自动派生路径版）。
    返回: 成功时返回 raw.md 路径，失败时返回 None
    """
    project_dir = os.path.join(os.path.expanduser("~"), ".pi", "agent", "memory", "projects", os.path.basename(cwd))
    turns_dir = os.path.join(project_dir, "turns")
    raw_dir = os.path.join(turns_dir, "raw")
    messages_path = os.path.join(raw_dir, "messages.json")
    output_path = os.path.join(turns_dir, "raw.md")

    if not os.path.exists(messages_path):
        print(f"[write_raw] messages.json not found: {messages_path}", file=sys.stderr)
        return None

    return process_with_paths(messages_path, output_path, raw_dir)


def main():
    parser = argparse.ArgumentParser(description="Pi AgentMessage → raw.md 格式化引擎")
    parser.add_argument("--input", required=True, help="输入：文件路径(.json/.jsonl) 或 -（stdin 管道）")
    parser.add_argument("--output", required=True, help="raw.md 输出路径")
    parser.add_argument("--raw-dir", required=True, help="截断文件存放目录 (turns/raw/)")
    args = parser.parse_args()

    result = process_with_paths(args.input, args.output, args.raw_dir)
    if result is None:
        sys.exit(1)


if __name__ == "__main__":
    main()
