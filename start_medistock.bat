@echo off
cd /d %~dp0
if not exist logs mkdir logs
if not exist backups mkdir backups
echo Starting MediStock...
python -m gunicorn -c gunicorn.conf.py app:app
pause
