#!/usr/bin/env python3
"""Deterministic state-machine checks for proxy_watchdog.py."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from proxy_watchdog import ProxyWatchdog, WatchdogConfig  # noqa: E402


class Clock:
    def __init__(self) -> None:
        self.value = 1_720_000_000.0

    def now(self) -> float:
        return self.value

    def advance(self, seconds: float) -> None:
        self.value += seconds


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    hidden_launcher = (repo_root / "proxy-watchdog-hidden.vbs").read_text(encoding="utf-8")
    task_installer = (repo_root / "install-proxy-watchdog-task.ps1").read_text(encoding="utf-8")
    watchdog_source = (repo_root / "proxy_watchdog.py").read_text(encoding="utf-8")
    assert "pythonw" in hidden_launcher.lower()
    assert "shell.Run command, 0, False" in hidden_launcher
    assert ".bat" not in hidden_launcher.lower()
    assert "New-ScheduledTaskAction -Execute $pythonwPath" in task_installer
    assert "Task Scheduler owns the long-lived pythonw process directly" in task_installer
    assert "MultipleInstances IgnoreNew" in task_installer
    assert "creationflags=CREATE_NO_WINDOW" in watchdog_source

    with tempfile.TemporaryDirectory(prefix="rac-proxy-watchdog-") as temp_dir:
        root = Path(temp_dir)
        clock = Clock()
        health = {"value": 1, "raises": False}
        restarts: list[int] = []
        events: list[tuple[str, dict]] = []

        def probe() -> int:
            if health["raises"]:
                raise OSError("relay unavailable")
            return int(health["value"])

        config = WatchdogConfig(
            health_url="http://test.invalid/healthz",
            event_url="http://test.invalid/api/proxy-watchdog-event",
            proxy_secret="test-secret",
            poll_seconds=5,
            missing_seconds=120,
            max_restarts=3,
            retry_base_seconds=30,
            state_path=root / "state.json",
            log_path=root / "watchdog.log",
        )
        watchdog = ProxyWatchdog(
            config,
            now=clock.now,
            health_probe=probe,
            restart=lambda attempt: restarts.append(attempt) or 0,
            event_sender=lambda event_type, details: events.append((event_type, details.copy())) or True,
        )

        assert watchdog.tick() == "healthy"
        health["raises"] = True
        clock.advance(600)
        assert watchdog.tick() == "relay_unreachable"
        assert restarts == [], "relay outage must never restart the proxy"

        health.update(value=0, raises=False)
        assert watchdog.tick() == "grace"
        clock.advance(119)
        assert watchdog.tick() == "grace"
        assert restarts == []
        clock.advance(1)
        assert watchdog.tick() == "restarted"
        assert restarts == [1]
        assert events == [], "relay owns the two-minute offline push; watchdog must not duplicate it"

        clock.advance(29)
        assert watchdog.tick() == "backoff"
        clock.advance(1)
        assert watchdog.tick() == "restarted"
        clock.advance(60)
        assert watchdog.tick() == "restarted"
        assert restarts == [1, 2, 3]
        clock.advance(120)
        assert watchdog.tick() == "failed"
        assert [event[0] for event in events] == ["proxy_watchdog_failed"]
        assert watchdog.tick() == "failed"
        assert len(events) == 1, "failure notification must be one-shot per incident"

        persisted = ProxyWatchdog(
            config,
            now=clock.now,
            health_probe=probe,
            restart=lambda attempt: restarts.append(attempt) or 0,
            event_sender=lambda event_type, details: events.append((event_type, details.copy())) or True,
        )
        assert persisted.tick() == "failed"
        assert restarts == [1, 2, 3], "restart budget must survive watchdog restart"

        health["value"] = 2
        assert persisted.tick() == "healthy"
        assert events[-1][0] == "proxy_watchdog_failed", "relay owns recovery notification"
        state = json.loads(config.state_path.read_text(encoding="utf-8"))
        assert state["restart_attempts"] == 0
        assert state["missing_since"] is None

        result = {
            "status": "PASS",
            "relay_outage_restarts": 0,
            "missing_grace_seconds": config.missing_seconds,
            "restart_attempts": restarts,
            "bounded_retry_delays_seconds": [30, 60, 120],
            "event_types": [event[0] for event in events],
            "persisted_budget": True,
            "focus_safe": True,
            "scheduled_task_direct_pythonw": True,
        }
        print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
