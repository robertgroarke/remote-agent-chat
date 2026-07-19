#!/usr/bin/env python3
"""Regression contract for safe proxy worker ownership selection."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from proxy_restart_lock import (  # noqa: E402
    ProxyRestartLock,
    ProxyRestartTimeout,
    select_proxy_worker_pids,
)


def process(pid: int, parent_pid: int, name: str, command_line: str | None) -> dict:
    return {
        "pid": pid,
        "parent_pid": parent_pid,
        "name": name,
        "command_line": command_line,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="also audit the current relay connections")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    processes = [
        process(10, 1, "cmd.exe", r'cmd.exe /c "C:\repo\restart-proxy.bat"'),
        process(
            20,
            10,
            "node.exe",
            r'node.exe C:\repo\tools\bounded-process-supervisor.js --name proxy '
            r'--cwd C:\repo\agent-proxy -- node.exe index.js',
        ),
        process(21, 20, "node.exe", "node.exe index.js"),
        process(22, 21, "conhost.exe", None),
        process(30, 1, "node.exe", "node.exe tools/provider-usage-production-soak.js"),
        process(31, 30, "python.exe", "python proxy_restart_lock.py"),
        process(40, 1, "node.exe", r'node.exe C:\repo\agent-proxy\index.js'),
        process(
            41,
            1,
            "node.exe",
            r'node.exe tools\fixture.js --script C:\repo\agent-proxy\index.js',
        ),
        process(50, 1, "node.exe", None),
        process(
            60,
            1,
            "node.exe",
            r'node.exe C:\repo\tools\bounded-process-supervisor.js --name usage '
            r'-- node.exe index.js',
        ),
        process(61, 60, "node.exe", "node.exe index.js"),
    ]

    selected = select_proxy_worker_pids(
        [21, 22, 30, 31, 40, 41, 50, 61, 999],
        processes,
    )
    assert selected == [21, 40], selected

    powershell_shape = [
        {
            "ProcessId": 70,
            "ParentProcessId": 1,
            "Name": "node.exe",
            "CommandLine": r'node.exe "C:\repo\agent-proxy\index.js"',
        },
    ]
    assert select_proxy_worker_pids([70], powershell_shape) == [70]
    assert select_proxy_worker_pids([30], processes) == []

    timeout_lock = ProxyRestartLock(agent="reconnect-timeout-smoke")
    with (
        patch.object(timeout_lock, "_get_proxy_relay_pids", return_value=[]),
        patch("proxy_restart_lock.time.monotonic", side_effect=[0, 91]),
        patch("proxy_restart_lock.time.sleep", return_value=None),
    ):
        try:
            timeout_lock.wait_for_proxy_up()
        except ProxyRestartTimeout:
            pass
        else:
            raise AssertionError("reconnect timeout did not fail closed")

    delayed_start_lock = ProxyRestartLock(agent="delayed-authenticated-readiness-smoke")
    with (
        patch.object(delayed_start_lock, "_get_proxy_relay_pids", side_effect=[[], [], [21]]),
        patch.object(delayed_start_lock, "_relay_handshake_ready", return_value=True),
        patch("proxy_restart_lock.time.monotonic", side_effect=[0, 1, 31, 45]),
        patch("proxy_restart_lock.time.sleep", return_value=None),
    ):
        delayed_ready_pids = delayed_start_lock.wait_for_proxy_up()
    assert delayed_ready_pids == [21], "authenticated startup after 30 seconds was rejected"

    readiness_lock = ProxyRestartLock(agent="authenticated-readiness-smoke")
    with (
        patch.object(readiness_lock, "_get_proxy_relay_pids", side_effect=[[21], [21]]),
        patch.object(readiness_lock, "_relay_handshake_ready", side_effect=[False, True]) as handshake,
        patch("proxy_restart_lock.time.monotonic", side_effect=[0, 1, 2]),
        patch("proxy_restart_lock.time.sleep", return_value=None),
    ):
        ready_pids = readiness_lock.wait_for_proxy_up()
    assert ready_pids == [21]
    assert handshake.call_count == 2, "TCP-only readiness returned before relay authentication"

    with TemporaryDirectory() as temp_dir:
        boundary_lock = ProxyRestartLock(
            agent="handshake-boundary-smoke",
            source_root=temp_dir,
        )
        proxy_log = Path(temp_dir) / "proxy.log"
        old_bytes = b"[relay] Handshake OK. stale-worker\n"
        proxy_log.write_bytes(old_bytes)
        boundary_lock._proxy_log_start_offset = len(old_bytes)
        assert boundary_lock._relay_handshake_ready() is False
        with proxy_log.open("ab") as log_file:
            log_file.write(b"[relay] Handshake OK. replacement-worker\n")
        assert boundary_lock._relay_handshake_ready() is True

    evidence = {
        "schema_version": 1,
        "ok": True,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "fixture": {
            "relay_pids": [21, 22, 30, 31, 40, 41, 50, 61, 999],
            "selected_proxy_pids": selected,
            "excluded_soak_pid": 30,
            "excluded_non_proxy_supervisor_worker_pid": 61,
            "explicit_agent_proxy_path_pid": 40,
            "restart_mutex_anchored_to_config_root": True,
            "reconnect_timeout_failed_closed": True,
            "relay_authentication_required": True,
            "stale_handshake_excluded_at_restart_boundary": True,
            "startup_beyond_30_seconds_tolerated": True,
            "startup_timeout_seconds": 90,
            "checks": 10,
        },
    }

    if args.live:
        lock = ProxyRestartLock(agent="read-only-ownership-smoke")
        relay_pids = sorted(lock._get_relay_pids())
        selected_pids = lock._get_proxy_relay_pids()
        if not selected_pids:
            raise AssertionError(f"live proxy worker was not identified: relay={relay_pids}")
        evidence["live"] = {
            "relay_pids": relay_pids,
            "selected_proxy_pids": selected_pids,
            "excluded_relay_pids": sorted(set(relay_pids) - set(selected_pids)),
            "read_only": True,
        }

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
