#!/bin/sh
# Fix /data volume ownership (host-mounted volumes may be root-owned)
chown -R app:app /data 2>/dev/null || true
# Drop privileges and exec the CMD
exec su-exec app "$@"
