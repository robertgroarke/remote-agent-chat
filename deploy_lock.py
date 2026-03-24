"""
deploy_lock.py — file-based mutex for serializing deploys across agents.

Usage:
  # As a wrapper (blocks until lock is free, then runs the deploy):
  python deploy_lock.py python rebuild_unraid_docker.py

  # With a custom timeout (default: 600s / 10 min):
  python deploy_lock.py --timeout 300 python rebuild_unraid_docker.py

  # As a Python context manager in your own script:
  from deploy_lock import DeployLock
  with DeployLock():
      run_deploy()

How it works:
  - Creates a `deploy.lock` file in the project root.
  - Lock file contains JSON: {"pid": ..., "acquired_at": ..., "agent": ...}
  - Polls every 5 seconds until the lock is free.
  - Stale locks (held longer than --stale-after seconds, default 900) are
    broken automatically so a crashed agent never blocks forever.
"""

import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

LOCK_FILE = Path(__file__).parent / "deploy.lock"
POLL_INTERVAL = 5       # seconds between attempts
DEFAULT_TIMEOUT = 600   # max seconds to wait before giving up
DEFAULT_STALE  = 900    # seconds after which a held lock is considered stale


class DeployLockTimeout(Exception):
    pass


class DeployLock:
    def __init__(self, timeout: int = DEFAULT_TIMEOUT, stale_after: int = DEFAULT_STALE,
                 agent: str | None = None):
        self.timeout    = timeout
        self.stale_after = stale_after
        self.agent      = agent or f"pid-{os.getpid()}"
        self._acquired  = False

    # ------------------------------------------------------------------ #
    #  internal helpers                                                    #
    # ------------------------------------------------------------------ #

    def _write_lock(self) -> bool:
        """Attempt an atomic lock-file creation. Returns True on success."""
        payload = json.dumps({
            "pid":         os.getpid(),
            "acquired_at": datetime.now(timezone.utc).isoformat(),
            "agent":       self.agent,
        })
        try:
            # O_CREAT | O_EXCL guarantees atomic create-or-fail on all OSes
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
            return age > self.stale_after
        except (KeyError, ValueError):
            return True   # malformed lock → treat as stale

    def _break_stale_lock(self):
        info = self._read_lock()
        if info and self._is_stale(info):
            print(f"[deploy_lock] Breaking stale lock held by {info.get('agent')} "
                  f"since {info.get('acquired_at')}")
            try:
                LOCK_FILE.unlink()
            except FileNotFoundError:
                pass

    # ------------------------------------------------------------------ #
    #  public API                                                          #
    # ------------------------------------------------------------------ #

    def acquire(self):
        deadline = time.monotonic() + self.timeout
        while True:
            self._break_stale_lock()
            if self._write_lock():
                self._acquired = True
                print(f"[deploy_lock] Lock acquired by {self.agent}")
                return

            info = self._read_lock()
            holder = info.get("agent", "unknown") if info else "unknown"
            since  = info.get("acquired_at", "?")  if info else "?"
            print(f"[deploy_lock] Waiting — held by {holder} since {since} …")

            if time.monotonic() >= deadline:
                raise DeployLockTimeout(
                    f"Could not acquire deploy lock within {self.timeout}s "
                    f"(currently held by {holder})"
                )
            time.sleep(POLL_INTERVAL)

    def release(self):
        if self._acquired:
            try:
                LOCK_FILE.unlink()
            except FileNotFoundError:
                pass
            self._acquired = False
            print(f"[deploy_lock] Lock released by {self.agent}")

    # context manager
    def __enter__(self):
        self.acquire()
        return self

    def __exit__(self, *_):
        self.release()


# ---------------------------------------------------------------------- #
#  CLI wrapper                                                             #
# ---------------------------------------------------------------------- #

def _parse_args(argv: list[str]):
    timeout    = DEFAULT_TIMEOUT
    stale_after = DEFAULT_STALE
    agent      = None
    cmd        = []

    i = 0
    while i < len(argv):
        if argv[i] == "--timeout" and i + 1 < len(argv):
            timeout = int(argv[i + 1]); i += 2
        elif argv[i] == "--stale-after" and i + 1 < len(argv):
            stale_after = int(argv[i + 1]); i += 2
        elif argv[i] == "--agent" and i + 1 < len(argv):
            agent = argv[i + 1]; i += 2
        elif argv[i] == "--":
            cmd = argv[i + 1:]; break
        else:
            # first non-flag token starts the command
            cmd = argv[i:]; break
    return timeout, stale_after, agent, cmd


if __name__ == "__main__":
    timeout, stale_after, agent, cmd = _parse_args(sys.argv[1:])

    if not cmd:
        print(__doc__)
        sys.exit(0)

    lock = DeployLock(timeout=timeout, stale_after=stale_after, agent=agent)
    try:
        lock.acquire()
        result = subprocess.run(cmd)
        sys.exit(result.returncode)
    except DeployLockTimeout as e:
        print(f"[deploy_lock] ERROR: {e}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n[deploy_lock] Interrupted.")
        sys.exit(130)
    finally:
        lock.release()
