"""
MediStock - Medical Shop Inventory System (Feature Complete)
"""
from flask import Flask, render_template, request, jsonify, redirect, url_for, session, Response
from datetime import datetime, date, timedelta
from functools import wraps
import sqlite3, os, hashlib, json, csv, io

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'medistock-dev-secret-key')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE = os.path.join(BASE_DIR, 'inventory.db')
LOW_STOCK_THRESHOLD = 10
DEFAULT_GST_RATE = 12.0
RECOVERY_CODE = os.environ.get('RECOVERY_CODE', 'RECOVER123')


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password):
    try:
        import bcrypt
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    except Exception:
        return 'sha256$' + hashlib.sha256(password.encode()).hexdigest()


def check_password(password, password_hash):
    if not password_hash:
        return False
    if password_hash.startswith('$2'):
        try:
            import bcrypt
            return bcrypt.checkpw(password.encode(), password_hash.encode())
        except Exception:
            return False
    if password_hash.startswith('sha256$'):
        return password_hash == 'sha256$' + hashlib.sha256(password.encode()).hexdigest()
    return password_hash == hashlib.sha256(password.encode()).hexdigest()


def log_audit(action, entity_type=None, entity_id=None, details=None):
    try:
        conn = get_db()
        conn.execute(
            'INSERT INTO audit_log (user_id, username, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)',
            (session.get('user_id'), session.get('username', 'system'), action,
             entity_type, entity_id, json.dumps(details) if details else None))
        conn.commit()
        conn.close()
    except Exception:
        pass



def auto_backup_if_needed():
    try:
        from pathlib import Path as P
        import shutil
        backup_dir = P(BASE_DIR) / 'backups'
        backup_dir.mkdir(exist_ok=True)
        today_s = date.today().isoformat()
        marker = backup_dir / ('.backup_' + today_s)
        if marker.exists():
            return
        if not P(DATABASE).exists():
            return
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        shutil.copy2(DATABASE, backup_dir / ('inventory_auto_' + ts + '.db'))
        marker.write_text('ok')
        autos = sorted(backup_dir.glob('inventory_auto_*.db'), reverse=True)
        for oldb in autos[14:]:
            oldb.unlink(missing_ok=True)
    except Exception:
        pass

def get_setting(key, default=''):
    conn = get_db()
    row = conn.execute('SELECT value FROM settings WHERE key=?', (key,)).fetchone()
    conn.close()
    return row['value'] if row else default


def set_setting(key, value):
    conn = get_db()
    conn.execute('INSERT OR REPLACE INTO settings (key, value) VALUES (?,?)', (key, str(value)))
    conn.commit()
    conn.close()


def init_db():
    conn = get_db()
    c = conn.cursor()
    c.executescript('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT NOT NULL,
            role TEXT DEFAULT 'staff',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS medicines (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            batch_number TEXT NOT NULL,
            name TEXT NOT NULL,
            company_name TEXT NOT NULL,
            medicine_type TEXT NOT NULL,
            composition TEXT,
            barcode TEXT,
            hsn_code TEXT DEFAULT '3004',
            gst_rate REAL DEFAULT 12.0,
            mfg_date TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            rate REAL NOT NULL,
            mrp REAL NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 0,
            reorder_level INTEGER DEFAULT 10,
            location TEXT DEFAULT 'Main',
            pack_size INTEGER DEFAULT 1,
            units_per_strip INTEGER DEFAULT 10,
            sell_unit TEXT DEFAULT 'unit',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS customers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, phone TEXT, address TEXT,
            balance REAL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL, phone TEXT, address TEXT,
            balance REAL DEFAULT 0,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            bill_no TEXT UNIQUE NOT NULL,
            customer_id INTEGER, customer_name TEXT,
            doctor_name TEXT,
            payment_mode TEXT DEFAULT 'Cash',
            subtotal REAL DEFAULT 0, discount REAL DEFAULT 0,
            gst_amount REAL DEFAULT 0, total_amount REAL NOT NULL,
            total_items INTEGER NOT NULL, total_profit REAL DEFAULT 0,
            created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS sale_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sale_id INTEGER NOT NULL, medicine_id INTEGER NOT NULL,
            medicine_name TEXT NOT NULL, batch_number TEXT,
            quantity INTEGER NOT NULL, unit_price REAL NOT NULL,
            rate REAL DEFAULT 0, gst_rate REAL DEFAULT 12,
            discount REAL DEFAULT 0, total_price REAL NOT NULL, profit REAL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS returns (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            return_no TEXT UNIQUE NOT NULL, sale_id INTEGER, bill_no TEXT,
            customer_name TEXT, total_amount REAL NOT NULL, reason TEXT,
            created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS return_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            return_id INTEGER NOT NULL, medicine_id INTEGER,
            medicine_name TEXT, batch_number TEXT,
            quantity INTEGER NOT NULL, unit_price REAL, total_price REAL
        );
        CREATE TABLE IF NOT EXISTS purchases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_no TEXT UNIQUE NOT NULL,
            supplier_id INTEGER, supplier_name TEXT,
            total_amount REAL NOT NULL, total_items INTEGER NOT NULL,
            notes TEXT, created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS purchase_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            purchase_id INTEGER NOT NULL, medicine_id INTEGER,
            medicine_name TEXT, batch_number TEXT,
            quantity INTEGER NOT NULL, rate REAL NOT NULL, mrp REAL, total REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS held_bills (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ref_no TEXT UNIQUE NOT NULL,
            customer_name TEXT, notes TEXT,
            cart_json TEXT NOT NULL,
            created_by INTEGER, created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL, amount REAL NOT NULL,
            category TEXT DEFAULT 'General', notes TEXT,
            expense_date TEXT, created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS stock_adjustments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            medicine_id INTEGER, medicine_name TEXT, batch_number TEXT,
            old_qty INTEGER, new_qty INTEGER, difference INTEGER,
            reason TEXT, created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY, value TEXT
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER, username TEXT, action TEXT NOT NULL,
            entity_type TEXT, entity_id INTEGER, details TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
    ''')
    for table, col, typedef in [
        ('medicines', 'composition', 'TEXT'),
        ('medicines', 'pack_size', 'INTEGER DEFAULT 1'),
        ('medicines', 'units_per_strip', 'INTEGER DEFAULT 10'),
        ('medicines', 'sell_unit', "TEXT DEFAULT 'unit'"),
        ('sales', 'doctor_name', 'TEXT'),
        ('medicines', 'barcode', 'TEXT'),
        ('medicines', 'hsn_code', "TEXT DEFAULT '3004'"),
        ('medicines', 'gst_rate', 'REAL DEFAULT 12.0'),
        ('medicines', 'reorder_level', 'INTEGER DEFAULT 10'),
        ('medicines', 'location', "TEXT DEFAULT 'Main'"),
        ('sales', 'payment_mode', "TEXT DEFAULT 'Cash'"),
        ('sales', 'subtotal', 'REAL DEFAULT 0'),
        ('sales', 'discount', 'REAL DEFAULT 0'),
        ('sales', 'gst_amount', 'REAL DEFAULT 0'),
        ('sales', 'total_profit', 'REAL DEFAULT 0'),
        ('sales', 'customer_id', 'INTEGER'),
        ('suppliers', 'balance', 'REAL DEFAULT 0'),
    ]:
        try:
            c.execute(f'ALTER TABLE {table} ADD COLUMN {col} {typedef}')
        except Exception:
            pass

    defaults = {
        'shop_name': 'MediStock Medical Shop',
        'bill_prefix': 'BILL',
        'thermal_width': '80',
        'shop_phone': '',
        'shop_address': '',
    }
    for k, v in defaults.items():
        if not c.execute('SELECT key FROM settings WHERE key=?', (k,)).fetchone():
            c.execute('INSERT INTO settings (key, value) VALUES (?,?)', (k, v))

    if not c.execute('SELECT id FROM users WHERE username=?', ('admin',)).fetchone():
        c.execute('INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
                  ('admin', hash_password('admin123'), 'Shop Owner', 'admin'))
    conn.commit()
    conn.close()


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'user_id' not in session:
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Authentication required'}), 401
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return decorated


def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if session.get('role') != 'admin':
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Admin only'}), 403
            return redirect(url_for('index'))
        return f(*args, **kwargs)
    return decorated


# ==================== AUTH ====================
@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('index'))
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        username = (data.get('username') or '').strip()
        password = data.get('password') or ''
        conn = get_db()
        user = conn.execute('SELECT * FROM users WHERE username=?', (username,)).fetchone()
        conn.close()
        if user and check_password(password, user['password_hash']):
            session.clear()
            session['user_id'] = user['id']
            session['username'] = user['username']
            session['full_name'] = user['full_name']
            session['role'] = user['role']
            log_audit('LOGIN', 'user', user['id'])
            if request.is_json:
                return jsonify({'message': 'OK', 'user': user['full_name'], 'role': user['role']})
            return redirect(url_for('index'))
        msg = 'Invalid username or password'
        if request.is_json:
            return jsonify({'error': msg}), 401
        return render_template('login.html', error=msg)
    return render_template('login.html')


@app.route('/logout')
def logout():
    log_audit('LOGOUT', 'user', session.get('user_id'))
    session.clear()
    return redirect(url_for('login'))


@app.route('/forgot-password', methods=['GET', 'POST'])
def forgot_password():
    if request.method == 'POST':
        data = request.get_json() if request.is_json else request.form
        username = (data.get('username') or '').strip()
        recovery = (data.get('recovery_code') or '').strip()
        new_pass = data.get('new_password') or ''
        confirm = data.get('confirm_password') or ''
        if recovery != RECOVERY_CODE:
            msg = 'Invalid recovery code'
            return jsonify({'error': msg}), 400 if request.is_json else render_template('forgot_password.html', error=msg)
        if len(new_pass) < 6 or new_pass != confirm:
            msg = 'Password min 6 chars and must match'
            return jsonify({'error': msg}), 400 if request.is_json else render_template('forgot_password.html', error=msg)
        conn = get_db()
        user = conn.execute('SELECT id FROM users WHERE username=?', (username,)).fetchone()
        if not user:
            conn.close()
            msg = 'Username not found'
            return jsonify({'error': msg}), 404 if request.is_json else render_template('forgot_password.html', error=msg)
        conn.execute('UPDATE users SET password_hash=? WHERE id=?', (hash_password(new_pass), user['id']))
        conn.commit()
        conn.close()
        if request.is_json:
            return jsonify({'message': 'Password reset successful. Please login.'})
        return redirect(url_for('login'))
    return render_template('forgot_password.html')


@app.route('/api/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json() or {}
    current, new_pass = data.get('current_password', ''), data.get('new_password', '')
    if len(new_pass) < 6:
        return jsonify({'error': 'Min 6 characters'}), 400
    conn = get_db()
    user = conn.execute('SELECT * FROM users WHERE id=?', (session['user_id'],)).fetchone()
    if not user or not check_password(current, user['password_hash']):
        conn.close()
        return jsonify({'error': 'Current password incorrect'}), 400
    conn.execute('UPDATE users SET password_hash=? WHERE id=?', (hash_password(new_pass), session['user_id']))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Password changed'})


@app.route('/api/me')
@login_required
def get_me():
    return jsonify({'id': session['user_id'], 'username': session['username'],
                    'full_name': session['full_name'], 'role': session['role']})


# ==================== PAGES ====================
@app.route('/')
@login_required
def index():
    return render_template('index.html', user_name=session.get('full_name', 'User'),
                           user_role=session.get('role', 'staff'))


@app.route('/catalog')
def catalog():
    return render_template('catalog.html')


# ==================== SETTINGS ====================
@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    conn = get_db()
    rows = conn.execute('SELECT key, value FROM settings').fetchall()
    conn.close()
    return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['POST'])
@login_required
@admin_required
def save_settings():
    data = request.get_json() or {}
    for k, v in data.items():
        set_setting(k, v)
    log_audit('UPDATE', 'settings')
    return jsonify({'message': 'Settings saved'})


@app.route('/api/backup', methods=['POST'])
@login_required
@admin_required
def backup_db():
    import shutil
    from pathlib import Path
    backup_dir = Path(BASE_DIR) / 'backups'
    backup_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    dest = backup_dir / f'inventory_{ts}.db'
    shutil.copy2(DATABASE, dest)
    log_audit('BACKUP', 'system', details={'file': dest.name})
    return jsonify({'message': 'Backup created', 'file': dest.name})


# ==================== USERS ====================
@app.route('/api/users', methods=['GET'])
@login_required
@admin_required
def get_users():
    conn = get_db()
    rows = conn.execute('SELECT id, username, full_name, role, created_at FROM users').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/users', methods=['POST'])
@login_required
@admin_required
def add_user():
    data = request.get_json() or {}
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''
    full_name = (data.get('full_name') or '').strip()
    role = data.get('role', 'staff')
    if role not in ('admin', 'staff'):
        role = 'staff'
    if not username or len(password) < 6 or not full_name:
        return jsonify({'error': 'Username, full name, password (6+) required'}), 400
    conn = get_db()
    try:
        cur = conn.execute(
            'INSERT INTO users (username, password_hash, full_name, role) VALUES (?,?,?,?)',
            (username, hash_password(password), full_name, role))
        conn.commit()
        uid = cur.lastrowid
    except sqlite3.IntegrityError:
        conn.close()
        return jsonify({'error': 'Username already exists'}), 400
    conn.close()
    log_audit('CREATE', 'user', uid, {'username': username})
    return jsonify({'message': 'User created', 'id': uid}), 201


# ==================== MEDICINES ====================
@app.route('/api/medicines', methods=['GET'])
@login_required
def get_medicines():
    search = request.args.get('search', '').strip()
    med_type = request.args.get('type', '').strip()
    filter_expiry = request.args.get('expiry', '').strip()
    filter_stock = request.args.get('stock', '').strip()
    location = request.args.get('location', '').strip()
    composition = request.args.get('composition', '').strip()

    conn = get_db()
    query = 'SELECT * FROM medicines WHERE 1=1'
    params = []
    if search:
        query += ''' AND (name LIKE ? OR company_name LIKE ? OR batch_number LIKE ?
                     OR IFNULL(barcode,"") LIKE ? OR IFNULL(composition,"") LIKE ?)'''
        params.extend([f'%{search}%'] * 5)
    if composition:
        query += ' AND composition LIKE ?'
        params.append(f'%{composition}%')
    if med_type:
        query += ' AND medicine_type=?'
        params.append(med_type)
    if location:
        query += ' AND location=?'
        params.append(location)
    if filter_stock == 'low':
        query += ' AND quantity > 0 AND quantity <= COALESCE(reorder_level, ?)'
        params.append(LOW_STOCK_THRESHOLD)
    elif filter_stock == 'out':
        query += ' AND quantity = 0'
    query += ' ORDER BY name ASC, expiry_date ASC'
    rows = conn.execute(query, params).fetchall()
    conn.close()

    today = date.today()
    medicines = []
    for row in rows:
        med = dict(row)
        try:
            days = (datetime.strptime(med['expiry_date'], '%Y-%m-%d').date() - today).days
            med['status'] = 'expired' if days < 0 else 'expiring_soon' if days <= 30 else 'expiring_90' if days <= 90 else 'valid'
            med['days_left'] = days
        except Exception:
            med['status'] = 'unknown'
            med['days_left'] = None
        rl = med.get('reorder_level') or LOW_STOCK_THRESHOLD
        med['low_stock'] = 0 < med['quantity'] <= rl
        med['profit_per_unit'] = round(float(med['mrp']) - float(med['rate']), 2)
        if filter_expiry:
            if filter_expiry == 'expiring_90' and med['status'] not in ('expiring_soon', 'expiring_90'):
                continue
            elif filter_expiry == 'near' and med['status'] not in ('expired', 'expiring_soon', 'expiring_90'):
                continue
            elif filter_expiry not in ('expiring_90', 'near') and med['status'] != filter_expiry:
                continue
        medicines.append(med)
    return jsonify(medicines)


@app.route('/api/medicines', methods=['POST'])
@login_required
def add_medicine():
    data = request.get_json()
    required = ['batch_number', 'name', 'company_name', 'medicine_type', 'mfg_date', 'expiry_date', 'rate', 'mrp', 'quantity']
    for f in required:
        if not str(data.get(f, '')).strip():
            return jsonify({'error': f'{f} required'}), 400
    try:
        rate, mrp, qty = float(data['rate']), float(data['mrp']), int(data['quantity'])
        gst = float(data.get('gst_rate', DEFAULT_GST_RATE))
    except (ValueError, TypeError):
        return jsonify({'error': 'Invalid number'}), 400
    conn = get_db()
    cur = conn.execute(
        '''INSERT INTO medicines (batch_number,name,company_name,medicine_type,composition,barcode,hsn_code,gst_rate,
           mfg_date,expiry_date,rate,mrp,quantity,reorder_level,location)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)''',
        (data['batch_number'].strip(), data['name'].strip(), data['company_name'].strip(), data['medicine_type'],
         data.get('composition', '').strip() or None, data.get('barcode', '').strip() or None,
         data.get('hsn_code', '3004'), gst, data['mfg_date'], data['expiry_date'], rate, mrp, qty,
         int(data.get('reorder_level', 10)), data.get('location', 'Main')))
    conn.commit()
    nid = cur.lastrowid
    conn.close()
    log_audit('CREATE', 'medicine', nid, {'name': data['name']})
    return jsonify({'message': 'Added', 'id': nid}), 201


@app.route('/api/medicines/<int:med_id>', methods=['PUT'])
@login_required
def update_medicine(med_id):
    data = request.get_json()
    try:
        rate, mrp, qty = float(data['rate']), float(data['mrp']), int(data['quantity'])
        gst = float(data.get('gst_rate', DEFAULT_GST_RATE))
    except (ValueError, TypeError, KeyError):
        return jsonify({'error': 'Invalid data'}), 400
    conn = get_db()
    if not conn.execute('SELECT id FROM medicines WHERE id=?', (med_id,)).fetchone():
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    conn.execute(
        '''UPDATE medicines SET batch_number=?,name=?,company_name=?,medicine_type=?,composition=?,barcode=?,
           hsn_code=?,gst_rate=?,mfg_date=?,expiry_date=?,rate=?,mrp=?,quantity=?,reorder_level=?,location=?,
           updated_at=CURRENT_TIMESTAMP WHERE id=?''',
        (data['batch_number'].strip(), data['name'].strip(), data['company_name'].strip(), data['medicine_type'],
         data.get('composition', '').strip() or None, data.get('barcode', '').strip() or None,
         data.get('hsn_code', '3004'), gst, data['mfg_date'], data['expiry_date'], rate, mrp, qty,
         int(data.get('reorder_level', 10)), data.get('location', 'Main'), med_id))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Updated'})


@app.route('/api/medicines/<int:med_id>', methods=['DELETE'])
@login_required
def delete_medicine(med_id):
    conn = get_db()
    row = conn.execute('SELECT name FROM medicines WHERE id=?', (med_id,)).fetchone()
    if not row:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    conn.execute('DELETE FROM medicines WHERE id=?', (med_id,))
    conn.commit()
    conn.close()
    log_audit('DELETE', 'medicine', med_id, {'name': row['name']})
    return jsonify({'message': 'Deleted'})


@app.route('/api/medicines/barcode/<barcode>')
@login_required
def get_by_barcode(barcode):
    conn = get_db()
    row = conn.execute(
        'SELECT * FROM medicines WHERE barcode=? AND quantity>0 ORDER BY expiry_date LIMIT 1',
        (barcode.strip(),)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(dict(row))


@app.route('/api/global-search')
@login_required
def global_search():
    q = request.args.get('q', '').strip()
    if len(q) < 1:
        return jsonify({'medicines': [], 'sales': [], 'customers': []})
    conn = get_db()
    meds = conn.execute(
        '''SELECT id, name, batch_number, quantity, mrp FROM medicines
           WHERE name LIKE ? OR batch_number LIKE ? OR IFNULL(composition,"") LIKE ? OR IFNULL(barcode,"") LIKE ?
           LIMIT 10''', (f'%{q}%', f'%{q}%', f'%{q}%', f'%{q}%')).fetchall()
    sales = conn.execute(
        'SELECT id, bill_no, customer_name, total_amount, created_at FROM sales WHERE bill_no LIKE ? OR customer_name LIKE ? LIMIT 5',
        (f'%{q}%', f'%{q}%')).fetchall()
    customers = conn.execute(
        'SELECT id, name, phone, balance FROM customers WHERE name LIKE ? OR phone LIKE ? LIMIT 5',
        (f'%{q}%', f'%{q}%')).fetchall()
    conn.close()
    return jsonify({
        'medicines': [dict(r) for r in meds],
        'sales': [dict(r) for r in sales],
        'customers': [dict(r) for r in customers]
    })


# ==================== STOCK ADJUSTMENT & BATCH MERGE ====================
@app.route('/api/stock-adjust', methods=['POST'])
@login_required
def stock_adjust():
    data = request.get_json()
    med_id = data.get('medicine_id')
    new_qty = int(data.get('new_quantity', 0))
    reason = data.get('reason', 'Manual adjustment')
    conn = get_db()
    med = conn.execute('SELECT * FROM medicines WHERE id=?', (med_id,)).fetchone()
    if not med:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    old_qty = med['quantity']
    conn.execute('UPDATE medicines SET quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (new_qty, med_id))
    conn.execute(
        '''INSERT INTO stock_adjustments (medicine_id,medicine_name,batch_number,old_qty,new_qty,difference,reason,created_by)
           VALUES (?,?,?,?,?,?,?,?)''',
        (med_id, med['name'], med['batch_number'], old_qty, new_qty, new_qty - old_qty, reason, session['user_id']))
    conn.commit()
    conn.close()
    log_audit('STOCK_ADJUST', 'medicine', med_id, {'old': old_qty, 'new': new_qty})
    return jsonify({'message': 'Stock adjusted', 'old': old_qty, 'new': new_qty})


@app.route('/api/batch-merge', methods=['POST'])
@login_required
def batch_merge():
    data = request.get_json()
    source_id = data.get('source_id')  # merge FROM this (will be deleted/zeroed)
    target_id = data.get('target_id')  # merge INTO this
    conn = get_db()
    src = conn.execute('SELECT * FROM medicines WHERE id=?', (source_id,)).fetchone()
    tgt = conn.execute('SELECT * FROM medicines WHERE id=?', (target_id,)).fetchone()
    if not src or not tgt:
        conn.close()
        return jsonify({'error': 'Medicine not found'}), 404
    if src['name'].lower() != tgt['name'].lower():
        conn.close()
        return jsonify({'error': 'Can only merge same medicine name'}), 400
    new_qty = src['quantity'] + tgt['quantity']
    # Keep nearer expiry on target
    try:
        if src['expiry_date'] < tgt['expiry_date']:
            conn.execute('UPDATE medicines SET quantity=?, expiry_date=?, batch_number=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                         (new_qty, src['expiry_date'], src['batch_number'] + '+' + tgt['batch_number'], target_id))
        else:
            conn.execute('UPDATE medicines SET quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (new_qty, target_id))
    except Exception:
        conn.execute('UPDATE medicines SET quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?', (new_qty, target_id))
    conn.execute('UPDATE medicines SET quantity=0, updated_at=CURRENT_TIMESTAMP WHERE id=?', (source_id,))
    conn.commit()
    conn.close()
    log_audit('BATCH_MERGE', 'medicine', target_id, {'from': source_id, 'to': target_id, 'qty': new_qty})
    return jsonify({'message': 'Batches merged', 'new_quantity': new_qty})


# ==================== STATS ====================
@app.route('/api/stats')
@login_required
def get_stats():
    auto_backup_if_needed()
    conn = get_db()
    total = conn.execute('SELECT COUNT(*) c FROM medicines').fetchone()['c']
    total_qty = conn.execute('SELECT COALESCE(SUM(quantity),0) q FROM medicines').fetchone()['q']
    total_value = conn.execute('SELECT COALESCE(SUM(rate*quantity),0) v FROM medicines').fetchone()['v']
    low_stock = conn.execute(
        'SELECT COUNT(*) c FROM medicines WHERE quantity>0 AND quantity<=COALESCE(reorder_level,?)',
        (LOW_STOCK_THRESHOLD,)).fetchone()['c']
    out_of_stock = conn.execute('SELECT COUNT(*) c FROM medicines WHERE quantity=0').fetchone()['c']
    rows = conn.execute('SELECT expiry_date FROM medicines').fetchall()
    today = date.today()
    expired = expiring_soon = expiring_90 = 0
    for r in rows:
        try:
            d = (datetime.strptime(r['expiry_date'], '%Y-%m-%d').date() - today).days
            if d < 0: expired += 1
            elif d <= 30: expiring_soon += 1
            elif d <= 90: expiring_90 += 1
        except Exception:
            pass
    ts = today.isoformat()
    today_s = conn.execute(
        "SELECT COALESCE(SUM(total_amount),0) t, COALESCE(SUM(total_profit),0) p, COUNT(*) c FROM sales WHERE date(created_at)=?",
        (ts,)).fetchone()
    month_s = conn.execute(
        "SELECT COALESCE(SUM(total_amount),0) t, COALESCE(SUM(total_profit),0) p, COUNT(*) c FROM sales WHERE date(created_at)>=?",
        (today.replace(day=1).isoformat(),)).fetchone()
    conn.close()
    return jsonify({
        'total_items': total, 'total_quantity': total_qty, 'total_value': round(total_value, 2),
        'expired': expired, 'expiring_soon': expiring_soon, 'expiring_90': expiring_90,
        'low_stock': low_stock, 'out_of_stock': out_of_stock,
        'today_sales_amount': round(today_s['t'], 2), 'today_sales_count': today_s['c'],
        'today_profit': round(today_s['p'], 2),
        'month_sales_amount': round(month_s['t'], 2), 'month_sales_count': month_s['c'],
        'month_profit': round(month_s['p'], 2), 'low_stock_threshold': LOW_STOCK_THRESHOLD
    })


@app.route('/api/reports/sales')
@login_required
def sales_report():
    period = request.args.get('period', 'today')
    today = date.today()
    if period == 'today':
        from_date = to_date = today.isoformat()
    elif period == 'week':
        from_date, to_date = (today - timedelta(days=7)).isoformat(), today.isoformat()
    elif period == 'month':
        from_date, to_date = today.replace(day=1).isoformat(), today.isoformat()
    else:
        from_date = request.args.get('from') or today.isoformat()
        to_date = request.args.get('to') or today.isoformat()
    conn = get_db()
    sales = conn.execute(
        '''SELECT s.*, u.full_name as created_by_name FROM sales s LEFT JOIN users u ON s.created_by=u.id
           WHERE date(s.created_at) BETWEEN ? AND ? ORDER BY s.created_at DESC''', (from_date, to_date)).fetchall()
    summary = conn.execute(
        '''SELECT COUNT(*) bills, COALESCE(SUM(total_amount),0) revenue, COALESCE(SUM(total_profit),0) profit,
           COALESCE(SUM(discount),0) total_discount, COALESCE(SUM(gst_amount),0) total_gst,
           COALESCE(SUM(total_items),0) items_sold FROM sales WHERE date(created_at) BETWEEN ? AND ?''',
        (from_date, to_date)).fetchone()
    top = conn.execute(
        '''SELECT si.medicine_name, SUM(si.quantity) qty, SUM(si.total_price) amount, SUM(si.profit) profit
           FROM sale_items si JOIN sales s ON si.sale_id=s.id WHERE date(s.created_at) BETWEEN ? AND ?
           GROUP BY si.medicine_name ORDER BY qty DESC LIMIT 10''', (from_date, to_date)).fetchall()
    modes = conn.execute(
        '''SELECT payment_mode, COUNT(*) count, SUM(total_amount) amount FROM sales
           WHERE date(created_at) BETWEEN ? AND ? GROUP BY payment_mode''', (from_date, to_date)).fetchall()
    conn.close()
    return jsonify({'from': from_date, 'to': to_date, 'summary': dict(summary),
                    'sales': [dict(s) for s in sales], 'top_medicines': [dict(t) for t in top],
                    'payment_modes': [dict(m) for m in modes]})


@app.route('/api/reports/export')
@login_required
def export_report():
    period = request.args.get('period', 'month')
    today = date.today()
    if period == 'today':
        from_date = to_date = today.isoformat()
    elif period == 'week':
        from_date, to_date = (today - timedelta(days=7)).isoformat(), today.isoformat()
    else:
        from_date, to_date = today.replace(day=1).isoformat(), today.isoformat()
    conn = get_db()
    sales = conn.execute(
        '''SELECT bill_no, customer_name, payment_mode, subtotal, discount, gst_amount,
           total_amount, total_profit, total_items, created_at FROM sales
           WHERE date(created_at) BETWEEN ? AND ? ORDER BY created_at''', (from_date, to_date)).fetchall()
    conn.close()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(['Bill No', 'Customer', 'Payment', 'Subtotal', 'Discount', 'GST', 'Total', 'Profit', 'Items', 'Date'])
    for s in sales:
        writer.writerow([s['bill_no'], s['customer_name'], s['payment_mode'], s['subtotal'],
                         s['discount'], s['gst_amount'], s['total_amount'], s['total_profit'],
                         s['total_items'], s['created_at']])
    output.seek(0)
    return Response(output.getvalue(), mimetype='text/csv',
                    headers={'Content-Disposition': f'attachment; filename=sales_{from_date}_{to_date}.csv'})


# ==================== CUSTOMERS ====================
@app.route('/api/customers', methods=['GET'])
@login_required
def get_customers():
    search = request.args.get('search', '').strip()
    conn = get_db()
    if search:
        rows = conn.execute('SELECT * FROM customers WHERE name LIKE ? OR phone LIKE ? ORDER BY name',
                            (f'%{search}%', f'%{search}%')).fetchall()
    else:
        rows = conn.execute('SELECT * FROM customers ORDER BY name').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/customers', methods=['POST'])
@login_required
def add_customer():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    conn = get_db()
    cur = conn.execute('INSERT INTO customers (name, phone, address) VALUES (?,?,?)',
                       (name, data.get('phone', ''), data.get('address', '')))
    conn.commit()
    cid = cur.lastrowid
    conn.close()
    return jsonify({'message': 'Added', 'id': cid}), 201


@app.route('/api/customers/<int:cid>/ledger')
@login_required
def customer_ledger(cid):
    conn = get_db()
    cust = conn.execute('SELECT * FROM customers WHERE id=?', (cid,)).fetchone()
    if not cust:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    sales = conn.execute('SELECT * FROM sales WHERE customer_id=? ORDER BY created_at DESC', (cid,)).fetchall()
    conn.close()
    return jsonify({'customer': dict(cust), 'sales': [dict(s) for s in sales]})


# ==================== SUPPLIERS & PURCHASES ====================
@app.route('/api/suppliers', methods=['GET'])
@login_required
def get_suppliers():
    conn = get_db()
    rows = conn.execute('SELECT * FROM suppliers ORDER BY name').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/suppliers', methods=['POST'])
@login_required
def add_supplier():
    data = request.get_json()
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name required'}), 400
    conn = get_db()
    cur = conn.execute('INSERT INTO suppliers (name, phone, address) VALUES (?,?,?)',
                       (name, data.get('phone', ''), data.get('address', '')))
    conn.commit()
    sid = cur.lastrowid
    conn.close()
    return jsonify({'message': 'Added', 'id': sid}), 201


@app.route('/api/purchases', methods=['GET'])
@login_required
def get_purchases():
    conn = get_db()
    rows = conn.execute('SELECT * FROM purchases ORDER BY created_at DESC LIMIT 50').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/purchases', methods=['POST'])
@login_required
def create_purchase():
    data = request.get_json()
    items = data.get('items', [])
    if not items:
        return jsonify({'error': 'Items required'}), 400
    supplier_name = (data.get('supplier_name') or 'Unknown').strip()
    supplier_id = data.get('supplier_id')
    notes = data.get('notes', '')
    pay_now = float(data.get('paid_amount', 0) or 0)

    conn = get_db()
    total_amount = 0
    total_items = 0
    validated = []
    for item in items:
        qty = int(item.get('quantity', 0))
        rate = float(item.get('rate', 0))
        if qty <= 0:
            conn.close()
            return jsonify({'error': 'Invalid qty'}), 400
        total = qty * rate
        total_amount += total
        total_items += qty
        validated.append({
            'medicine_id': item.get('medicine_id'),
            'medicine_name': item.get('medicine_name', ''),
            'batch_number': item.get('batch_number', ''),
            'quantity': qty, 'rate': rate,
            'mrp': float(item.get('mrp', 0)), 'total': total,
            'mfg_date': item.get('mfg_date'), 'expiry_date': item.get('expiry_date'),
            'medicine_type': item.get('medicine_type', 'Tablet'),
            'company_name': item.get('company_name', ''),
        })

    today = date.today().strftime('%Y%m%d')
    last = conn.execute("SELECT purchase_no FROM purchases WHERE purchase_no LIKE ? ORDER BY id DESC LIMIT 1",
                        (f'PUR-{today}-%',)).fetchone()
    seq = int(last['purchase_no'].split('-')[-1]) + 1 if last else 1
    purchase_no = f'PUR-{today}-{seq:04d}'

    cur = conn.execute(
        '''INSERT INTO purchases (purchase_no,supplier_id,supplier_name,total_amount,total_items,notes,created_by)
           VALUES (?,?,?,?,?,?,?)''',
        (purchase_no, supplier_id, supplier_name, total_amount, total_items, notes, session['user_id']))
    pid = cur.lastrowid

    for it in validated:
        conn.execute(
            '''INSERT INTO purchase_items (purchase_id,medicine_id,medicine_name,batch_number,quantity,rate,mrp,total)
               VALUES (?,?,?,?,?,?,?,?)''',
            (pid, it['medicine_id'], it['medicine_name'], it['batch_number'],
             it['quantity'], it['rate'], it['mrp'], it['total']))
        if it['medicine_id']:
            conn.execute(
                'UPDATE medicines SET quantity=quantity+?, rate=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                (it['quantity'], it['rate'], it['medicine_id']))
        else:
            # Create new medicine stock
            conn.execute(
                '''INSERT INTO medicines (batch_number,name,company_name,medicine_type,mfg_date,expiry_date,rate,mrp,quantity)
                   VALUES (?,?,?,?,?,?,?,?,?)''',
                (it['batch_number'] or 'N/A', it['medicine_name'], it['company_name'] or 'Unknown',
                 it['medicine_type'], it['mfg_date'] or date.today().isoformat(),
                 it['expiry_date'] or (date.today() + timedelta(days=365)).isoformat(),
                 it['rate'], it['mrp'] or it['rate'] * 1.5, it['quantity']))

    # Supplier outstanding
    due = total_amount - pay_now
    if supplier_id and due > 0:
        conn.execute('UPDATE suppliers SET balance=balance+? WHERE id=?', (due, supplier_id))

    conn.commit()
    conn.close()
    log_audit('PURCHASE', 'purchase', pid, {'purchase_no': purchase_no, 'amount': total_amount})
    return jsonify({'message': 'Purchase recorded', 'purchase_no': purchase_no, 'id': pid}), 201


# ==================== SALES ====================
@app.route('/api/sales', methods=['GET'])
@login_required
def get_sales():
    conn = get_db()
    rows = conn.execute(
        '''SELECT s.*, u.full_name as created_by_name FROM sales s
           LEFT JOIN users u ON s.created_by=u.id ORDER BY s.created_at DESC LIMIT 100''').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/sales/<int:sale_id>')
@login_required
def get_sale_detail(sale_id):
    conn = get_db()
    sale = conn.execute(
        '''SELECT s.*, u.full_name as created_by_name FROM sales s
           LEFT JOIN users u ON s.created_by=u.id WHERE s.id=?''', (sale_id,)).fetchone()
    if not sale:
        conn.close()
        return jsonify({'error': 'Not found'}), 404
    items = conn.execute('SELECT * FROM sale_items WHERE sale_id=?', (sale_id,)).fetchall()
    conn.close()
    result = dict(sale)
    result['items'] = [dict(i) for i in items]
    result['shop_name'] = get_setting('shop_name', 'MediStock Medical Shop')
    result['shop_phone'] = get_setting('shop_phone', '')
    result['shop_address'] = get_setting('shop_address', '')
    result['thermal_width'] = get_setting('thermal_width', '80')
    return jsonify(result)


@app.route('/api/sales', methods=['POST'])
@login_required
def create_sale():
    data = request.get_json()
    items = data.get('items', [])
    customer_name = (data.get('customer_name') or 'Walk-in Customer').strip()
    customer_id = data.get('customer_id')
    doctor_name = (data.get('doctor_name') or '').strip()
    payment_mode = data.get('payment_mode', 'Cash')
    discount = float(data.get('discount', 0) or 0)
    if not items:
        return jsonify({'error': 'At least one item required'}), 400

    conn = get_db()
    validated = []
    subtotal = total_profit = total_qty = total_gst = 0.0
    for item in items:
        med_id = item.get('medicine_id')
        qty = int(item.get('quantity', 0))
        if qty <= 0:
            conn.close()
            return jsonify({'error': 'Quantity must be positive'}), 400
        med = conn.execute('SELECT * FROM medicines WHERE id=?', (med_id,)).fetchone()
        if not med:
            conn.close()
            return jsonify({'error': 'Medicine not found'}), 404
        if med['quantity'] < qty:
            conn.close()
            return jsonify({'error': f'Insufficient stock for {med["name"]}. Available: {med["quantity"]}'}), 400
        try:
            if datetime.strptime(med['expiry_date'], '%Y-%m-%d').date() < date.today():
                conn.close()
                return jsonify({'error': f'Cannot sell expired: {med["name"]}'}), 400
        except Exception:
            pass
        unit_price = float(med['mrp'])
        line_total = unit_price * qty
        line_profit = (unit_price - float(med['rate'])) * qty
        gst_rate = float(med['gst_rate'] or DEFAULT_GST_RATE)
        gst_portion = line_total * gst_rate / (100 + gst_rate)
        validated.append({
            'medicine_id': med_id, 'medicine_name': med['name'], 'batch_number': med['batch_number'],
            'quantity': qty, 'unit_price': unit_price, 'rate': float(med['rate']),
            'gst_rate': gst_rate, 'total_price': line_total, 'profit': line_profit
        })
        subtotal += line_total
        total_profit += line_profit
        total_qty += qty
        total_gst += gst_portion

    if discount > subtotal:
        conn.close()
        return jsonify({'error': 'Discount cannot exceed subtotal'}), 400
    total_amount = subtotal - discount
    if subtotal > 0 and discount > 0:
        total_profit *= (total_amount / subtotal)

    prefix = get_setting('bill_prefix', 'BILL')
    today = date.today().strftime('%Y%m%d')
    last = conn.execute("SELECT bill_no FROM sales WHERE bill_no LIKE ? ORDER BY id DESC LIMIT 1",
                        (f'{prefix}-{today}-%',)).fetchone()
    seq = int(last['bill_no'].split('-')[-1]) + 1 if last else 1
    bill_no = f'{prefix}-{today}-{seq:04d}'

    if payment_mode == 'Credit' and customer_id:
        conn.execute('UPDATE customers SET balance=balance+? WHERE id=?', (total_amount, customer_id))

    cur = conn.execute(
        '''INSERT INTO sales (bill_no,customer_id,customer_name,doctor_name,payment_mode,subtotal,discount,gst_amount,
           total_amount,total_items,total_profit,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)''',
        (bill_no, customer_id, customer_name, doctor_name, payment_mode, subtotal, discount,
         round(total_gst, 2), total_amount, total_qty, round(total_profit, 2), session['user_id']))
    sale_id = cur.lastrowid
    for it in validated:
        item_disc = (it['total_price'] / subtotal * discount) if subtotal else 0
        conn.execute(
            '''INSERT INTO sale_items (sale_id,medicine_id,medicine_name,batch_number,quantity,unit_price,rate,
               gst_rate,discount,total_price,profit) VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
            (sale_id, it['medicine_id'], it['medicine_name'], it['batch_number'], it['quantity'],
             it['unit_price'], it['rate'], it['gst_rate'], round(item_disc, 2), it['total_price'], it['profit']))
        conn.execute('UPDATE medicines SET quantity=quantity-?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                     (it['quantity'], it['medicine_id']))
    conn.commit()
    conn.close()
    log_audit('SALE', 'sale', sale_id, {'bill_no': bill_no, 'amount': total_amount})
    return jsonify({'message': 'Sale completed', 'sale_id': sale_id, 'bill_no': bill_no,
                    'total_amount': total_amount, 'profit': round(total_profit, 2)}), 201


# ==================== HELD BILLS ====================
@app.route('/api/held-bills', methods=['GET'])
@login_required
def get_held_bills():
    conn = get_db()
    rows = conn.execute('SELECT id, ref_no, customer_name, notes, created_at FROM held_bills ORDER BY created_at DESC').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/held-bills', methods=['POST'])
@login_required
def hold_bill():
    data = request.get_json()
    cart = data.get('cart', [])
    if not cart:
        return jsonify({'error': 'Cart empty'}), 400
    customer_name = data.get('customer_name', '')
    notes = data.get('notes', '')
    today = date.today().strftime('%Y%m%d')
    conn = get_db()
    last = conn.execute("SELECT ref_no FROM held_bills WHERE ref_no LIKE ? ORDER BY id DESC LIMIT 1",
                        (f'HOLD-{today}-%',)).fetchone()
    seq = int(last['ref_no'].split('-')[-1]) + 1 if last else 1
    ref_no = f'HOLD-{today}-{seq:03d}'
    cur = conn.execute(
        'INSERT INTO held_bills (ref_no, customer_name, notes, cart_json, created_by) VALUES (?,?,?,?,?)',
        (ref_no, customer_name, notes, json.dumps(cart), session['user_id']))
    conn.commit()
    hid = cur.lastrowid
    conn.close()
    return jsonify({'message': 'Bill held', 'ref_no': ref_no, 'id': hid}), 201


@app.route('/api/held-bills/<int:hid>', methods=['GET'])
@login_required
def get_held_bill(hid):
    conn = get_db()
    row = conn.execute('SELECT * FROM held_bills WHERE id=?', (hid,)).fetchone()
    conn.close()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    result = dict(row)
    result['cart'] = json.loads(result['cart_json'])
    return jsonify(result)


@app.route('/api/held-bills/<int:hid>', methods=['DELETE'])
@login_required
def delete_held_bill(hid):
    conn = get_db()
    conn.execute('DELETE FROM held_bills WHERE id=?', (hid,))
    conn.commit()
    conn.close()
    return jsonify({'message': 'Deleted'})


# ==================== RETURNS ====================
@app.route('/api/returns', methods=['GET'])
@login_required
def get_returns():
    conn = get_db()
    rows = conn.execute('SELECT * FROM returns ORDER BY created_at DESC LIMIT 50').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/returns', methods=['POST'])
@login_required
def create_return():
    data = request.get_json()
    sale_id = data.get('sale_id')
    items = data.get('items', [])
    reason = data.get('reason', 'Customer return')
    if not sale_id or not items:
        return jsonify({'error': 'sale_id and items required'}), 400
    conn = get_db()
    sale = conn.execute('SELECT * FROM sales WHERE id=?', (sale_id,)).fetchone()
    if not sale:
        conn.close()
        return jsonify({'error': 'Sale not found'}), 404
    total_return = 0
    return_items = []
    for item in items:
        med_id = item['medicine_id']
        qty = int(item['quantity'])
        si = conn.execute('SELECT * FROM sale_items WHERE sale_id=? AND medicine_id=?',
                          (sale_id, med_id)).fetchone()
        if not si:
            conn.close()
            return jsonify({'error': 'Item not in bill'}), 400
        if qty > si['quantity']:
            conn.close()
            return jsonify({'error': f'Cannot return more than sold for {si["medicine_name"]}'}), 400
        line_total = float(si['unit_price']) * qty
        total_return += line_total
        return_items.append({
            'medicine_id': med_id, 'medicine_name': si['medicine_name'],
            'batch_number': si['batch_number'], 'quantity': qty,
            'unit_price': si['unit_price'], 'total_price': line_total
        })
    today = date.today().strftime('%Y%m%d')
    last = conn.execute("SELECT return_no FROM returns WHERE return_no LIKE ? ORDER BY id DESC LIMIT 1",
                        (f'RET-{today}-%',)).fetchone()
    seq = int(last['return_no'].split('-')[-1]) + 1 if last else 1
    return_no = f'RET-{today}-{seq:04d}'
    cur = conn.execute(
        '''INSERT INTO returns (return_no,sale_id,bill_no,customer_name,total_amount,reason,created_by)
           VALUES (?,?,?,?,?,?,?)''',
        (return_no, sale_id, sale['bill_no'], sale['customer_name'], total_return, reason, session['user_id']))
    ret_id = cur.lastrowid
    for it in return_items:
        conn.execute(
            '''INSERT INTO return_items (return_id,medicine_id,medicine_name,batch_number,quantity,unit_price,total_price)
               VALUES (?,?,?,?,?,?,?)''',
            (ret_id, it['medicine_id'], it['medicine_name'], it['batch_number'],
             it['quantity'], it['unit_price'], it['total_price']))
        conn.execute('UPDATE medicines SET quantity=quantity+?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
                     (it['quantity'], it['medicine_id']))
    if sale['payment_mode'] == 'Credit' and sale['customer_id']:
        conn.execute('UPDATE customers SET balance=balance-? WHERE id=?', (total_return, sale['customer_id']))
    conn.commit()
    conn.close()
    log_audit('RETURN', 'return', ret_id, {'return_no': return_no})
    return jsonify({'message': 'Return processed', 'return_no': return_no, 'amount': total_return}), 201


# ==================== EXPENSES ====================
@app.route('/api/expenses', methods=['GET'])
@login_required
def get_expenses():
    conn = get_db()
    rows = conn.execute('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC LIMIT 100').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/expenses', methods=['POST'])
@login_required
def add_expense():
    data = request.get_json()
    title = (data.get('title') or '').strip()
    amount = float(data.get('amount', 0))
    if not title or amount <= 0:
        return jsonify({'error': 'Title and amount required'}), 400
    conn = get_db()
    cur = conn.execute(
        '''INSERT INTO expenses (title, amount, category, notes, expense_date, created_by)
           VALUES (?,?,?,?,?,?)''',
        (title, amount, data.get('category', 'General'), data.get('notes', ''),
         data.get('expense_date') or date.today().isoformat(), session['user_id']))
    conn.commit()
    eid = cur.lastrowid
    conn.close()
    return jsonify({'message': 'Expense added', 'id': eid}), 201


@app.route('/api/audit')
@login_required
def get_audit():
    conn = get_db()
    rows = conn.execute('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.route('/api/catalog')
def public_catalog():
    search = request.args.get('search', '').strip()
    conn = get_db()
    q = '''SELECT name, company_name, medicine_type, mrp, composition,
           CASE WHEN quantity>0 THEN 1 ELSE 0 END as in_stock
           FROM medicines WHERE quantity>0'''
    params = []
    if search:
        q += ' AND (name LIKE ? OR company_name LIKE ? OR IFNULL(composition,"") LIKE ?)'
        params.extend([f'%{search}%'] * 3)
    q += ' ORDER BY name LIMIT 200'
    rows = conn.execute(q, params).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])



@app.route('/api/charts')
@login_required
def chart_data():
    conn = get_db()
    today = date.today()
    days = []
    for i in range(6, -1, -1):
        d = today - timedelta(days=i)
        ds = d.isoformat()
        row = conn.execute(
            "SELECT COALESCE(SUM(total_amount),0) as amt, COUNT(*) as cnt FROM sales WHERE date(created_at)=?",
            (ds,)).fetchone()
        days.append({'date': ds, 'label': d.strftime('%d %b'), 'amount': round(row['amt'], 2), 'count': row['cnt']})
    mode_rows = conn.execute(
        "SELECT payment_mode, COALESCE(SUM(total_amount),0) as amount, COUNT(*) as count "
        "FROM sales WHERE date(created_at)>=? GROUP BY payment_mode",
        ((today - timedelta(days=30)).isoformat(),)).fetchall()
    conn.close()
    return jsonify({'daily': days, 'payment_modes': [dict(m) for m in mode_rows]})


@app.route('/api/reports/payments')
@login_required
def payment_collection_report():
    period = request.args.get('period', 'today')
    today = date.today()
    if period == 'today':
        from_date = to_date = today.isoformat()
    elif period == 'week':
        from_date = (today - timedelta(days=7)).isoformat()
        to_date = today.isoformat()
    else:
        from_date = today.replace(day=1).isoformat()
        to_date = today.isoformat()
    conn = get_db()
    modes = conn.execute(
        "SELECT payment_mode, COUNT(*) as bills, COALESCE(SUM(total_amount),0) as amount, "
        "COALESCE(SUM(total_profit),0) as profit FROM sales WHERE date(created_at) BETWEEN ? AND ? "
        "GROUP BY payment_mode ORDER BY amount DESC", (from_date, to_date)).fetchall()
    total = conn.execute(
        "SELECT COUNT(*) as bills, COALESCE(SUM(total_amount),0) as amount FROM sales "
        "WHERE date(created_at) BETWEEN ? AND ?", (from_date, to_date)).fetchone()
    conn.close()
    return jsonify({
        'from': from_date, 'to': to_date,
        'modes': [dict(m) for m in modes],
        'total_bills': total['bills'],
        'total_amount': round(total['amount'], 2)
    })


if __name__ == '__main__':
    init_db()
    print('=' * 55)
    print('  MediStock - Medical Shop Inventory')
    print('  Login    : admin / admin123')
    print('  Recovery : RECOVER123')
    print('  URL      : http://127.0.0.1:5000')
    print('=' * 55)
    app.run(debug=True, host='0.0.0.0', port=5000)
