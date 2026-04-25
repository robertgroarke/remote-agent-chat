"""
proxy_restart_lock.py — file-based mutex for safely restarting the agent proxy.

The agent proxy runs as a Windows Scheduled Task (agent-proxy-task) via
restart-proxy.bat, which loops and restarts node index.js automatically after
any crash or kill. This script provides a mutex so multiple agents don't kill
the proxy simultaneously, causing a cascade of restarts and duplicate-proxy
session conflicts.

Usage:
  # Kill the proxy and wait for the scheduled task to bring it back up:
  python proxy_restart_lock.py

  # With a custom agent label (shown in the lock file for diagnostics):
  python proxy_restart_lock.py --agent "my-agent-name"

  # As a Python context manager inside another script:
  from proxy_restart_lock import ProxyRestartLock
  with ProxyRestartLock():
      # proxy is down during this block; it will be back up after __exit__
      pass

How it works:
  1. Acquires proxy_restart.lock (atomic O_CREAT | O_EXCL).
     If another agent holds the lock, polls every 3s until free (or timeout).
  2. Finds all node.exe processes connected outbound to the relay
     (RELAY_IP:RELAY_PORT, set via env vars) and kills them.
  3. Waits up to 30s for the Windows Scheduled Task (agent-proxy-task) to
     spawn a new node.exe that re-establishes the relay connection.
  4. Waits an extra SETTLE_SECS (default 8s) for CDP session discovery to
     complete before releasing the lock.

Stale locks (held > STALE_SECS, default 120s) are broken automatically so a
crashed agent never blocks forever.

IMPORTANT: Never run `node index.js` manually in the agent-proxy directory.
The scheduled task is already running the proxy in a restart loop. Adding a
second process causes duplicate-proxy session conflicts that break session
visibility in the web UI.
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Hide console windows spawned by subprocess on Windows
_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# ─── Load root .env if present ────────────────────────────────────────────────
_env_path = Path(__file__).parent / ".env"
if _env_path.is_file():
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

# ─── Configuration ────────────────────────────────────────────────────────────

LOCK_FILE    = Path(__file__).parent / "proxy_restart.lock"
RELAY_IP     = os.environ.get("RELAY_IP", "localhost")
RELAY_PORT   = os.environ.get("RELAY_PORT", "3500")
POLL_INTERVAL = 3    # seconds between lock-wait polls
DEFAULT_TIMEOUT = 120  # seconds to wait for the lock
STALE_SECS   = 120   # seconds after which a held lock is considered stale
UP_TIMEOUT   = 30    # seconds to wait for proxy to come back up
SETTLE_SECS  = 8     # extra settle time after proxy reconnects


class ProxyRestartTimeout(Exception):
    pass


class ProxyRestartLock:
    def __init__(self, timeout: int = DEFAULT_TIMEOUT, agent: str | None = None):
        self.timeout = timeout
        self.agent   = agent or f"pid-{os.getpid()}"
        self._acquired = False

    # ── Lock file helpers ────────────────────────────────────────────────────

    def _write_lock(self) -> bool:
        payload = json.dumps({
            "pid":         os.getpid(),
            "acquired_at": datetime.now(timezone.utc).isoformat(),
            "agent":       self.agent,
        })
        try:
            fd = os.open(LOCK_FILE, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            with os.fdopen(fd, "w") as f:
                f.write(payload)
            return True
        except FileExistsError:
            return False

    def _read_lock(self) -> dict | None:
        try:
            return json.loads(LOCK_FILE.read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            return None

    def _is_stale(self, info: dict) -> bool:
        try:
            held_since = datetime.fromisoformat(info["acquired_at"])
            age = (datetime.now(timezone.utc) - held_since).total_seconds()
            return age > STALE_SECS
        except (KeyError, ValueError):
            return True

    def _break_stale_lock(self):
        info = self._read_lock()
        if info and self._is_stale(info):
            print(f"[proxy_restart_lock] Breaking stale lock held by "
                  f"{info.get('agent')} since {info.get('acquired_at')}")
            try:
                LOCK_FILE.unlink()
            except FileNotFoundError:
                pass

    def acquire(self):
        deadline = time.monotonic() + self.timeout
        while True:
            self._break_stale_lock()
            if self._write_lock():
                self._acquired = True
                print(f"[proxy_restart_lock] Lock acquired by {self.agent}")
                return
            info = self._read_lock()
            holder = info.get("agent", "unknown") if info else "unknown"
            since  = info.get("acquired_at", "?")  if info else "?"
            print(f"[proxy_restart_lock] Waiting — lock held by {holder} "
                  f"since {since} …")
            if time.monotonic() >= deadline:
                raise ProxyRestartTimeout(
                    f"Could not acquire proxy restart lock within {self.timeout}s "
                    f"(held by {holder})"
                )
            time.sleep(POLL_INTERVAL)

    def release(self):
        if self._acquired:
            try:
                LOCK_FILE.unlink()
            except FileNotFoundError:
                pass
            self._acquired = False
            print(f"[proxy_restart_lock] Lock released by {self.agent}")

    # ── Proxy control helpers ────────────────────────────────────────────────

    @staticmethod
    def _get_relay_pids() -> list[int]:
        """Return PIDs of processes with an established connection to the relay."""
        try:
            out = subprocess.check_output(
                ["netstat", "-ano"],
                text=True, stderr=subprocess.DEVNULL,
                creationflags=_NO_WINDOW,
            )
        except subprocess.CalledProcessError:
            return []
        pids = []
        for line in out.splitlines():
            if RELAY_IP in line and f":{RELAY_PORT}" in line and "ESTABLISHED" in line:
                parts = line.split()
                if parts:
                    try:
                        pids.append(int(parts[-1]))
                    except ValueError:
                        pass
        return list(set(pids))

    @staticmethod
    def _is_node_pid(pid: int) -> bool:
        """Return True if pid is a node.exe process."""
        try:
            result = subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"(Get-Process -Id {pid} -ErrorAction SilentlyContinue).Name"],
                capture_output=True, text=True, timeout=5,
                creationflags=_NO_WINDOW,
            )
            return "node" in result.stdout.lower()
        except Exception:
            return False

    @staticmethod
    def _kill_pid(pid: int):
        """Kill a process by PID using .NET Process.Kill() (bypasses access-denied)."""
        try:
            subprocess.run(
                ["powershell", "-NoProfile", "-Command",
                 f"[System.Diagnostics.Process]::GetProcessById({pid}).Kill()"],
                capture_output=True, timeout=5,
                creationflags=_NO_WINDOW,
            )
            print(f"[proxy_restart_lock] Killed PID {pid}")
        except Exception as e:
            print(f"[proxy_restart_lock] Warning: could not kill PID {pid}: {e}")

    def kill_proxy(self):
        """Kill all node.exe processes connected to the relay."""
        pids = self._get_relay_pids()
        proxy_pids = [p for p in pids if self._is_node_pid(p)]
        if not proxy_pids:
            print("[proxy_restart_lock] No proxy processes found connected to relay.")
            return
        print(f"[proxy_restart_lock] Killing proxy PIDs: {proxy_pids}")
        for pid in proxy_pids:
            self._kill_pid(pid)

    def wait_for_proxy_up(self):
        """
        Wait for the scheduled task to restart the proxy and reconnect to relay.
        The restart-proxy.bat loop waits 5s between restarts, so we allow 30s total.
        """
        print(f"[proxy_restart_lock] Waiting for proxy to come back up "
              f"(up to {UP_TIMEOUT}s)…")
        deadline = time.monotonic() + UP_TIMEOUT
        while time.monotonic() < deadline:
            time.sleep(2)
            pids = self._get_relay_pids()
            node_pids = [p for p in pids if self._is_node_pid(p)]
            if node_pids:
                print(f"[proxy_restart_lock] Proxy back up (PID(s): {node_pids}). "
                      f"Settling for {SETTLE_SECS}s…")
                time.sleep(SETTLE_SECS)
                return
        print(f"[proxy_restart_lock] Warning: proxy did not reconnect within "
              f"{UP_TIMEOUT}s. The Windows Scheduled Task may need attention.")

    # ── Context manager ──────────────────────────────────────────────────────

    def __enter__(self):
        self.acquire()
        self.kill_proxy()
        return self

    def __exit__(self, *_):
        self.wait_for_proxy_up()
        self.release()


# ─── CLI ──────────────────────────────────────────────────────────────────────

def _parse_args(argv: list[str]):
    timeout = DEFAULT_TIMEOUT
    agent   = None
    i = 0
    while i < len(argv):
        if argv[i] == "--timeout" and i + 1 < len(argv):
            timeout = int(argv[i + 1]); i += 2
        elif argv[i] == "--agent" and i + 1 < len(argv):
            agent = argv[i + 1]; i += 2
        else:
            i += 1
    return timeout, agent


if __name__ == "__main__":
    timeout, agent = _parse_args(sys.argv[1:])
    lock = ProxyRestartLock(timeout=timeout, agent=agent)
    try:
        lock.acquire()
        lock.kill_proxy()
        lock.wait_for_proxy_up()
        print("[proxy_restart_lock] Proxy restart complete.")
    except ProxyRestartTimeout as e:
        print(f"[proxy_restart_lock] ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[proxy_restart_lock] Interrupted.")
        sys.exit(130)
    finally:
        lock.release()
