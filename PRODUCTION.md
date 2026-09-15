# MediStock Pro — Production Deployment Guide

## 1. Install dependencies
```bash
cd medical_inventory
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

## 2. Configure environment
```bash
cp .env.example .env
# Edit .env — set a strong SECRET_KEY
```

## 3. First login
- Username: `admin`
- Password: `admin123`
- You **must change password** immediately (enforced)

## 4. Run in production (Linux)
```bash
# Terminal 1 — app
./start_production.sh

# Or:
gunicorn -c gunicorn.conf.py app:app
```

## 5. Nginx + HTTPS
- Copy `nginx.example.conf` and adjust domain
- Get SSL: `certbot --nginx -d your-domain.com`
- Reload nginx

## 6. Daily backup (crontab)
```bash
crontab -e
# Add:
0 2 * * * /full/path/to/medical_inventory/backup.sh >> /full/path/to/medical_inventory/logs/backup.log 2>&1
```

## 7. Windows
```bat
pip install -r requirements.txt
start_medistock.bat
```

## Roles
| Role | Permissions |
|------|-------------|
| admin | Everything + users + delete + backup |
| pharmacist | Inventory, sales, purchases, returns |
| staff | Sales only |

## Security features included
- bcrypt password hashing
- Force password change on first login
- Secure session cookies
- Login rate limiting (5 fails / 15 min)
- Role-based access control
- Soft-delete for medicines
- Audit log
- Automatic backup retention (30 days)
