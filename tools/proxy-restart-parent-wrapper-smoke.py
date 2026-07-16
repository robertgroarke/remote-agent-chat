#!/usr/bin/env python3
"""Focused contract for inaccessible proxy launcher cleanup."""

from pathlib import Path
from unittest.mock import patch
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import proxy_restart_lock as restart  # noqa: E402


events: list[tuple[str, int | None]] = []
lock = restart.ProxyRestartLock(agent="parent-wrapper-smoke")

with (
    patch.object(lock, "_get_proxy_relay_pids", return_value=[101, 202]),
    patch.object(lock, "_parent_pid", side_effect=lambda pid: {101: 301, 202: 302}[pid]),
    patch.object(lock, "_process_name", side_effect=lambda pid: {301: "cmd", 302: "python"}[pid]),
    patch.object(lock, "_kill_proxy_launcher", side_effect=lambda: events.append(("broad-launcher-cleanup", None))),
    patch.object(lock, "_kill_pid", side_effect=lambda pid: events.append(("kill", pid))),
    patch.object(lock, "_truncate_proxy_logs", side_effect=lambda: events.append(("truncate", None))),
    patch.object(lock, "_start_proxy_launcher", side_effect=lambda: events.append(("start", None))),
    patch.object(restart.time, "sleep", return_value=None),
):
    lock.kill_proxy()

assert events == [
    ("broad-launcher-cleanup", None),
    ("kill", 301),
    ("kill", 101),
    ("kill", 202),
    ("truncate", None),
    ("start", None),
], events

print("proxy restart parent-wrapper smoke: PASS")
