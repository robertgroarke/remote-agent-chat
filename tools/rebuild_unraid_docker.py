import argparse
import paramiko
import os
import sys
import time

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

RELAY_SKIP = {'node_modules', '__pycache__', '.env', '.gitignore', 'data'}
FRONTEND_SKIP = {'node_modules', '.gitignore', 'src', 'entry.jsx', 'build.js',
                 'package.json', 'package-lock.json', '.gitkeep'}


def sftp_mkdir_p(sftp, remote_path):
    """Recursively create remote directory, ignoring if it already exists."""
    parts = remote_path.replace('\\', '/').split('/')
    path = ''
    for part in parts:
        if not part:
            path = '/'
            continue
        path = f"{path}/{part}" if path != '/' else f"/{part}"
        try:
            sftp.stat(path)
        except FileNotFoundError:
            sftp.mkdir(path)


def sync_dir(sftp, local_dir, remote_dir, skip_names, depth=0):
    """Recursively sync local_dir → remote_dir via SFTP, skipping skip_names."""
    sftp_mkdir_p(sftp, remote_dir)
    ALLOW_DOTFILES = {'.dockerignore'}
    for entry in sorted(os.listdir(local_dir)):
        if entry in skip_names or (entry.startswith('.') and entry not in ALLOW_DOTFILES):
            continue
        local_path = os.path.join(local_dir, entry)
        remote_path = f"{remote_dir}/{entry}"
        if os.path.isdir(local_path):
            sync_dir(sftp, local_path, remote_path, set(), depth + 1)
        else:
            sftp.put(local_path, remote_path)
            indent = '  ' * (depth + 1)
            print(f"{indent}synced {os.path.relpath(local_path, SCRIPT_DIR)}")


def build_frontend():
    """Run esbuild to compile JSX → dist/bundle.js before deploying."""
    import subprocess
    frontend_dir = os.path.join(SCRIPT_DIR, 'frontend')
    print("  Building frontend (esbuild)...")
    result = subprocess.run(['node', 'build.js'], cwd=frontend_dir, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: Frontend build failed:\n{result.stderr}")
        sys.exit(1)
    print(f"  {result.stderr.strip() or 'Build complete.'}")


def sync_files(ssh, do_relay=True):
    sftp = ssh.open_sftp()
    relay_path = os.environ.get('DEPLOY_RELAY_PATH', '/mnt/user/appdata/agent-relay')

    if do_relay:
        print("  Syncing relay-server/...")
        sync_dir(
            sftp,
            os.path.join(SCRIPT_DIR, 'relay-server'),
            relay_path,
            RELAY_SKIP,
        )
        print("  Syncing frontend/...")
        sync_dir(
            sftp,
            os.path.join(SCRIPT_DIR, 'frontend'),
            f'{relay_path}/public',
            FRONTEND_SKIP,
        )

    sftp.close()
    print("File sync complete.\n")


DEPLOY_LOCK = "/tmp/agent-relay-deploy.lock"
LOCK_TIMEOUT = 300


def acquire_lock(ssh):
    deadline = time.time() + LOCK_TIMEOUT
    while time.time() < deadline:
        _, stdout, _ = ssh.exec_command(
            f'set -o noclobber && echo $$ > {DEPLOY_LOCK} 2>/dev/null && echo acquired'
        )
        result = stdout.read().decode().strip()
        if result == 'acquired':
            print("Deploy lock acquired.")
            return
        _, stdout, _ = ssh.exec_command(f'cat {DEPLOY_LOCK} 2>/dev/null || echo unknown')
        holder = stdout.read().decode().strip()
        print(f"Deploy lock held by PID {holder}, waiting…")
        time.sleep(10)
    print(f"ERROR: Could not acquire deploy lock after {LOCK_TIMEOUT}s. Aborting.")
    sys.exit(1)


def release_lock(ssh):
    ssh.exec_command(f'rm -f {DEPLOY_LOCK}')
    print("Deploy lock released.")


def run_ssh_command(do_relay=True, prune=False):
    host     = os.environ.get('DEPLOY_HOST', 'tower')
    user     = os.environ.get('DEPLOY_USER', 'root')
    password = os.environ.get('DEPLOY_PASSWORD')
    if not password:
        print("ERROR: DEPLOY_PASSWORD env var not set. Add it to your shell or a local .env file.")
        sys.exit(1)

    print(f"Connecting to {host}...")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        ssh.connect(host, username=user, password=password, timeout=15)
        acquire_lock(ssh)
        if do_relay:
            build_frontend()
        print("Syncing local files to server...")
        sync_files(ssh, do_relay=do_relay)

        commands = []

        relay_path    = os.environ.get('DEPLOY_RELAY_PATH', '/mnt/user/appdata/agent-relay')
        docker_network = os.environ.get('DEPLOY_DOCKER_NETWORK', 'bridge')

        if do_relay:
            print("Rebuilding agent-relay...")
            commands.append((
                f"cd {relay_path} && "
                "docker rm -f agent-relay || true && "
                f"docker build --build-arg CACHE_BUST={int(time.time())} -f Dockerfile -t agent-relay-img . && "
                "docker run -d --name agent-relay --restart always "
                f"--env-file {relay_path}/.env "
                f"-v {relay_path}/data:/data "
                f"--network {docker_network} -p 3500:3500 agent-relay-img"
            ))

        commands.append(
            "sleep 3 && docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | grep agent-relay"
        )

        if prune:
            commands.append("docker image prune -a -f && docker builder prune -a -f")

        for i, cmd in enumerate(commands):
            print(f"\n--- Running Step {i+1} ---")
            stdin, stdout, stderr = ssh.exec_command(cmd, get_pty=True)
            for line in iter(stdout.readline, ""):
                try:
                    print(line, end="", flush=True)
                except UnicodeEncodeError:
                    pass
            exit_status = stdout.channel.recv_exit_status()
            if exit_status != 0:
                print(f"Step {i+1} failed with exit status: {exit_status}")
                sys.exit(1)

        print("\nAll commands completed successfully.")

    except Exception as e:
        print(f"SSH Error: {e}")
        sys.exit(1)
    finally:
        release_lock(ssh)
        ssh.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Deploy Agent Relay to Unraid")
    parser.add_argument("--relay-only", action="store_true", help="Rebuild relay server only")
    parser.add_argument("--prune", action="store_true", help="Prune unused Docker images after deploy")
    args = parser.parse_args()

    run_ssh_command(do_relay=True, prune=args.prune)
