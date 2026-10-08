#!/bin/sh
set -e
mkdir -p /backups
while true; do
  STAMP=$(date +%Y%m%d_%H%M%S)
  echo "[backup] start $STAMP"
  pg_dumpall --roles-only -h postgres -U "$PGUSER" | gzip > "/backups/roles_${STAMP}.sql.gz" || true
  pg_dump -h postgres -U "$PGUSER" -d "$POSTGRES_DB" -Fc > "/backups/rfo_${STAMP}.dump"
  echo "[backup] done $STAMP"
  ls -t /backups/rfo_*.dump 2>/dev/null | tail -n +8 | xargs -r rm -f
  ls -t /backups/roles_*.sql.gz 2>/dev/null | tail -n +8 | xargs -r rm -f
  sleep 86400
done
