# MediStock — Medical Shop Inventory System

A practical inventory and billing app for retail medical shops.  
Manage medicines, sell at the counter, track stock & expiry, record purchases, and view reports — all from the browser.

![Python](https://img.shields.io/badge/Python-3.8+-blue)
![Flask](https://img.shields.io/badge/Flask-3.x-black)
![License](https://img.shields.io/badge/License-MIT-green)

---

## Features

### Inventory
- Full medicine stock (batch, company, type, MRP, rate, quantity)
- Barcode support & composition / salt search
- Low-stock and near-expiry alerts
- Stock adjustment & multi-location (Main / Godown / Shop 2)
- Strip vs unit selling options

### Billing & sales
- Quick Sale mode (scan → qty → pay → print)
- Full billing with discount, GST, payment modes (Cash / UPI / Card / Credit)
- Hold & resume bills
- Doctor name on bill
- Print bill + WhatsApp share
- Returns with stock restore

### Purchases & suppliers
- Purchase entry with auto stock increase
- Supplier outstanding tracking

### Reports & accounts
- Daily / weekly / monthly sales reports
- Payment collection report
- Profit tracking
- Expense entry
- Customer ledger (credit sales)
- CSV export

### Admin & UX
- Login + forgot password
- Change password & simple user accounts
- Admin settings (shop name, bill prefix, thermal 58/80mm)
- One-click backup + automatic daily backup
- Dark mode & larger Counter UI
- Global search (Ctrl+K)
- Keyboard shortcuts (F1–F12)
- Dashboard charts
- Midnight Indigo theme

---

## Tech stack

| Layer    | Technology        |
|----------|-------------------|
| Backend  | Python, Flask     |
| Database | SQLite            |
| Frontend | HTML, CSS, JavaScript |
| Auth     | Session-based login |

---

## Quick start

```bash
# 1. Clone
git clone https://github.com/YOUR_USERNAME/medistock.git
cd medistock

# 2. Install
pip install flask

# 3. Run
python app.py
