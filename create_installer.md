# Desktop Installer Guide (Windows / Linux / Mac)

## Option 1: Simple shortcut (easiest)

### Windows
1. Install Python from python.org
2. Open Command Prompt in medical_inventory folder
3. Run: `pip install flask`
4. Create a file `start_medistock.bat`:
```bat
@echo off
cd /d %~dp0
python app.py
pause
```
5. Double-click start_medistock.bat to run

### Linux / Mac
Create `start_medistock.sh`:
```bash
#!/bin/bash
cd "$(dirname "$0")"
python3 app.py
```
chmod +x start_medistock.sh

## Option 2: Standalone EXE with PyInstaller

```bash
pip install pyinstaller flask
pyinstaller --onefile --add-data "templates:templates" --add-data "static:static" --name MediStock app.py
```

The EXE will be in the `dist` folder. Copy templates/ and static/ next to it, or use --add-data carefully.

Note: For production shops, running `python app.py` is usually enough.
