#!/usr/bin/env python3
"""Verify background VBS launches cannot create a visible console."""

from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import sys


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import hidden_process  # noqa: E402


def main() -> None:
    with TemporaryDirectory() as temp_dir:
        wrapper = Path(temp_dir) / "hidden.vbs"
        wrapper.write_text("WScript.Quit 0\n", encoding="utf-8")
        with patch.object(hidden_process.subprocess, "Popen") as popen:
            hidden_process.launch_hidden_vbs(wrapper)

        args, kwargs = popen.call_args
        command = args[0]
        assert command[:3] == ["wscript.exe", "//B", "//Nologo"], command
        assert Path(command[3]) == wrapper.resolve(), command
        assert kwargs["creationflags"] == hidden_process.CREATE_NO_WINDOW
        assert kwargs["stdin"] is hidden_process.subprocess.DEVNULL
        assert kwargs["stdout"] is hidden_process.subprocess.DEVNULL
        assert kwargs["stderr"] is hidden_process.subprocess.DEVNULL
        assert kwargs["close_fds"] is True

    restart_source = (ROOT / "proxy_restart_lock.py").read_text(encoding="utf-8")
    tray_source = (ROOT / "proxy_tray.py").read_text(encoding="utf-8")
    assert "os.startfile" not in restart_source
    assert "os.startfile" not in tray_source
    assert "launch_hidden_vbs(wrapper)" in restart_source
    assert "launch_hidden_vbs(RESTART_VBS)" in tray_source
    print("PASS proxy restart and tray launchers are hidden/no-console")


if __name__ == "__main__":
    main()
