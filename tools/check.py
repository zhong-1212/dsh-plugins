#!/usr/bin/env python3
"""仓库静态自检：语法 + JSON/YAML 合法性 + 隐私模式扫描。

零第三方依赖（YAML 检查在缺 pyyaml 时降级为结构粗检并明确报告），
可本地运行，也可被 CI 调用：python tools/check.py
退出码：0 全通过；1 有失败项。
"""
from __future__ import annotations

import json
import pathlib
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def fail(msg: str, errs: list[str]) -> None:
    errs.append(msg)
    print("FAIL", msg)


def check_js(errs: list[str]) -> int:
    n = 0
    for p in sorted(ROOT.rglob("*.js")):
        if "node_modules" in p.parts:
            continue
        n += 1
        r = subprocess.run(["node", "--check", str(p)], capture_output=True, text=True)
        if r.returncode != 0:
            fail(f"node --check {p.relative_to(ROOT)}: {r.stderr.strip()[:200]}", errs)
    print(f"js files checked: {n}")
    return n


def check_json(errs: list[str]) -> int:
    n = 0
    for p in sorted(ROOT.rglob("*.json")):
        if "node_modules" in p.parts:
            continue
        n += 1
        try:
            json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            fail(f"json {p.relative_to(ROOT)}: {e}", errs)
    print(f"json files checked: {n}")
    return n


def check_yaml(errs: list[str]) -> int:
    files = [p for p in sorted(ROOT.rglob("*.yml")) if "node_modules" not in p.parts]
    try:
        import yaml  # type: ignore
    except ImportError:
        print(f"yaml files found: {len(files)} (pyyaml unavailable: structural pre-check only)")
        for p in files:
            text = p.read_text(encoding="utf-8")
            if "\t" in text:
                fail(f"yaml {p.relative_to(ROOT)}: tab indentation", errs)
            if text.lstrip().startswith("{"):
                fail(f"yaml {p.relative_to(ROOT)}: looks like JSON", errs)
        return len(files)
    for p in files:
        try:
            yaml.safe_load(p.read_text(encoding="utf-8"))
        except Exception as e:
            fail(f"yaml {p.relative_to(ROOT)}: {e}", errs)
    print(f"yaml files checked: {len(files)}")
    return len(files)


def main() -> int:
    errs: list[str] = []
    check_js(errs)
    check_json(errs)
    check_yaml(errs)
    r = subprocess.run([sys.executable, str(ROOT / "tools" / "privacy_scan.py")],
                       capture_output=True, text=True)
    print(r.stdout.strip())
    if r.returncode != 0:
        fail("privacy scan reported hits:\n" + r.stdout[-800:], errs)
    if errs:
        print(f"\n{len(errs)} failure(s)")
        return 1
    print("\nall static checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
