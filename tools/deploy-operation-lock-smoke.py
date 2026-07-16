#!/usr/bin/env python3
"""Cross-worktree deploy/soak operation-lock contract smoke."""

import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from deploy_lock import DeployLock, DeployLockTimeout


with tempfile.TemporaryDirectory(prefix='rac-operation-lock-') as temp_dir:
    lock_path = Path(temp_dir) / 'operation.lock'

    owner = DeployLock(timeout=0, agent='deploy-smoke', lock_file=lock_path)
    owner.acquire()
    payload = json.loads(lock_path.read_text())
    assert payload['pid'] == os.getpid()
    assert payload['kind'] == 'deploy'
    owner.release()
    assert not lock_path.exists()

    lock_path.write_text(json.dumps({
        'pid': os.getpid(),
        'acquired_at': datetime.now(timezone.utc).isoformat(),
        'agent': 'production-overnight-soak',
        'kind': 'production-soak',
    }))
    contender = DeployLock(timeout=0, agent='blocked-deploy', lock_file=lock_path)
    try:
        contender.acquire()
        raise AssertionError('live production soak did not block deploy')
    except DeployLockTimeout as error:
        assert 'deploy is prohibited until the soak exits' in str(error)
    assert lock_path.exists(), 'live soak lock was incorrectly removed'

    lock_path.write_text(json.dumps({
        'pid': 99999999,
        'acquired_at': datetime.now(timezone.utc).isoformat(),
        'agent': 'dead-soak',
        'kind': 'production-soak',
    }))
    recovered = DeployLock(timeout=0, agent='recovered-deploy', lock_file=lock_path)
    recovered.acquire()
    assert json.loads(lock_path.read_text())['agent'] == 'recovered-deploy'
    recovered.release()
    assert not lock_path.exists()

print('deploy operation lock smoke: PASS')
