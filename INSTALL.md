# MediStock — Detailed Installation Guide

Complete step-by-step setup for Windows, Linux, and Mac.

---

## What you need

| Requirement | Details |
|-------------|---------|
| **Computer** | Windows 10/11, Linux, or Mac |
| **Python** | Version **3.8 or higher** |
| **Internet** | Only needed once (to install Python & Flask) |
| **Browser** | Chrome, Edge, Firefox, or Safari |

You do **not** need MySQL, XAMPP, or any other database software.

---

## Part A — Install Python

### Windows

1. Open: https://www.python.org/downloads/
2. Click **Download Python 3.x**
3. Run the installer
4. **Important:** Tick ✅ **“Add python.exe to PATH”** at the bottom
5. Click **Install Now**
6. When finished, open **Command Prompt** (search “cmd”) and type:
   ```bat
   python --version
   ```
   You should see something like `Python 3.12.x`

If you see `'python' is not recognized`:
- Reinstall Python and make sure **Add to PATH** is ticked  
- Or try `py --version` instead of `python --version`

### Linux (Ubuntu / Debian)

```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv -y
python3 --version
```

### Mac

1. Install from https://www.python.org/downloads/  
   **or** with Homebrew:
   ```bash
   brew install python3
   ```
2. Check:
   ```bash
   python3 --version
   ```

---

## Part B — Download MediStock

1. Unzip `medical_inventory.zip`
2. You should see a folder named `medical_inventory` containing:
   ```
   medical_inventory/
   ├── app.py
   ├── requirements.txt
   ├── README.md
   ├── INSTALL.md
   ├── templates/
   └── static/
   ```
3. Remember this folder location (e.g. `Desktop\medical_inventory` or `Documents\medical_inventory`)

---

## Part C — Install MediStock (first time only)

### Windows

1. Open **Command Prompt**
2. Go to the project folder (example):
   ```bat
   cd Desktop\medical_inventory
   ```
   Or if it’s on Desktop:
   ```bat
   cd %USERPROFILE%\Desktop\medical_inventory
   ```
3. Install Flask:
   ```bat
   pip install flask
   ```
   If that fails, try:
   ```bat
   python -m pip install flask
   ```
   or:
   ```bat
   py -m pip install flask
   ```

### Linux / Mac

```bash
cd ~/Desktop/medical_inventory
pip3 install flask
```

---

## Part D — Run MediStock every day

### Windows

```bat
cd Desktop\medical_inventory
python app.py
```

### Linux / Mac

```bash
cd ~/Desktop/medical_inventory
python3 app.py
```

You should see:

```
=======================================================
  MediStock - Medical Shop Inventory
  Login    : admin / admin123
  Recovery : RECOVER123
  URL      : http://127.0.0.1:5000
=======================================================
 * Running on http://127.0.0.1:5000
```

**Leave this window open** while you use the software.

---

## Part E — Open in browser

1. Open Chrome / Edge / Firefox
2. Go to:
   ```
   http://127.0.0.1:5000
   ```
3. Login:
   | Field | Value |
   |-------|--------|
   | Username | `admin` |
   | Password | `admin123` |

---

## Part F — First-time setup (recommended)

1. **Change password**  
   Settings → Change Password (or use Forgot Password)

2. **Shop settings**  
   Settings → Shop Name, Bill Prefix, Thermal width (58mm / 80mm)

3. **Add medicines**  
   Add Medicine → fill Batch, Name, Company, Dates, Rate, MRP, Qty

4. **Optional:** Create a staff user  
   Settings → Users → Add

---

## Forgot Password

1. On login page click **Forgot Password?**
2. Username: `admin`
3. Recovery Code: **`RECOVER123`**
4. Enter new password (min 6 characters)

To change the recovery code later, edit `app.py` and find:
```python
RECOVERY_CODE = os.environ.get('RECOVERY_CODE', 'RECOVER123')
```

---

## Easy shortcuts (optional)

### Windows — double-click to start

Create a file `Start MediStock.bat` inside `medical_inventory` folder:

```bat
@echo off
cd /d "%~dp0"
python app.py
pause
```

Double-click **Start MediStock.bat** whenever you want to open the shop system.

### Linux / Mac — start script

```bash
chmod +x start_production.sh
# Or create:
echo '#!/bin/bash
cd "$(dirname "$0")"
python3 app.py' > start.sh
chmod +x start.sh
./start.sh
```

---

## Stopping the software

- Go to the terminal/command window
- Press **Ctrl + C**
- Close the window

Your data is saved in `inventory.db` automatically.

---

## Backup your data

### Method 1 — from the app
Settings → **Backup Database**

### Method 2 — manual
Copy this file to USB / Google Drive:
```
medical_inventory/inventory.db
```

Do this **daily** if the shop is busy.

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `python is not recognized` | Reinstall Python with **Add to PATH** ticked |
| `No module named flask` | Run `pip install flask` again |
| Login not working | Delete `inventory.db`, restart app, use admin / admin123 |
| Page won’t open | Check terminal shows “Running on http://127.0.0.1:5000” |
| Port already in use | Close other apps using port 5000, or restart PC |
| Old data / errors after update | Delete `inventory.db` and start fresh (backup first!) |
| Browser shows old screen | Press **Ctrl + F5** to hard refresh |

### Reset everything (fresh start)

```bat
cd medical_inventory
del inventory.db
python app.py
```

Linux/Mac:
```bash
cd medical_inventory
rm -f inventory.db
python3 app.py
```

Then login with `admin` / `admin123`.

---

## Using on another computer in the same shop

1. Copy the whole `medical_inventory` folder (including `inventory.db`)
2. Install Python + Flask on the other PC
3. Run `python app.py`
4. On that PC open: `http://127.0.0.1:5000`

> Note: Both PCs cannot use the same `inventory.db` at the same time with this simple setup. For multi-PC access you need a shared database server (advanced).

---

## Network access (same Wi-Fi — advanced)

To open from a phone/tablet on the same Wi-Fi:

1. Find your PC IP address:
   - Windows: `ipconfig` → look for IPv4 Address (e.g. 192.168.1.5)
   - Linux/Mac: `ip a` or `ifconfig`
2. On the phone browser open:
   ```
   http://192.168.1.5:5000
   ```
   (use your actual IP)

Firewall may block it — allow Python through the firewall if needed.

---

## Uninstall

1. Stop the app (Ctrl+C)
2. Delete the `medical_inventory` folder  
   That’s all — nothing is installed system-wide except Python/Flask if you choose to remove those too.

---

## Quick reference card

```
START     →  python app.py
OPEN      →  http://127.0.0.1:5000
LOGIN     →  admin / admin123
RECOVERY  →  RECOVER123
STOP      →  Ctrl + C
BACKUP    →  Copy inventory.db  OR  Settings → Backup
```

---

Need help? Check that:
1. Python is installed (`python --version`)
2. Flask is installed (`pip install flask`)
3. You are inside the `medical_inventory` folder
4. Terminal shows “Running on http://127.0.0.1:5000”
