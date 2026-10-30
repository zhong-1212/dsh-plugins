#!/usr/bin/env python3
"""隐私扫描：仓库内不得出现开发者本机痕迹。

CI 与本地均可运行（无第三方依赖；YAML 检查交给 CI，本脚本只做纯文本模式匹配）。
命中即退出码 1 并打印 文件:行号:片段。
"""
from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

SKIP_DIR_NAMES = {"node_modules", ".git", "dist", "build"}

PATTERNS = [
    # 开发者账号 / 机器名
    ("local-username", r"\b10431\b"),
    ("windows-user-root", r"[A-Za-z]:\\\\?Users\\\\?"),
    ("dev-workspace-path", r"D:\\\\\u5b8c\u7f8e"),
    # 内部服务地址与一次性端口
    ("loopback-with-port", r"127\.0\.0\.1:\d{4,5}"),
    # 凭据形态
    ("github-token", r"gh[pousr]_[A-Za-z0-9]{16,}"),
    ("generic-api-key", r"(?i)\b(api[_-]?key|secret|passwd|password)\b\s*[:=]\s*['\"][^'\"]{8,}"),
    ("bearer-token", r"(?i)\bbearer\s+[A-Za-z0-9._\-]{16,}"),
    ("private-key-block", r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    # 会话/追踪标识
    ("session-uuid", r"session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"),
    ("oidc-config-id", r"oidcConfigId"),
]

COMPILED = [(name, re.compile(pat)) for name, pat in PATTERNS]


def iter_files():
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file():
            continue
        if SKIP_DIR_NAMES.intersection(part.lower() for part in p.parts):
            continue
        rel = p.relative_to(ROOT).as_posix()
        if rel == "tools/privacy_scan.py":  # 本脚本自身含模式字面量
            continue
        yield p, rel


def main() -> int:
    hits = []
    scanned = 0
    for path, rel in iter_files():
        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue  # 二进制或不可读文件跳过（本仓库应无此类）
        scanned += 1
        for lineno, line in enumerate(text.splitlines(), 1):
            for name, rx in COMPILED:
                m = rx.search(line)
                if m:
                    snippet = line.strip()
                    if len(snippet) > 120:
                        snippet = snippet[:120] + "..."
                    hits.append(f"{rel}:{lineno}: [{name}] {snippet}")
    print(f"scanned files: {scanned}")
    if hits:
        print("PRIVACY HITS:")
        print("\n".join(hits))
        return 1
    print("privacy scan OK: no developer-machine traces found")
    return 0


if __name__ == "__main__":
    sys.exit(main())
