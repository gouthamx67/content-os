#!/usr/bin/env bash
#
# Content OS backup.
#
# A backup is only real if it is restorable, so this writes three things next
# to each other and a manifest that ties them to a checksum:
#   1. a custom-format pg_dump of the whole database
#   2. a tar of the on-disk object store (`CONTENT_OS_STORAGE_PATH`, default
#      `.content-os`), which holds uploaded inputs, renders and captures
#   3. a sha256 manifest for both artifacts
#
# Run `scripts/restore-drill.sh` afterwards to prove the artifacts restore into
# a scratch database without touching the live one.
#
# Usage:
#   scripts/backup.sh [output-dir]
#
# Environment:
#   DATABASE_URL                 required; the database to dump
#   CONTENT_OS_STORAGE_PATH      optional; defaults to ./.content-os
#
set -euo pipefail

OUTPUT_DIR="${1:-./backups}"
STORAGE_DIR="${CONTENT_OS_STORAGE_PATH:-./.content-os}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "backup: DATABASE_URL is not set" >&2
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "backup: pg_dump is not on PATH" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUTPUT_DIR"
db_dump="$OUTPUT_DIR/content_os-$timestamp.dump"
storage_tar="$OUTPUT_DIR/content-os-storage-$timestamp.tar"
manifest="$OUTPUT_DIR/manifest-$timestamp.sha256"

echo "backup: dumping database -> $db_dump"
pg_dump --format=custom --no-owner --no-privileges --file="$db_dump" "$DATABASE_URL"

if [[ -d "$STORAGE_DIR" ]]; then
  echo "backup: archiving storage $STORAGE_DIR -> $storage_tar"
  tar -cf "$storage_tar" -C "$(dirname "$STORAGE_DIR")" "$(basename "$STORAGE_DIR")"
else
  echo "backup: storage dir $STORAGE_DIR absent; writing an empty archive"
  tar -cf "$storage_tar" --files-from /dev/null
fi

echo "backup: writing checksums -> $manifest"
(
  cd "$OUTPUT_DIR"
  sha256sum "$(basename "$db_dump")" "$(basename "$storage_tar")" > "$(basename "$manifest")"
)

echo "backup: complete"
cat "$manifest"
