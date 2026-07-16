#!/usr/bin/env python3
"""Read-only production proof for the proxy outage monitor and Windows watchdog."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def get_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=10) as response:
        if response.status != 200:
            raise AssertionError(f"GET {url} returned {response.status}")
        return json.load(response)


def unauthorized_event_status(url: str) -> int:
    payload = json.dumps({
        "type": "proxy_watchdog_failed",
        "incident_id": "read-only-production-auth-probe",
        "restart_attempts": 3,
        "missing_seconds": 300,
    }).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={
            "Authorization": "Bearer deliberately-invalid-watchdog-secret",
            "Content-Type": "application/json",
        },
    )
    try:
        urllib.request.urlopen(request, timeout=10)
    except urllib.error.HTTPError as error:
        return error.code
    raise AssertionError("invalid watchdog bearer secret was unexpectedly accepted")


def windows_task_state() -> dict:
    script = r"""
$taskName='Remote Agent Chat Proxy Watchdog'
$task=Get-ScheduledTask -TaskName $taskName
$info=$task | Get-ScheduledTaskInfo
$processes=@(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'pythonw.exe' -and $_.CommandLine -match 'proxy_watchdog\.py'
} | Select-Object ProcessId,ParentProcessId,Name,CommandLine)
[pscustomobject]@{
  task_name=$task.TaskName
  state=$task.State.ToString()
  last_run_time=$info.LastRunTime.ToString('o')
  last_task_result=$info.LastTaskResult
  execute=$task.Actions.Execute
  arguments=$task.Actions.Arguments
  processes=$processes
} | ConvertTo-Json -Depth 5 -Compress
"""
    completed = subprocess.run(
        ["powershell", "-NoProfile", "-Command", script],
        capture_output=True,
        text=True,
        timeout=20,
        creationflags=CREATE_NO_WINDOW,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Scheduled Task query failed: {completed.stderr.strip()}")
    return json.loads(completed.stdout)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()
    load_env(ROOT / ".env")
    load_env(ROOT / "agent-proxy" / ".env")

    relay_ip = os.environ.get("RELAY_IP", "127.0.0.1")
    relay_port = os.environ.get("RELAY_PORT", "3500")
    origin = f"http://{relay_ip}:{relay_port}"
    health = get_json(f"{origin}/healthz")
    connections = health.get("connections", {})
    monitor = health.get("proxy_watchdog", {})
    assert health.get("status") == "ok"
    assert int(connections.get("proxy_connections", 0)) >= 1
    assert monitor.get("has_seen_proxy") is True
    assert monitor.get("state") == "healthy"
    assert monitor.get("grace_ms") == 120_000

    endpoint_status = unauthorized_event_status(f"{origin}/api/proxy-watchdog-event")
    assert endpoint_status == 401

    task = windows_task_state()
    processes = task.get("processes") or []
    if isinstance(processes, dict):
        processes = [processes]
    assert task.get("state") == "Running"
    assert str(task.get("execute", "")).lower().endswith("pythonw.exe")
    assert "proxy_watchdog.py" in str(task.get("arguments", ""))
    assert len(processes) == 1

    state_path = Path(os.environ.get("LOCALAPPDATA", ROOT)) / "RemoteAgentChat" / "proxy-watchdog-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state.get("missing_since") is None
    assert state.get("restart_attempts") == 0
    assert state.get("last_proxy_count", 0) >= 1

    result = {
        "ok": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "relay_origin": origin,
        "health": {
            "status": health.get("status"),
            "proxy_sessions": connections.get("proxy_sessions"),
            "proxy_connections": connections.get("proxy_connections"),
            "watchdog": monitor,
        },
        "failure_endpoint_invalid_secret_status": endpoint_status,
        "scheduled_task": task,
        "local_state": state,
        "single_instance": True,
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
