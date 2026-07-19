"""Fail-closed Windows subprocess policy shared by repository Python tools."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Mapping


ROOT = Path(__file__).resolve().parents[1]
POLICY_PATH = ROOT / "shared" / "windows-automation-launch-policy.json"
POLICY = json.loads(POLICY_PATH.read_text(encoding="utf-8"))


def _truthy(value: object) -> bool:
    return str(value or "").strip().lower() in {
        "1", "true", "yes", "on", "test", "e2e", "validator", "synthetic"
    }


def automation_context(env: Mapping[str, str] | None = None) -> str | None:
    current = os.environ if env is None else env
    if str(current.get("NODE_ENV", "")).strip().lower() == "test":
        return "NODE_ENV"
    for key in POLICY["automation_environment_keys"]:
        if _truthy(current.get(key)):
            return key
    return None


def windowless_subprocess_kwargs(
    *,
    stdin: Any = subprocess.DEVNULL,
    stdout: Any = subprocess.DEVNULL,
    stderr: Any = subprocess.DEVNULL,
) -> dict[str, Any]:
    """Return creation-time-hidden kwargs; callers must keep shell=False."""
    kwargs: dict[str, Any] = {
        "stdin": stdin,
        "stdout": stdout,
        "stderr": stderr,
        "shell": False,
    }
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        startupinfo = subprocess.STARTUPINFO()
        startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
        startupinfo.wShowWindow = subprocess.SW_HIDE
        kwargs["startupinfo"] = startupinfo
    return kwargs


def validate_automation_launch_spec(spec: Mapping[str, Any]) -> tuple[bool, str]:
    if spec.get("visible") is True or spec.get("headless") is False:
        return False, "visible_or_gui_capable"
    if spec.get("shell") is True:
        return False, "unverified_shell"
    if os.name == "nt" and spec.get("creationflags") != "CREATE_NO_WINDOW":
        return False, "missing_create_no_window"
    return True, "windowless_at_creation"


__all__ = [
    "POLICY",
    "automation_context",
    "validate_automation_launch_spec",
    "windowless_subprocess_kwargs",
]
