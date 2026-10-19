#!/usr/bin/env bash
#
# Restore drill.
#
# Proves the most recent (or a named) backup is actually restorable without
# touching the live database: it drops and recreates a scratch database, loads
# the dump into it, checks that the core tables came back, and verifies the
# object-store archive extracts. The scratch database is `content_os_restore_drill`
# so an operator can never point this at production by accident.
#
# Usage:
#   scripts/restore-drill.sh <backup-dir> [timestamp]
#
# With no timestamp the newest dump in <backup-dir> is used.
#
# Environment:
#   DATABASE_URL   required; only its host/user/password are reused. The
#                  database name is replaced with content_os_restore_drill.
#
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
STAMP="${2:-}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "restore-drill: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v pg_restore >/dev/null 2>&1; then
  echo "restore-drill: pg_restore is not on PATH" >&2
  exit 1
fi

if [[ -z "$STAMP" ]]; then
  db_dump="$(find "$BACKUP_DIR" -name 'content_os-*.dump' -printf '%T@ %p\n' \
    | sort -nr | head -n1 | cut -d' ' -f2-)"
  if [[ -z "$db_dump" ]]; then
    echo "restore-drill: no dump found in $BACKUP_DIR" >&2
    exit 1
  fi
else
  db_dump="$BACKUP_DIR/content_os-$STAMP.dump"
fi

if [[ ! -f "$db_dump" ]]; then
  echo "restore-drill: dump not found: $db_dump" >&2
  exit 1
fi

# Rebuild the connection URL with the drill database name. Strip any query
# parameters so we do not carry the live schema search_path across.
base="${DATABASE_URL%%\?*}"
conn="${base%/*}"
drill_url="$conn/content_os_restore_drill"

# Drop/create via psql against the source database: CREATE/DROP DATABASE cannot
# run inside a transaction, and psql -c keeps each in its own implicit one.
echo "restore-drill: recreating content_os_restore_drill"
psql "$base" -v ON_ERROR_STOP=1 \
  -c 'DROP DATABASE IF EXISTS content_os_restore_drill WITH (FORCE)'
psql "$base" -v ON_ERROR_STOP=1 \
  -c 'CREATE DATABASE content_os_restore_drill'

echo "restore-drill: restoring $db_dump"
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$drill_url" "$db_dump"

echo "restore-drill: verifying core tables"
tables="$(psql "$drill_url" -tAc "select count(*) from information_schema.tables where table_schema = 'public'")"
if [[ "${tables:-0}" -lt 10 ]]; then
  echo "restore-drill: only $tables tables restored; refusing to pass" >&2
  exit 1
fi

users="$(psql "$drill_url" -tAc "select count(*) from \"user\"")"
echo "restore-drill: restored $tables tables, $users rows in \"user\""

storage_tar="$BACKUP_DIR/content-os-storage-${STAMP:-$(basename "$db_dump" | sed -E 's/^content_os-(.*)\.dump$/\1/')}.tar"
if [[ -f "$storage_tar" ]]; then
  echo "restore-drill: verifying storage archive $storage_tar"
  tar -tf "$storage_tar" >/dev/null
  echo "restore-drill: storage archive is readable"
else
  echo "restore-drill: warning: no matching storage archive for this dump" >&2
fi

echo "restore-drill: PASS ($drill_url)"
