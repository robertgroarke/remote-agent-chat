"""
deploy_rescue.py — Build and stage the agent-relay-rescue image on Unraid.

The rescue image is built and ready but the container is NOT started automatically.
Start it manually from the Unraid Docker tab when the main relay is down.

Usage:
    python tools/deploy_rescue.py

To start the rescue manually on Unraid:
    docker run -d --name agent-relay-rescue --network options-net -p 3501:3501 agent-relay-rescue-img

On Windows, also start the rescue proxy:
    start-rescue-proxy.bat
"""

import os
import sys
import paramiko

SCRIPT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Load root .env if present (so deploy creds don't need to be in shell env)
_env_path = os.path.join(SCRIPT_DIR, '.env')
if os.path.isfile(_env_path):
    with open(_env_path) as _f:
        for _line in _f:
            _line = _line.strip()
            if _line and not _line.startswith('#') and '=' in _line:
                _k, _v = _line.split('=', 1)
                os.environ.setdefault(_k.strip(), _v.strip())
SKIP       = {'node_modules', '__pycache__', '.gitignore'}
REMOTE_DIR = '/mnt/user/appdata/agent-relay-rescue'


def sftp_mkdir_p(sftp, remote_path):
    parts = remote_path.replace('\\', '/').split('/')
    path  = ''
    for part in parts:
        if not part:
            path = '/'
            continue
        path = f"{path}/{part}" if path != '/' else f"/{part}"
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)


def sync_dir(sftp, local_dir, remote_dir):
    sftp_mkdir_p(sftp, remote_dir)
    for entry in sorted(os.listdir(local_dir)):
        if entry in SKIP or entry.startswith('.'):
            continue
        local_path  = os.path.join(local_dir, entry)
        remote_path = f"{remote_dir}/{entry}"
        if os.path.isdir(local_path):
            sync_dir(sftp, local_path, remote_path)
        else:
            sftp.put(local_path, remote_path)
            print(f"  synced {os.path.relpath(local_path, SCRIPT_DIR)}")


def run(cmd, ssh, label):
    print(f"\n--- {label} ---")
    _, stdout, _ = ssh.exec_command(cmd, get_pty=True)
    for line in iter(stdout.readline, ''):
        try:
            print(line, end='', flush=True)
        except UnicodeEncodeError:
            pass
    status = stdout.channel.recv_exit_status()
    if status != 0:
        print(f"FAILED (exit {status})")
        sys.exit(1)


def deploy():
    host     = os.environ.get('DEPLOY_HOST', 'tower')
    user     = os.environ.get('DEPLOY_USER', 'root')
    password = os.environ.get('DEPLOY_PASSWORD')
    if not password:
        print("ERROR: DEPLOY_PASSWORD env var not set.")
        sys.exit(1)
    relay_ip      = os.environ.get('DEPLOY_HOST', host)
    docker_network = os.environ.get('DEPLOY_DOCKER_NETWORK', 'bridge')

    print(f"Connecting to {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        ssh.connect(host, username=user, password=password, timeout=15)

        print(f"Syncing rescue/relay/ to {REMOTE_DIR} ...")
        sftp = ssh.open_sftp()
        sync_dir(sftp, os.path.join(SCRIPT_DIR, 'rescue', 'relay'), REMOTE_DIR)
        sftp.close()
        print("Sync complete.\n")

        run(
            f"cd {REMOTE_DIR} && "
            "docker rm -f agent-relay-rescue 2>/dev/null || true && "
            "docker build -f Dockerfile -t agent-relay-rescue-img . && "
            "echo 'Image built OK.'",
            ssh,
            "Building rescue image",
        )

        print("\nRescue image ready on server.")
        print("\nTo activate in an emergency:")
        print("  1. On your server, run:")
        print(f"     docker run -d --name agent-relay-rescue --network {docker_network} -p 3501:3501 agent-relay-rescue-img")
        print("  2. On Windows, update RELAY_URL in agent-proxy/.env to point at port 3501 and restart the proxy.")
        print("")
        print(f"Rescue proxy connects on ws://{relay_ip}:3501/proxy-ws (LAN only).")
        print("Claude Code receives the SOS within ~5s of the proxy connecting.")

    except Exception as e:
        print(f"SSH Error: {e}")
        sys.exit(1)
    finally:
        ssh.close()


if __name__ == '__main__':
    deploy()
