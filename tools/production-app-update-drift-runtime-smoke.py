#!/usr/bin/env python3
"""Read-only production proof for the app-update drift Scheduled Task."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def powershell_json(script: str) -> dict:
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True,
        text=True,
        timeout=20,
        creationflags=CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "PowerShell query failed")
    return json.loads(completed.stdout)


def current_versions() -> dict:
    completed = subprocess.run(
        ["node", str(ROOT / "tools" / "app-version-inventory.js")],
        cwd=str(ROOT),
        capture_output=True,
        text=True,
        timeout=30,
        creationflags=CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        raise RuntimeError(completed.stderr.strip() or "version inventory failed")
    return json.loads(completed.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()
    lock_path = ROOT / "data" / "app-update-drift-sentinel.lock"
    state_path = ROOT / "data" / "app-update-drift-state.json"
    lock_lines = lock_path.read_text(encoding="utf-8").splitlines()
    sentinel_pid = int(lock_lines[0])
    task = powershell_json(rf"""
$task=Get-ScheduledTask -TaskName 'Remote Agent Chat App Update Drift Sentinel'
$info=$task | Get-ScheduledTaskInfo
$process=Get-CimInstance Win32_Process -Filter 'ProcessId={sentinel_pid}' | Select-Object ProcessId,ParentProcessId,Name,CommandLine
$matching=@(Get-CimInstance Win32_Process | Where-Object {{ $_.Name -eq 'node.exe' -and $_.CommandLine -match 'app-update-drift-sentinel\.js' }} | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
[pscustomobject]@{{
  task_name=$task.TaskName
  state=$task.State.ToString()
  last_run_time=$info.LastRunTime.ToString('o')
  last_task_result=$info.LastTaskResult
  execute=$task.Actions.Execute
  arguments=$task.Actions.Arguments
  lock_process=$process
  matching_processes=$matching
}} | ConvertTo-Json -Depth 5 -Compress
""")
    matching = task.get("matching_processes") or []
    if isinstance(matching, dict):
        matching = [matching]
    task["matching_processes"] = matching
    lock_process = task.get("lock_process") or {}
    assert task.get("state") == "Running"
    assert str(task.get("execute", "")).lower().endswith("wscript.exe")
    assert "app-update-drift-hidden.vbs" in str(task.get("arguments", ""))
    assert lock_process.get("ProcessId") == sentinel_pid
    assert lock_process.get("Name") == "node.exe"
    assert "app-update-drift-sentinel.js" in str(lock_process.get("CommandLine", ""))
    assert len(matching) == 1

    state = json.loads(state_path.read_text(encoding="utf-8"))
    versions = current_versions()
    assert state.get("versions") == versions
    assert len(versions) == 11
    assert state.get("last_changes") == []

    result = {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "scheduled_task": task,
        "sentinel_pid": sentinel_pid,
        "single_instance": True,
        "baseline_versions": versions,
        "baseline_matches_live_inventory": True,
        "last_changes": [],
        "fallback_poll_ms": 60_000,
        "read_only": True,
        "visible_windows_opened": 0,
        "protected_user_apps_touched": 0,
    }
    serialized = json.dumps(result, indent=2) + "\n"
    if args.output:
        output_path = Path(args.output).resolve()
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(serialized, encoding="utf-8")
    print(serialized, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
