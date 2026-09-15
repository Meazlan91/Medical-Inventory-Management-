#!/bin/bash
# Daily backup script — add to crontab:
# 0 2 * * * /path/to/medical_inventory/backup.sh

DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$DIR/backups"
mkdir -p "$BACKUP_DIR"
TS=$(date +%Y%m%d_%H%M%S)
SRC="$DIR/inventory.db"
DEST="$BACKUP_DIR/inventory_$TS.db"

if [ -f "$SRC" ]; then
    cp "$SRC" "$DEST"
    # Keep last 30 backups
    ls -t "$BACKUP_DIR"/inventory_*.db 2>/dev/null | tail -n +31 | xargs -r rm --
    echo "$(date): Backup created → $DEST"
else
    echo "$(date): No database found at $SRC"
fi
