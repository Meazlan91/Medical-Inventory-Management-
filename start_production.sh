#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"
mkdir -p logs backups
export $(grep -v '^#' .env 2>/dev/null | xargs)
exec gunicorn -c gunicorn.conf.py app:app
