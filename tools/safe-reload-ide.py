"""
safe-reload-ide.py — Safely reload Antigravity IDE windows with rescue safety net.

Sequence:
1. Start rescue relay container on Unraid (safety net)
2. Start rescue proxy locally as background process
3. Wait for rescue proxy to connect and discover sessions
4. Launch the CDP reload script as a detached process
5. The reload script reloads other windows first, then this window last

The rescue proxy ensures that if the VSIX fails to restart after reload,
there's still a proxy connected to the rescue relay that can relay messages
to Claude Code via CDP.

Usage:
    python tools/safe-reload-ide.py
    python tools/safe-reload-ide.py --skip-rescue   # Skip rescue setup (faster)
    python tools/safe-reload-ide.py --rescue-only    # Only start rescue, don't reload
"""

import os
import sys
import time
import subprocess
import signal

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)

# Load .env
_env_path = os.path.join(PROJECT_DIR, '.env')
if os.path.isfile(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())

RELAY_IP = os.environ.get('RELAY_IP', 'localhost')
DEPLOY_HOST = os.environ.get('DEPLOY_HOST')
DEPLOY_USER = os.environ.get('DEPLOY_USER', 'root')
DEPLOY_PASSWORD = os.environ.get('DEPLOY_PASSWORD')
DOCKER_NETWORK = os.environ.get('DEPLOY_DOCKER_NETWORK', 'options-net')


def ssh_exec(cmd, label=''):
    """Execute a command on Unraid via SSH."""
    import paramiko
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(DEPLOY_HOST, username=DEPLOY_USER, password=DEPLOY_PASSWORD, timeout=15)
    try:
        _, stdout, stderr = ssh.exec_command(cmd)
        out = stdout.read().decode().strip()
        err = stderr.read().decode().strip()
        status = stdout.channel.recv_exit_status()
        if label:
            print(f"  [{label}] exit={status}")
        if out:
            print(f"  {out}")
        return status, out, err
    finally:
        ssh.close()


def start_rescue_relay():
    """Start the rescue relay container on Unraid."""
    print("\n[1/4] Starting rescue relay on Unraid...")

    # Remove any existing rescue container
    ssh_exec(
        'docker rm -f agent-relay-rescue 2>/dev/null || true',
        'cleanup'
    )

    # Start fresh
    status, out, err = ssh_exec(
        f'docker run -d --name agent-relay-rescue --network {DOCKER_NETWORK} '
        f'-p 3501:3501 agent-relay-rescue-img',
        'start'
    )
    if status != 0:
        print(f"  ERROR: Failed to start rescue container: {err}")
        return False

    time.sleep(2)

    # Verify health
    status, out, err = ssh_exec(
        'curl -sf http://localhost:3501/',
        'health'
    )
    if status == 0 and 'rescue-relay' in out:
        print("  Rescue relay is healthy.")
        return True
    else:
        print(f"  WARNING: Health check failed: {out}")
        return False


def start_rescue_proxy():
    """Start the rescue proxy as a background process on Windows."""
    print("\n[2/4] Starting rescue proxy (background)...")

    proxy_dir = os.path.join(PROJECT_DIR, 'agent-proxy')
    env = os.environ.copy()
    env['RESCUE_RELAY_URL'] = f'ws://{RELAY_IP}:3501/proxy-ws'

    log_path = os.path.join(proxy_dir, 'rescue-proxy.log')

    with open(log_path, 'w') as log_file:
        proc = subprocess.Popen(
            ['node', 'rescue-proxy.js'],
            cwd=proxy_dir,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
    print(f"  Rescue proxy PID: {proc.pid}")
    print(f"  Logs: {log_path}")

    # Wait for it to connect
    print("  Waiting for rescue proxy to connect...")
    time.sleep(6)

    # Check rescue relay received connection
    status, out, _ = ssh_exec(
        'docker logs agent-relay-rescue --tail 10 2>&1',
        'verify'
    )
    if 'Proxy connected' in out or 'Hello from' in out:
        print("  Rescue proxy connected to relay successfully.")
        return proc.pid
    else:
        print("  WARNING: Rescue proxy may not have connected yet. Proceeding anyway.")
        return proc.pid


def launch_reload():
    """Launch the CDP reload script as a detached process."""
    print("\n[3/4] Launching CDP reload script (detached)...")

    reload_script = os.path.join(SCRIPT_DIR, 'reload-antigravity.js')
    proxy_dir = os.path.join(PROJECT_DIR, 'agent-proxy')
    log_path = os.path.join(PROJECT_DIR, 'reload-ide.log')

    env = os.environ.copy()
    env['CDP_PORT'] = '9223'
    env['SELF_WINDOW_HINT'] = 'Remote Agent Chat'
    env['RELOAD_DELAY_MS'] = '5000'
    env['VERIFY_TIMEOUT_MS'] = '30000'
    # Use the agent-proxy dir as cwd so ws module is available
    env['NODE_PATH'] = os.path.join(proxy_dir, 'node_modules')

    with open(log_path, 'w') as log_file:
        proc = subprocess.Popen(
            ['node', reload_script],
            cwd=proxy_dir,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.DETACHED_PROCESS | subprocess.CREATE_NO_WINDOW,
        )
    print(f"  Reload script PID: {proc.pid}")
    print(f"  Logs: {log_path}")
    return proc.pid


def stop_rescue():
    """Stop the rescue relay container."""
    print("\nStopping rescue relay...")
    ssh_exec('docker stop agent-relay-rescue && docker rm agent-relay-rescue 2>/dev/null || true', 'stop')
    print("  Done.")


def main():
    args = sys.argv[1:]
    skip_rescue = '--skip-rescue' in args
    rescue_only = '--rescue-only' in args

    print("=" * 50)
    print("  SAFE IDE RELOAD")
    print("=" * 50)

    if not skip_rescue:
        if not DEPLOY_PASSWORD:
            print("ERROR: DEPLOY_PASSWORD not set. Check .env file.")
            sys.exit(1)

        ok = start_rescue_relay()
        if not ok:
            print("ABORT: Rescue relay failed to start.")
            sys.exit(1)

        rescue_pid = start_rescue_proxy()

        if rescue_only:
            print("\n[rescue-only] Rescue system is running.")
            print(f"  Rescue proxy PID: {rescue_pid}")
            print("  To stop: docker stop agent-relay-rescue && taskkill /PID {rescue_pid}")
            return

    print("\n[3/4] Ready to reload IDE windows.")
    print("  The reload script will:")
    print("  - Reload Market Tracker window first")
    print("  - Wait for it to come back")
    print("  - Then reload Remote Agent Chat (this window)")
    print("  - Your Claude Code session will restart automatically")

    reload_pid = launch_reload()

    print(f"\n[4/4] Reload script is running (PID {reload_pid}).")
    print("  Monitor progress: type reload-ide.log")
    print("  This window will reload in ~10-15 seconds.")
    if not skip_rescue:
        print(f"\n  If something goes wrong, rescue proxy is running.")
        print(f"  Stop rescue later: python tools/safe-reload-ide.py --stop-rescue")


if __name__ == '__main__':
    if '--stop-rescue' in sys.argv:
        stop_rescue()
        # Also kill any rescue proxy node processes
        print("Killing rescue proxy processes...")
        os.system('taskkill /F /FI "WINDOWTITLE eq Agent*Relay*RESCUE*" 2>NUL')
        # Find rescue proxy by checking command line
        os.system('wmic process where "CommandLine like \'%rescue-proxy%\'" call terminate 2>NUL')
        print("Done.")
    else:
        main()
