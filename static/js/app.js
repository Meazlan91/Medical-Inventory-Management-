// ===== State =====
let deleteId = null;
let isEditMode = false;
let cart = [];          // { medicine_id, name, batch, mrp, quantity, available }
let allMedicines = [];  // cache for sales search

// ===== DOM Ready =====
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    document.getElementById('medicine-form').addEventListener('submit', handleSubmit);

    let searchTimeout;
    document.getElementById('search-input').addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            loadMedicines();
            loadDashboardTable();
        }, 300);
    });

    document.getElementById('filter-type').addEventListener('change', loadMedicines);
    document.getElementById('filter-expiry').addEventListener('change', loadMedicines);
    document.getElementById('filter-stock').addEventListener('change', loadMedicines);

    // Sales search
    let saleSearchTimeout;
    document.getElementById('sale-search').addEventListener('input', (e) => {
        clearTimeout(saleSearchTimeout);
        saleSearchTimeout = setTimeout(() => searchForSale(e.target.value), 250);
    });

    // Close search results on outside click
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#sale-search') && !e.target.closest('#sale-search-results')) {
            document.getElementById('sale-search-results').classList.remove('show');
        }
    });

    loadStats();
    loadDashboardTable();
    loadMedicines();
});

// ===== View Switching =====
function switchView(viewName) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    const view = document.getElementById(`${viewName}-view`);
    if (view) view.classList.add('active');

    const btn = document.querySelector(`.nav-btn[data-view="${viewName}"]`);
    if (btn) btn.classList.add('active');

    const titles = {
        dashboard: ['Dashboard', 'Overview of your medicine stock & sales'],
        inventory: ['Inventory', 'Manage all medicines in stock'],
        sales: ['Sales / Billing', 'Create new bills and sell medicines'],
        history: ['Sales History', 'View all past sales and bills'],
        reports: ['Reports', 'Daily & monthly sales reports with profit'],
        customers: ['Customers', 'Customer ledger and credit balance'],
        quicksale: ['Quick Sale', 'Scan → Qty → Pay → Print'],
        purchase: ['Purchase', 'Record supplier purchases'],
        returns: ['Returns', 'Process medicine returns'],
        expiry: ['Near Expiry', 'Expired and soon-to-expire stock'],
        expenses: ['Expenses', 'Shop expense tracking'],
        add: [isEditMode ? 'Edit Medicine' : 'Add Medicine', isEditMode ? 'Update medicine details' : 'Enter new medicine details'],
        settings: ['Settings', 'Password, audit log & catalog']
    };

    if (titles[viewName]) {
        document.getElementById('page-title').textContent = titles[viewName][0];
        document.getElementById('page-subtitle').textContent = titles[viewName][1];
    }

    if (viewName === 'add' && !isEditMode) resetForm(false);
    if (viewName === 'dashboard') { loadStats(); loadDashboardTable(); }
    if (viewName === 'inventory') loadMedicines();
    if (viewName === 'sales') { loadSaleStock(); cart = []; renderCart(); }
    if (viewName === 'history') loadSalesHistory();
    if (viewName === 'reports') loadReport();
    if (viewName === 'customers') loadCustomers();
    if (viewName === 'settings') { loadAudit(); }
}

// ===== API Helper =====
async function api(url, options = {}) {
    try {
        const res = await fetch(url, {
            headers: { 'Content-Type': 'application/json' },
            ...options
        });
        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }
        if (res.status === 403) {
            const err = await res.clone().json().catch(() => ({}));
            if (err.must_change_password) {
                window.location.href = '/change-password';
                return;
            }
        }
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Request failed');
        return data;
    } catch (err) {
        showToast(err.message, 'error');
        throw err;
    }
}

// ===== Stats =====
async function loadStats() {
    try {
        const data = await api('/api/stats');
        document.getElementById('stat-total').textContent = data.total_items;
        document.getElementById('stat-qty').textContent = data.total_quantity;
        document.getElementById('stat-value').textContent = '₹' + Number(data.total_value).toLocaleString('en-IN', { minimumFractionDigits: 2 });
        document.getElementById('stat-today-sales').textContent = '₹' + Number(data.today_sales_amount).toLocaleString('en-IN', { minimumFractionDigits: 2 });
        const profitEl = document.getElementById('stat-today-profit');
        if (profitEl) profitEl.textContent = '₹' + Number(data.today_profit || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
        document.getElementById('stat-expiring').textContent = data.expiring_soon;
        document.getElementById('stat-expired').textContent = data.expired;
        document.getElementById('stat-low-stock').textContent = data.low_stock;
        document.getElementById('stat-out-stock').textContent = data.out_of_stock;
    } catch (e) {}
}

// ===== Medicines =====
async function loadMedicines() {
    const search = document.getElementById('search-input').value.trim();
    const type = document.getElementById('filter-type').value;
    const expiry = document.getElementById('filter-expiry').value;
    const stock = document.getElementById('filter-stock').value;

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (type) params.set('type', type);
    if (expiry) params.set('expiry', expiry);
    if (stock) params.set('stock', stock);

    try {
        const data = await api('/api/medicines?' + params.toString());
        const medicines = data.items || data;  // support both shapes
        allMedicines = medicines;
        const tbody = document.getElementById('inventory-table-body');

        if (!medicines.length) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty">No medicines found.</td></tr>';
            return;
        }

        tbody.innerHTML = medicines.map(m => `
            <tr>
                <td><strong>${esc(m.batch_number)}</strong></td>
                <td>${esc(m.name)}</td>
                <td><span class="badge badge-type">${esc(m.medicine_type)}</span></td>
                <td>${esc(m.company_name)}</td>
                <td>${formatDate(m.mfg_date)}</td>
                <td>${formatDate(m.expiry_date)}</td>
                <td>₹${Number(m.rate).toFixed(2)}</td>
                <td>₹${Number(m.mrp).toFixed(2)}</td>
                <td class="${m.quantity === 0 ? 'qty-out' : m.low_stock ? 'qty-low' : ''}">${m.quantity}</td>
                <td>${statusBadge(m)}</td>
                <td>
                    <div class="actions">
                        <button class="btn-icon" title="Edit" onclick="editMedicine(${m.id})">✏️</button>
                        <button class="btn-icon delete" title="Delete" onclick="confirmDelete(${m.id}, '${esc(m.name)}')">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (e) {}
}

async function loadDashboardTable() {
    const search = document.getElementById('search-input').value.trim();
    const params = new URLSearchParams();
    if (search) params.set('search', search);

    try {
        const data = await api('/api/medicines?' + params.toString());
        const medicines = data.items || data;
        const tbody = document.getElementById('dashboard-table-body');

        if (!medicines.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty">No medicines yet.</td></tr>';
            return;
        }

        tbody.innerHTML = medicines.slice(0, 10).map(m => `
            <tr>
                <td><strong>${esc(m.name)}</strong></td>
                <td><span class="badge badge-type">${esc(m.medicine_type)}</span></td>
                <td>${esc(m.batch_number)}</td>
                <td>${esc(m.company_name)}</td>
                <td class="${m.quantity === 0 ? 'qty-out' : m.low_stock ? 'qty-low' : ''}">${m.quantity}</td>
                <td>${formatDate(m.expiry_date)}</td>
                <td>${statusBadge(m)}</td>
            </tr>
        `).join('');
    } catch (e) {}
}

// ===== Form =====
async function handleSubmit(e) {
    e.preventDefault();
    const id = document.getElementById('med-id').value;
    const payload = {
        batch_number: document.getElementById('batch_number').value.trim(),
        barcode: document.getElementById('barcode')?.value?.trim() || '',
        composition: document.getElementById('composition')?.value?.trim() || '',
        location: document.getElementById('location')?.value || 'Main',
        units_per_strip: parseInt(document.getElementById('units_per_strip')?.value || 10, 10),
        sell_unit: document.getElementById('sell_unit')?.value || 'unit',
        name: document.getElementById('name').value.trim(),
        company_name: document.getElementById('company_name').value.trim(),
        medicine_type: document.getElementById('medicine_type').value,
        mfg_date: document.getElementById('mfg_date').value,
        expiry_date: document.getElementById('expiry_date').value,
        rate: parseFloat(document.getElementById('rate').value),
        mrp: parseFloat(document.getElementById('mrp').value),
        quantity: parseInt(document.getElementById('quantity').value, 10),
        gst_rate: parseFloat(document.getElementById('gst_rate')?.value || 12),
        hsn_code: document.getElementById('hsn_code')?.value || '3004'
    };

    if (new Date(payload.expiry_date) < new Date(payload.mfg_date)) {
        showToast('Expiry date cannot be before Manufacturing date', 'error');
        return;
    }

    try {
        if (id) {
            await api(`/api/medicines/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
            showToast('Medicine updated successfully!', 'success');
        } else {
            await api('/api/medicines', { method: 'POST', body: JSON.stringify(payload) });
            showToast('Medicine added successfully!', 'success');
        }
        resetForm();
        switchView('inventory');
        loadStats();
    } catch (e) {}
}

function resetForm(switchBack = true) {
    document.getElementById('medicine-form').reset();
    document.getElementById('med-id').value = '';
    document.getElementById('form-title').textContent = 'Add New Medicine';
    document.getElementById('submit-btn').textContent = 'Save Medicine';
    isEditMode = false;
}

async function editMedicine(id) {
    try {
        const data = await api('/api/medicines?per_page=500');
        const medicines = data.items || data;
        const m = medicines.find(x => x.id === id);
        if (!m) { showToast('Medicine not found', 'error'); return; }

        isEditMode = true;
        document.getElementById('med-id').value = m.id;
        document.getElementById('batch_number').value = m.batch_number;
        if (document.getElementById('barcode')) document.getElementById('barcode').value = m.barcode || '';
        document.getElementById('name').value = m.name;
        if (document.getElementById('gst_rate')) document.getElementById('gst_rate').value = m.gst_rate || 12;
        if (document.getElementById('hsn_code')) document.getElementById('hsn_code').value = m.hsn_code || '3004';
        document.getElementById('company_name').value = m.company_name;
        document.getElementById('medicine_type').value = m.medicine_type;
        document.getElementById('mfg_date').value = m.mfg_date;
        document.getElementById('expiry_date').value = m.expiry_date;
        document.getElementById('rate').value = m.rate;
        document.getElementById('mrp').value = m.mrp;
        document.getElementById('quantity').value = m.quantity;
        document.getElementById('form-title').textContent = 'Edit Medicine';
        document.getElementById('submit-btn').textContent = 'Update Medicine';
        switchView('add');
    } catch (e) {}
}

// ===== Delete =====
function confirmDelete(id, name) {
    deleteId = id;
    document.getElementById('modal-text').textContent = `Are you sure you want to delete "${name}"? This cannot be undone.`;
    document.getElementById('modal').classList.add('show');
}

function closeModal() {
    document.getElementById('modal').classList.remove('show');
    deleteId = null;
}

document.getElementById('confirm-delete').addEventListener('click', async () => {
    if (!deleteId) return;
    try {
        await api(`/api/medicines/${deleteId}`, { method: 'DELETE' });
        showToast('Medicine deleted successfully', 'success');
        closeModal();
        loadMedicines();
        loadStats();
        loadDashboardTable();
    } catch (e) {}
});

// ===== SALES / BILLING =====
async function loadSaleStock() {
    try {
        const data = await api('/api/medicines?per_page=200');
        const medicines = data.items || data;
        allMedicines = medicines.filter(m => m.quantity > 0 && m.status !== 'expired');
        const tbody = document.getElementById('sale-stock-body');

        if (allMedicines.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="empty">No available stock for sale.</td></tr>';
            return;
        }

        tbody.innerHTML = allMedicines.map(m => `
            <tr>
                <td><strong>${esc(m.name)}</strong></td>
                <td><span class="badge badge-type">${esc(m.medicine_type)}</span></td>
                <td>${esc(m.batch_number)}</td>
                <td>₹${Number(m.mrp).toFixed(2)}</td>
                <td class="${m.low_stock ? 'qty-low' : ''}">${m.quantity}</td>
                <td><button class="btn btn-primary btn-sm" onclick="addToCart(${m.id})">+ Add</button></td>
            </tr>
        `).join('');
    } catch (e) {}
}

function searchForSale(query) {
    const resultsEl = document.getElementById('sale-search-results');
    if (!query || query.length < 1) {
        resultsEl.classList.remove('show');
        return;
    }
    const q = query.toLowerCase();
    const matches = allMedicines.filter(m =>
        m.name.toLowerCase().includes(q) ||
        m.batch_number.toLowerCase().includes(q) ||
        m.company_name.toLowerCase().includes(q)
    ).slice(0, 8);

    if (matches.length === 0) {
        resultsEl.innerHTML = '<div class="search-result-item">No matches found</div>';
    } else {
        resultsEl.innerHTML = matches.map(m => `
            <div class="search-result-item" onclick="addToCart(${m.id})">
                <strong>${esc(m.name)}</strong>
                <div class="meta">${esc(m.batch_number)} · MRP ₹${Number(m.mrp).toFixed(2)} · Qty: ${m.quantity}</div>
            </div>
        `).join('');
    }
    resultsEl.classList.add('show');
}

function addToCart(medId) {
    const med = allMedicines.find(m => m.id === medId);
    if (!med) return;

    const existing = cart.find(c => c.medicine_id === medId);
    if (existing) {
        if (existing.quantity >= med.quantity) {
            showToast(`Only ${med.quantity} available in stock`, 'error');
            return;
        }
        existing.quantity += 1;
    } else {
        cart.push({
            medicine_id: med.id,
            name: med.name,
            batch: med.batch_number,
            mrp: med.mrp,
            quantity: 1,
            available: med.quantity
        });
    }

    document.getElementById('sale-search').value = '';
    document.getElementById('sale-search-results').classList.remove('show');
    renderCart();
}

function updateCartQty(medId, delta) {
    const item = cart.find(c => c.medicine_id === medId);
    if (!item) return;
    const newQty = item.quantity + delta;
    if (newQty <= 0) {
        cart = cart.filter(c => c.medicine_id !== medId);
    } else if (newQty > item.available) {
        showToast(`Only ${item.available} available`, 'error');
        return;
    } else {
        item.quantity = newQty;
    }
    renderCart();
}

function removeFromCart(medId) {
    cart = cart.filter(c => c.medicine_id !== medId);
    renderCart();
}

function renderCart() {
    const container = document.getElementById('cart-items');
    const totalEl = document.getElementById('cart-total');
    const btn = document.getElementById('complete-sale-btn');

    if (cart.length === 0) {
        container.innerHTML = '<p class="empty-cart">No items added yet. Search and add medicines above.</p>';
        totalEl.textContent = '₹0.00';
        btn.disabled = true;
        return;
    }

    let total = 0;
    container.innerHTML = cart.map(item => {
        const lineTotal = item.mrp * item.quantity;
        total += lineTotal;
        return `
            <div class="cart-item">
                <div class="cart-item-info">
                    <strong>${esc(item.name)}</strong>
                    <span>${esc(item.batch)} · ₹${Number(item.mrp).toFixed(2)} each</span>
                </div>
                <div class="cart-item-qty">
                    <button onclick="updateCartQty(${item.medicine_id}, -1)">−</button>
                    <span>${item.quantity}</span>
                    <button onclick="updateCartQty(${item.medicine_id}, 1)">+</button>
                </div>
                <div class="cart-item-price">₹${lineTotal.toFixed(2)}</div>
                <button class="cart-item-remove" onclick="removeFromCart(${item.medicine_id})" title="Remove">✕</button>
            </div>
        `;
    }).join('');

    totalEl.textContent = '₹' + total.toFixed(2);
    btn.disabled = false;
}

async function completeSale() {
    if (cart.length === 0) return;

    const customerName = document.getElementById('customer-name').value.trim();
    const paymentMode = document.getElementById('payment-mode')?.value || 'Cash';
    const discount = parseFloat(document.getElementById('bill-discount')?.value || 0) || 0;

    const payload = {
        customer_name: customerName || 'Walk-in Customer',
        payment_mode: paymentMode,
        discount: discount,
        items: cart.map(c => ({
            medicine_id: c.medicine_id,
            quantity: c.quantity
        }))
    };

    try {
        const result = await api('/api/sales', {
            method: 'POST',
            body: JSON.stringify(payload)
        });
        showToast(`Sale completed! Bill: ${result.bill_no} | Profit: ₹${Number(result.profit||0).toFixed(2)}`, 'success');
        cart = [];
        document.getElementById('customer-name').value = '';
        if (document.getElementById('bill-discount')) document.getElementById('bill-discount').value = 0;
        if (document.getElementById('payment-mode')) document.getElementById('payment-mode').value = 'Cash';
        renderCart();
        loadSaleStock();
        loadStats();
        viewBill(result.sale_id);
    } catch (e) {}
}

// ===== Sales History =====
async function loadSalesHistory() {
    try {
        const data = await api('/api/sales');
        const sales = data.items || data;
        const tbody = document.getElementById('history-table-body');

        if (!sales.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="empty">No sales yet.</td></tr>';
            return;
        }

        tbody.innerHTML = sales.map(s => `
            <tr>
                <td><strong>${esc(s.bill_no)}</strong></td>
                <td>${esc(s.customer_name)}</td>
                <td>${s.total_items}</td>
                <td>₹${Number(s.total_amount).toFixed(2)}</td>
                <td>${esc(s.created_by_name || '-')}</td>
                <td>${formatDateTime(s.created_at)}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="viewBill(${s.id})">View</button></td>
            </tr>
        `).join('');
    } catch (e) {}
}

async function viewBill(saleId) {
    try {
        const sale = await api(`/api/sales/${saleId}`);
        const body = document.getElementById('bill-detail-body');
        body.innerHTML = `
            <div class="printable-bill" id="printable-bill">
                <div class="invoice-header">
                    <div class="invoice-shop">
                        <div class="invoice-logo">💊</div>
                        <div>
                            <h2>MediStock Medical Shop</h2>
                            <p>Retail Pharmacy & Medical Store</p>
                        </div>
                    </div>
                    <div class="invoice-title">
                        <h3>TAX INVOICE / BILL</h3>
                        <p class="invoice-billno">${esc(sale.bill_no)}</p>
                    </div>
                </div>

                <div class="invoice-meta">
                    <div>
                        <p><strong>Customer:</strong> ${esc(sale.customer_name)}</p>
                        <p><strong>Sold By:</strong> ${esc(sale.created_by_name || '-')}</p>
                    </div>
                    <div class="invoice-meta-right">
                        <p><strong>Date:</strong> ${formatDateTime(sale.created_at)}</p>
                        <p><strong>Items:</strong> ${sale.total_items}</p>
                    </div>
                </div>

                <table class="bill-items-table invoice-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Medicine</th>
                            <th>Batch</th>
                            <th>Qty</th>
                            <th>Rate (₹)</th>
                            <th>Amount (₹)</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${sale.items.map((i, idx) => `
                            <tr>
                                <td>${idx + 1}</td>
                                <td>${esc(i.medicine_name)}</td>
                                <td>${esc(i.batch_number)}</td>
                                <td>${i.quantity}</td>
                                <td>${Number(i.unit_price).toFixed(2)}</td>
                                <td>${Number(i.total_price).toFixed(2)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>

                <div class="invoice-footer">
                    <div class="invoice-thanks">
                        <p>Thank you for your purchase!</p>
                        <p class="invoice-note">Medicines once sold cannot be returned. Please check expiry before use.</p>
                    </div>
                    <div class="invoice-total-box">
                        <p>Grand Total</p>
                        <h2>₹${Number(sale.total_amount).toFixed(2)}</h2>
                    </div>
                </div>
            </div>
        `;
        window._lastSale = sale;
        document.getElementById('bill-modal').classList.add('show');
    } catch (e) {}
}

function closeBillModal() {
    document.getElementById('bill-modal').classList.remove('show');
}

function printBill() {
    const billContent = document.getElementById('printable-bill');
    if (!billContent) {
        showToast('No bill to print', 'error');
        return;
    }

    const printWindow = window.open('', '_blank', 'width=800,height=700');
    printWindow.document.write(`
<!DOCTYPE html>
<html>
<head>
    <title>Print Bill</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Segoe UI', Arial, sans-serif;
            color: #111;
            padding: 24px;
            font-size: 13px;
        }
        .invoice-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            border-bottom: 2px solid #0d9488;
            padding-bottom: 16px;
            margin-bottom: 16px;
        }
        .invoice-shop { display: flex; gap: 12px; align-items: center; }
        .invoice-logo { font-size: 36px; }
        .invoice-shop h2 { font-size: 20px; color: #0f172a; }
        .invoice-shop p { color: #64748b; font-size: 12px; margin-top: 2px; }
        .invoice-title { text-align: right; }
        .invoice-title h3 { font-size: 14px; color: #0d9488; letter-spacing: 1px; }
        .invoice-billno { font-size: 16px; font-weight: 700; margin-top: 4px; }
        .invoice-meta {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
            padding: 12px;
            background: #f8fafc;
            border-radius: 6px;
        }
        .invoice-meta p { margin-bottom: 4px; }
        .invoice-meta-right { text-align: right; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 20px;
        }
        th {
            background: #134e4a;
            color: white;
            padding: 10px 8px;
            text-align: left;
            font-size: 12px;
        }
        td {
            padding: 9px 8px;
            border-bottom: 1px solid #e2e8f0;
        }
        tr:nth-child(even) td { background: #f8fafc; }
        .invoice-footer {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            border-top: 2px solid #e2e8f0;
            padding-top: 16px;
        }
        .invoice-thanks p { color: #64748b; font-size: 12px; margin-bottom: 4px; }
        .invoice-note { font-size: 11px !important; font-style: italic; }
        .invoice-total-box {
            text-align: right;
            background: #f0fdfa;
            padding: 12px 20px;
            border-radius: 8px;
            border: 1px solid #99f6e4;
        }
        .invoice-total-box p { font-size: 12px; color: #64748b; }
        .invoice-total-box h2 { font-size: 24px; color: #0d9488; margin-top: 4px; }
        @media print {
            body { padding: 0; }
            @page { margin: 12mm; }
        }
    </style>
</head>
<body>
    ${billContent.innerHTML}
    <script>
        window.onload = function() {
            window.print();
            window.onafterprint = function() { window.close(); };
        };
    <\/script>
</body>
</html>
    `);
    printWindow.document.close();
}

// ===== Helpers =====
function statusBadge(m) {
    let badges = '';
    if (m.status === 'expired') {
        badges += `<span class="badge badge-expired">Expired</span> `;
    } else if (m.status === 'expiring_soon') {
        badges += `<span class="badge badge-expiring">${m.days_left}d left</span> `;
    } else {
        badges += `<span class="badge badge-valid">Valid</span> `;
    }
    if (m.quantity === 0) {
        badges += `<span class="badge badge-expired">Out</span>`;
    } else if (m.low_stock) {
        badges += `<span class="badge badge-low">Low</span>`;
    }
    return badges;
}

function formatDate(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatDateTime(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr.replace(' ', 'T'));
    return d.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'success') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast show ' + type;
    setTimeout(() => toast.classList.remove('show'), 3000);
}

// Modal outside click
document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
});
document.getElementById('bill-modal').addEventListener('click', (e) => {
    if (e.target.id === 'bill-modal') closeBillModal();
});


// ===== REPORTS =====
async function loadReport() {
    const period = document.getElementById('report-period')?.value || 'today';
    try {
        const data = await api('/api/reports/sales?period=' + period);
        const s = data.summary;
        document.getElementById('report-summary').innerHTML = `
            <div class="stat-card"><div class="stat-icon blue">🧾</div><div><h3>${s.bills}</h3><p>Total Bills</p></div></div>
            <div class="stat-card"><div class="stat-icon green">💰</div><div><h3>₹${Number(s.revenue).toFixed(2)}</h3><p>Revenue</p></div></div>
            <div class="stat-card"><div class="stat-icon purple">📈</div><div><h3>₹${Number(s.profit).toFixed(2)}</h3><p>Profit</p></div></div>
            <div class="stat-card"><div class="stat-icon orange">🏷️</div><div><h3>₹${Number(s.total_discount).toFixed(2)}</h3><p>Discounts</p></div></div>
            <div class="stat-card"><div class="stat-icon teal">📋</div><div><h3>₹${Number(s.total_gst).toFixed(2)}</h3><p>GST Collected</p></div></div>
            <div class="stat-card"><div class="stat-icon gray">📦</div><div><h3>${s.items_sold}</h3><p>Items Sold</p></div></div>
        `;
        const topBody = document.getElementById('report-top-body');
        if (!data.top_medicines.length) {
            topBody.innerHTML = '<tr><td colspan="4" class="empty">No sales in this period</td></tr>';
        } else {
            topBody.innerHTML = data.top_medicines.map(t => `
                <tr>
                    <td><strong>${esc(t.medicine_name)}</strong></td>
                    <td>${t.qty}</td>
                    <td>₹${Number(t.amount).toFixed(2)}</td>
                    <td>₹${Number(t.profit||0).toFixed(2)}</td>
                </tr>
            `).join('');
        }
        const modesBody = document.getElementById('report-modes-body');
        if (!data.payment_modes.length) {
            modesBody.innerHTML = '<tr><td colspan="3" class="empty">-</td></tr>';
        } else {
            modesBody.innerHTML = data.payment_modes.map(m => `
                <tr><td>${esc(m.payment_mode)}</td><td>${m.count}</td><td>₹${Number(m.amount).toFixed(2)}</td></tr>
            `).join('');
        }
    } catch(e) {}
}

// ===== CUSTOMERS =====
async function loadCustomers() {
    const q = document.getElementById('customer-search')?.value || '';
    try {
        const data = await api('/api/customers?search=' + encodeURIComponent(q));
        const tbody = document.getElementById('customers-body');
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty">No customers yet</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(c => `
            <tr>
                <td><strong>${esc(c.name)}</strong></td>
                <td>${esc(c.phone||'-')}</td>
                <td class="${c.balance>0?'qty-low':''}">₹${Number(c.balance).toFixed(2)}</td>
                <td><button class="btn btn-secondary btn-sm" onclick="viewLedger(${c.id})">Ledger</button></td>
            </tr>
        `).join('');
    } catch(e) {}
}

function showAddCustomer() {
    const name = prompt('Customer Name:');
    if (!name) return;
    const phone = prompt('Phone (optional):') || '';
    api('/api/customers', { method: 'POST', body: JSON.stringify({ name, phone }) })
        .then(() => { showToast('Customer added', 'success'); loadCustomers(); })
        .catch(() => {});
}

async function viewLedger(cid) {
    try {
        const data = await api('/api/customers/' + cid + '/ledger');
        const c = data.customer;
        let html = `<strong>${esc(c.name)}</strong> | Balance: ₹${Number(c.balance).toFixed(2)}\n\n`;
        if (!data.sales.length) html += 'No sales yet.';
        else data.sales.forEach(s => {
            html += `${s.bill_no} | ${s.created_at} | ₹${Number(s.total_amount).toFixed(2)} | ${s.payment_mode}\n`;
        });
        alert(html);
    } catch(e) {}
}

// ===== AUDIT & PASSWORD =====
async function loadAudit() {
    try {
        const data = await api('/api/audit?limit=50');
        const tbody = document.getElementById('audit-body');
        if (!data.length) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty">No activity yet</td></tr>';
            return;
        }
        tbody.innerHTML = data.map(a => `
            <tr>
                <td>${formatDateTime(a.created_at)}</td>
                <td>${esc(a.username)}</td>
                <td><strong>${esc(a.action)}</strong></td>
                <td>${esc(a.entity_type||'')}</td>
            </tr>
        `).join('');
    } catch(e) {}
}

document.getElementById('password-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cur = document.getElementById('current-password').value;
    const neu = document.getElementById('new-password').value;
    const conf = document.getElementById('confirm-password').value;
    if (neu !== conf) { showToast('Passwords do not match', 'error'); return; }
    try {
        await api('/api/change-password', {
            method: 'POST',
            body: JSON.stringify({ current_password: cur, new_password: neu })
        });
        showToast('Password changed successfully', 'success');
        document.getElementById('password-form').reset();
    } catch(e) {}
});

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
        // Allow barcode scanner rapid input - if Enter on sale-search, try barcode lookup
        if (e.key === 'Enter' && e.target.id === 'sale-search') {
            e.preventDefault();
            const val = e.target.value.trim();
            if (val) {
                // Try barcode first
                api('/api/medicines/barcode/' + encodeURIComponent(val))
                    .then(med => { addToCart(med.id); e.target.value = ''; })
                    .catch(() => searchForSale(val));
            }
        }
        return;
    }
    // Global shortcuts when not typing
    if (e.key === 'F2') { e.preventDefault(); switchView('sales'); }
    if (e.key === 'F3') { e.preventDefault(); switchView('inventory'); }
    if (e.key === 'F4') { e.preventDefault(); switchView('dashboard'); }
    if (e.key === 'F5') { e.preventDefault(); switchView('reports'); }
});

// Customer search
document.getElementById('customer-search')?.addEventListener('input', () => {
    clearTimeout(window._custT);
    window._custT = setTimeout(loadCustomers, 300);
});

// ===== QUICK SALE =====
let qsCart = [];

function playBeep() {
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain); gain.connect(ctx.destination);
        osc.frequency.value = 800; gain.gain.value = 0.1;
        osc.start(); setTimeout(() => { osc.stop(); ctx.close(); }, 80);
    } catch(e) {}
}

async function qsSearch(q) {
    const el = document.getElementById('qs-results');
    if (!q || q.length < 1) { el.classList.remove('show'); return; }
    try {
        // try barcode first
        try {
            const med = await api('/api/medicines/barcode/' + encodeURIComponent(q));
            qsAdd(med); document.getElementById('qs-search').value = ''; el.classList.remove('show'); playBeep(); return;
        } catch(e) {}
        const meds = await api('/api/medicines?search=' + encodeURIComponent(q));
        const list = (meds.items || meds).filter(m => m.quantity > 0 && m.status !== 'expired').slice(0, 8);
        if (!list.length) { el.innerHTML = '<div class="search-result-item">No results</div>'; }
        else {
            el.innerHTML = list.map(m => `<div class="search-result-item" onclick='qsAdd(${JSON.stringify({id:m.id,name:m.name,batch_number:m.batch_number,mrp:m.mrp,quantity:m.quantity})})'>
                <strong>${esc(m.name)}</strong><div class="meta">${esc(m.batch_number)} · ₹${m.mrp} · Qty ${m.quantity}</div></div>`).join('');
        }
        el.classList.add('show');
    } catch(e) {}
}

function qsAdd(med) {
    const existing = qsCart.find(c => c.medicine_id === med.id);
    if (existing) {
        if (existing.quantity >= med.quantity) { showToast('Only ' + med.quantity + ' available', 'error'); return; }
        existing.quantity++;
    } else {
        qsCart.push({ medicine_id: med.id, name: med.name, batch: med.batch_number, mrp: med.mrp, quantity: 1, available: med.quantity });
    }
    playBeep();
    document.getElementById('qs-search').value = '';
    document.getElementById('qs-results').classList.remove('show');
    renderQsCart();
}

function renderQsCart() {
    const el = document.getElementById('qs-cart');
    const totalEl = document.getElementById('qs-total');
    const btn = document.getElementById('qs-pay-btn');
    if (!qsCart.length) {
        el.innerHTML = '<p class="empty-cart">Scan or search to add items</p>';
        totalEl.textContent = '₹0.00'; btn.disabled = true; return;
    }
    let total = 0;
    el.innerHTML = qsCart.map(c => {
        const lt = c.mrp * c.quantity; total += lt;
        return `<div class="cart-item">
            <div class="cart-item-info"><strong>${esc(c.name)}</strong><span>₹${Number(c.mrp).toFixed(2)}</span></div>
            <div class="cart-item-qty">
                <button onclick="qsCart.find(x=>x.medicine_id===${c.medicine_id}).quantity>1?qsCart.find(x=>x.medicine_id===${c.medicine_id}).quantity--:qsCart=qsCart.filter(x=>x.medicine_id!==${c.medicine_id});renderQsCart()">−</button>
                <span>${c.quantity}</span>
                <button onclick="let i=qsCart.find(x=>x.medicine_id===${c.medicine_id});if(i.quantity<i.available){i.quantity++;renderQsCart()}else showToast('Max stock','error')">+</button>
            </div>
            <div class="cart-item-price">₹${lt.toFixed(2)}</div>
            <button class="cart-item-remove" onclick="qsCart=qsCart.filter(x=>x.medicine_id!==${c.medicine_id});renderQsCart()">✕</button>
        </div>`;
    }).join('');
    const disc = parseFloat(document.getElementById('qs-discount')?.value || 0) || 0;
    totalEl.textContent = '₹' + Math.max(0, total - disc).toFixed(2);
    btn.disabled = false;
}

async function completeQuickSale() {
    if (!qsCart.length) return;
    const payload = {
        customer_name: 'Walk-in Customer',
        payment_mode: document.getElementById('qs-payment')?.value || 'Cash',
        discount: parseFloat(document.getElementById('qs-discount')?.value || 0) || 0,
        items: qsCart.map(c => ({ medicine_id: c.medicine_id, quantity: c.quantity }))
    };
    try {
        const result = await api('/api/sales', { method: 'POST', body: JSON.stringify(payload) });
        showToast('Sale: ' + result.bill_no, 'success');
        playBeep();
        qsCart = []; renderQsCart();
        if (document.getElementById('qs-discount')) document.getElementById('qs-discount').value = 0;
        loadStats();
        viewBill(result.sale_id);
        // auto print after short delay
        setTimeout(() => { try { printBill(); } catch(e) {} }, 400);
    } catch(e) {}
}

// ===== HOLD BILL =====
async function holdCurrentBill(source) {
    const cartData = source === 'qs' ? qsCart : cart;
    if (!cartData.length) { showToast('Cart is empty', 'error'); return; }
    try {
        const result = await api('/api/held-bills', {
            method: 'POST',
            body: JSON.stringify({
                customer_name: document.getElementById('customer-name')?.value || '',
                cart: cartData.map(c => ({
                    medicine_id: c.medicine_id, name: c.name, batch: c.batch || c.batch_number,
                    mrp: c.mrp, quantity: c.quantity, available: c.available
                }))
            })
        });
        showToast('Held: ' + result.ref_no, 'success');
        if (source === 'qs') { qsCart = []; renderQsCart(); }
        else { cart = []; renderCart(); }
    } catch(e) {}
}

async function loadHeldBills() {
    try {
        const list = await api('/api/held-bills');
        if (!list.length) { showToast('No held bills', 'error'); return; }
        const choice = prompt('Held bills:\n' + list.map(h => h.ref_no + ' - ' + (h.customer_name||'') + ' (' + h.created_at + ')').join('\n') + '\n\nEnter Ref No to resume:');
        if (!choice) return;
        const held = list.find(h => h.ref_no === choice.trim());
        if (!held) { showToast('Not found', 'error'); return; }
        const detail = await api('/api/held-bills/' + held.id);
        cart = (detail.cart || []).map(c => ({
            medicine_id: c.medicine_id, name: c.name, batch: c.batch, mrp: c.mrp,
            quantity: c.quantity, available: c.available || 999
        }));
        renderCart();
        await api('/api/held-bills/' + held.id, { method: 'DELETE' });
        switchView('sales');
        showToast('Bill resumed', 'success');
    } catch(e) {}
}

// ===== PURCHASE =====
let purchaseRows = [];
function addPurchaseRow() {
    purchaseRows.push({ name: '', batch: '', qty: 1, rate: 0, mrp: 0, medicine_id: null });
    renderPurchaseRows();
}
function renderPurchaseRows() {
    const tbody = document.getElementById('purchase-rows');
    if (!tbody) return;
    if (!purchaseRows.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">Click + Add Row</td></tr>'; return; }
    tbody.innerHTML = purchaseRows.map((r, i) => `
        <tr>
            <td><input type="text" value="${esc(r.name)}" onchange="purchaseRows[${i}].name=this.value" placeholder="Medicine name" style="width:140px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
            <td><input type="text" value="${esc(r.batch)}" onchange="purchaseRows[${i}].batch=this.value" style="width:90px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
            <td><input type="number" value="${r.qty}" min="1" onchange="purchaseRows[${i}].qty=+this.value;renderPurchaseRows()" style="width:70px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
            <td><input type="number" value="${r.rate}" min="0" step="0.01" onchange="purchaseRows[${i}].rate=+this.value;renderPurchaseRows()" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
            <td><input type="number" value="${r.mrp}" min="0" step="0.01" onchange="purchaseRows[${i}].mrp=+this.value" style="width:80px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
            <td>₹${(r.qty * r.rate).toFixed(2)}</td>
            <td><button class="btn-icon delete" onclick="purchaseRows.splice(${i},1);renderPurchaseRows()">✕</button></td>
        </tr>
    `).join('');
    const tot = purchaseRows.reduce((s, r) => s + r.qty * r.rate, 0);
    const el = document.getElementById('purchase-total');
    if (el) el.textContent = tot.toFixed(2);
}
async function submitPurchase() {
    if (!purchaseRows.length) { showToast('Add items', 'error'); return; }
    const items = purchaseRows.filter(r => r.name && r.qty > 0).map(r => ({
        medicine_name: r.name, batch_number: r.batch, quantity: r.qty, rate: r.rate, mrp: r.mrp || r.rate * 1.4,
        medicine_id: r.medicine_id
    }));
    if (!items.length) { showToast('Fill medicine names', 'error'); return; }
    try {
        const result = await api('/api/purchases', {
            method: 'POST',
            body: JSON.stringify({
                supplier_name: document.getElementById('purchase-supplier')?.value || 'Unknown',
                items
            })
        });
        showToast('Purchase: ' + result.purchase_no, 'success');
        purchaseRows = []; renderPurchaseRows();
        loadPurchaseHistory();
    } catch(e) {}
}
async function loadPurchaseHistory() {
    try {
        const list = await api('/api/purchases');
        const tbody = document.getElementById('purchase-history-body');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No purchases yet</td></tr>'; return; }
        tbody.innerHTML = list.map(p => `<tr>
            <td><strong>${esc(p.purchase_no)}</strong></td>
            <td>${esc(p.supplier_name)}</td>
            <td>${p.total_items}</td>
            <td>₹${Number(p.total_amount).toFixed(2)}</td>
            <td>${formatDateTime(p.created_at)}</td>
        </tr>`).join('');
    } catch(e) {}
}

// ===== RETURNS UI =====
let returnBillData = null;
async function loadBillForReturn() {
    const q = document.getElementById('return-bill-search')?.value?.trim();
    if (!q) { showToast('Enter bill number', 'error'); return; }
    try {
        const sales = await api('/api/sales');
        const list = sales.items || sales;
        const sale = list.find(s => s.bill_no === q || s.bill_no.includes(q));
        if (!sale) { showToast('Bill not found', 'error'); return; }
        const detail = await api('/api/sales/' + sale.id);
        returnBillData = detail;
        document.getElementById('return-bill-card').style.display = 'block';
        document.getElementById('return-bill-title').textContent = detail.bill_no + ' — ' + detail.customer_name;
        document.getElementById('return-items-body').innerHTML = detail.items.map(i => `
            <tr>
                <td>${esc(i.medicine_name)}</td>
                <td>${esc(i.batch_number)}</td>
                <td>${i.quantity}</td>
                <td><input type="number" id="ret-qty-${i.medicine_id}" min="0" max="${i.quantity}" value="0" style="width:70px;padding:6px;border:1px solid var(--border);border-radius:6px"></td>
                <td>₹${Number(i.unit_price).toFixed(2)}</td>
            </tr>
        `).join('');
    } catch(e) {}
}
async function submitReturn() {
    if (!returnBillData) return;
    const items = [];
    for (const i of returnBillData.items) {
        const qty = parseInt(document.getElementById('ret-qty-' + i.medicine_id)?.value || 0, 10);
        if (qty > 0) items.push({ medicine_id: i.medicine_id, quantity: qty });
    }
    if (!items.length) { showToast('Enter return quantities', 'error'); return; }
    try {
        const result = await api('/api/returns', {
            method: 'POST',
            body: JSON.stringify({
                sale_id: returnBillData.id,
                items,
                reason: document.getElementById('return-reason')?.value || 'Customer return'
            })
        });
        showToast('Return: ' + result.return_no + ' ₹' + result.amount, 'success');
        returnBillData = null;
        document.getElementById('return-bill-card').style.display = 'none';
        loadReturnsHistory();
        loadStats();
    } catch(e) {}
}
async function loadReturnsHistory() {
    try {
        const list = await api('/api/returns');
        const tbody = document.getElementById('returns-history-body');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty">No returns</td></tr>'; return; }
        tbody.innerHTML = list.map(r => `<tr>
            <td><strong>${esc(r.return_no)}</strong></td>
            <td>${esc(r.bill_no)}</td>
            <td>${esc(r.customer_name)}</td>
            <td>₹${Number(r.total_amount).toFixed(2)}</td>
            <td>${formatDateTime(r.created_at)}</td>
        </tr>`).join('');
    } catch(e) {}
}

// ===== NEAR EXPIRY =====
async function loadExpiryList() {
    const filter = document.getElementById('expiry-filter')?.value || 'near';
    try {
        const meds = await api('/api/medicines?expiry=' + filter);
        const list = meds.items || meds;
        const tbody = document.getElementById('expiry-body');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty">None found</td></tr>'; return; }
        tbody.innerHTML = list.map(m => `<tr>
            <td><strong>${esc(m.name)}</strong></td>
            <td>${esc(m.batch_number)}</td>
            <td>${m.quantity}</td>
            <td>${formatDate(m.expiry_date)}</td>
            <td class="${m.days_left < 0 ? 'qty-out' : m.days_left <= 30 ? 'qty-low' : ''}">${m.days_left}</td>
            <td>${statusBadge(m)}</td>
            <td>
                <button class="btn btn-secondary btn-sm" onclick="adjustStock(${m.id},${m.quantity},'${esc(m.name)}')">Adjust</button>
            </td>
        </tr>`).join('');
    } catch(e) {}
}

async function adjustStock(id, currentQty, name) {
    const newQty = prompt(`Adjust stock for ${name}\nCurrent: ${currentQty}\nEnter new quantity:`, currentQty);
    if (newQty === null) return;
    const reason = prompt('Reason:', 'Stock count correction') || 'Adjustment';
    try {
        await api('/api/stock-adjust', {
            method: 'POST',
            body: JSON.stringify({ medicine_id: id, new_quantity: parseInt(newQty, 10), reason })
        });
        showToast('Stock adjusted', 'success');
        loadExpiryList(); loadMedicines(); loadStats();
    } catch(e) {}
}

// ===== EXPENSES =====
async function addExpense() {
    const title = document.getElementById('exp-title')?.value?.trim();
    const amount = parseFloat(document.getElementById('exp-amount')?.value || 0);
    const category = document.getElementById('exp-category')?.value || 'General';
    if (!title || amount <= 0) { showToast('Enter title and amount', 'error'); return; }
    try {
        await api('/api/expenses', { method: 'POST', body: JSON.stringify({ title, amount, category }) });
        showToast('Expense added', 'success');
        document.getElementById('exp-title').value = '';
        document.getElementById('exp-amount').value = '';
        loadExpenses();
    } catch(e) {}
}
async function loadExpenses() {
    try {
        const list = await api('/api/expenses');
        const tbody = document.getElementById('expenses-body');
        if (!tbody) return;
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" class="empty">No expenses</td></tr>'; return; }
        tbody.innerHTML = list.map(e => `<tr>
            <td>${esc(e.expense_date)}</td>
            <td>${esc(e.title)}</td>
            <td>${esc(e.category)}</td>
            <td>₹${Number(e.amount).toFixed(2)}</td>
        </tr>`).join('');
    } catch(e) {}
}

// ===== GLOBAL SEARCH (Ctrl+K) =====
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('global-search')?.focus();
    }
});

let _gsT;
document.getElementById('global-search')?.addEventListener('input', (e) => {
    clearTimeout(_gsT);
    _gsT = setTimeout(async () => {
        const q = e.target.value.trim();
        const el = document.getElementById('global-search-results');
        if (!q) { el.classList.remove('show'); return; }
        try {
            const data = await api('/api/global-search?q=' + encodeURIComponent(q));
            let html = '';
            if (data.medicines?.length) {
                html += '<div style="padding:6px 12px;font-size:11px;color:#64748b;font-weight:600">MEDICINES</div>';
                html += data.medicines.map(m => `<div class="search-result-item" onclick="switchView('inventory');document.getElementById('search-input').value='${esc(m.name)}';loadMedicines()">
                    ${esc(m.name)} <span class="meta">Qty ${m.quantity} · ₹${m.mrp}</span></div>`).join('');
            }
            if (data.sales?.length) {
                html += '<div style="padding:6px 12px;font-size:11px;color:#64748b;font-weight:600">BILLS</div>';
                html += data.sales.map(s => `<div class="search-result-item" onclick="viewBill(${s.id})">${esc(s.bill_no)} · ${esc(s.customer_name)} · ₹${s.total_amount}</div>`).join('');
            }
            if (data.customers?.length) {
                html += '<div style="padding:6px 12px;font-size:11px;color:#64748b;font-weight:600">CUSTOMERS</div>';
                html += data.customers.map(c => `<div class="search-result-item" onclick="switchView('customers')">${esc(c.name)} · ${esc(c.phone||'')} · Bal ₹${c.balance}</div>`).join('');
            }
            el.innerHTML = html || '<div class="search-result-item">No results</div>';
            el.classList.add('show');
        } catch(e) {}
    }, 250);
});

// ===== WHATSAPP BILL SHARE =====
function shareBillWhatsApp(sale) {
    if (!sale) return;
    let text = `*${sale.shop_name || 'MediStock'}*\nBill: ${sale.bill_no}\nCustomer: ${sale.customer_name}\nDate: ${sale.created_at}\n\n`;
    (sale.items || []).forEach(i => {
        text += `• ${i.medicine_name} x${i.quantity} = ₹${Number(i.total_price).toFixed(2)}\n`;
    });
    text += `\n*Total: ₹${Number(sale.total_amount).toFixed(2)}*\nThank you!`;
    window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank');
}

// Enhance viewBill to store last sale for whatsapp + thermal
let lastViewedSale = null;
const _origViewBill = typeof viewBill === 'function' ? viewBill : null;

// Override printBill for thermal support - already exists, enhance share button via bill modal

// ===== SWITCH VIEW EXTENSIONS =====
const _origSwitch = switchView;
switchView = function(viewName) {
    _origSwitch(viewName);
    if (viewName === 'quicksale') { qsCart = []; renderQsCart(); setTimeout(() => document.getElementById('qs-search')?.focus(), 100); }
    if (viewName === 'purchase') { if (!purchaseRows.length) addPurchaseRow(); loadPurchaseHistory(); }
    if (viewName === 'returns') loadReturnsHistory();
    if (viewName === 'expiry') loadExpiryList();
    if (viewName === 'expenses') loadExpenses();
    if (viewName === 'settings') { loadAudit(); loadSettingsForm(); loadUsers(); }
};

// QS search events
document.getElementById('qs-search')?.addEventListener('input', e => {
    clearTimeout(window._qsT);
    window._qsT = setTimeout(() => qsSearch(e.target.value), 200);
});
document.getElementById('qs-search')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); qsSearch(e.target.value); }
});
document.getElementById('qs-discount')?.addEventListener('input', renderQsCart);

// Settings helpers
async function loadSettingsForm() {
    try {
        const s = await api('/api/settings');
        const box = document.getElementById('settings-extra');
        if (!box) return;
        box.innerHTML = `
            <div class="form-group" style="margin-bottom:12px"><label>Shop Name</label>
                <input type="text" id="set-shop-name" value="${esc(s.shop_name||'')}"></div>
            <div class="form-group" style="margin-bottom:12px"><label>Bill Prefix</label>
                <input type="text" id="set-bill-prefix" value="${esc(s.bill_prefix||'BILL')}"></div>
            <div class="form-group" style="margin-bottom:12px"><label>Thermal Width</label>
                <select id="set-thermal"><option value="80" ${s.thermal_width==='80'?'selected':''}>80mm</option>
                <option value="58" ${s.thermal_width==='58'?'selected':''}>58mm</option></select></div>
            <div class="form-group" style="margin-bottom:12px"><label>Shop Phone</label>
                <input type="text" id="set-phone" value="${esc(s.shop_phone||'')}"></div>
            <button class="btn btn-primary" onclick="saveSettings()">Save Settings</button>
            <button class="btn btn-secondary" onclick="doBackup()" style="margin-left:8px">Backup Database</button>
            <button class="btn btn-secondary" onclick="window.open('/api/reports/export?period=month','_blank')" style="margin-left:8px">Export Excel (CSV)</button>
        `;
    } catch(e) {}
}
async function saveSettings() {
    try {
        await api('/api/settings', { method: 'POST', body: JSON.stringify({
            shop_name: document.getElementById('set-shop-name')?.value,
            bill_prefix: document.getElementById('set-bill-prefix')?.value,
            thermal_width: document.getElementById('set-thermal')?.value,
            shop_phone: document.getElementById('set-phone')?.value
        })});
        showToast('Settings saved', 'success');
    } catch(e) {}
}
async function doBackup() {
    try {
        const r = await api('/api/backup', { method: 'POST' });
        showToast('Backup: ' + r.file, 'success');
    } catch(e) {}
}
async function loadUsers() {
    try {
        const users = await api('/api/users');
        const box = document.getElementById('users-list');
        if (!box) return;
        box.innerHTML = users.map(u => `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
            <strong>${esc(u.username)}</strong> — ${esc(u.full_name)} <span class="badge badge-type">${esc(u.role)}</span>
        </div>`).join('') + `
        <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:8px">
            <input id="new-user-name" placeholder="Username" style="padding:8px;border:1px solid var(--border);border-radius:6px">
            <input id="new-user-full" placeholder="Full name" style="padding:8px;border:1px solid var(--border);border-radius:6px">
            <input id="new-user-pass" type="password" placeholder="Password" style="padding:8px;border:1px solid var(--border);border-radius:6px">
            <button class="btn btn-primary btn-sm" onclick="createUser()">Add</button>
        </div>`;
    } catch(e) { /* admin only */ }
}
async function createUser() {
    try {
        await api('/api/users', { method: 'POST', body: JSON.stringify({
            username: document.getElementById('new-user-name')?.value,
            full_name: document.getElementById('new-user-full')?.value,
            password: document.getElementById('new-user-pass')?.value,
            role: 'staff'
        })});
        showToast('User created', 'success');
        loadUsers();
    } catch(e) {}
}

// Patch titles
const _titles = {
    quicksale: ['Quick Sale', 'Scan → Qty → Pay → Print'],
    purchase: ['Purchase', 'Record supplier purchases'],
    returns: ['Returns', 'Process medicine returns'],
    expiry: ['Near Expiry', 'Expired and soon-to-expire stock'],
    expenses: ['Expenses', 'Shop expense tracking']
};

// ===== LOADING SPINNER =====
function showLoading() {
    document.getElementById('loading-overlay')?.classList.add('show');
}
function hideLoading() {
    document.getElementById('loading-overlay')?.classList.remove('show');
}

// Wrap api() to show spinner on mutations
const _apiRaw = api;
api = async function(url, options = {}) {
    const method = (options.method || 'GET').toUpperCase();
    if (method !== 'GET') showLoading();
    try {
        return await _apiRaw(url, options);
    } finally {
        if (method !== 'GET') hideLoading();
    }
};

// ===== DARK MODE =====
function toggleDarkMode() {
    document.body.classList.toggle('dark');
    const on = document.body.classList.contains('dark');
    localStorage.setItem('medistock_dark', on ? '1' : '0');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = on ? '☀️ Light Mode' : '🌙 Dark Mode';
    const hdr = document.getElementById('theme-toggle-header');
    if (hdr) hdr.textContent = on ? '☀️' : '🌙';
}
if (localStorage.getItem('medistock_dark') === '1') {
    document.body.classList.add('dark');
    const btn = document.getElementById('theme-toggle');
    if (btn) btn.textContent = '☀️ Light Mode';
}

function toggleCounterMode() {
    document.body.classList.toggle('counter-mode');
    const on = document.body.classList.contains('counter-mode');
    localStorage.setItem('medistock_counter', on ? '1' : '0');
    const btn = document.getElementById('counter-mode-btn');
    if (btn) btn.textContent = on ? '🖥️ Normal UI' : '🖥️ Counter UI';
}
if (localStorage.getItem('medistock_counter') === '1') {
    document.body.classList.add('counter-mode');
}

function showShortcuts() {
    document.getElementById('shortcuts-modal')?.classList.add('show');
}

// ===== DASHBOARD CHARTS =====
async function loadCharts() {
    try {
        const data = await _apiRaw('/api/charts');
        const dailyEl = document.getElementById('chart-daily');
        const payEl = document.getElementById('chart-payments');
        if (dailyEl && data.daily) {
            const max = Math.max(...data.daily.map(d => d.amount), 1);
            dailyEl.innerHTML = '<div class="bar-chart">' + data.daily.map(d => {
                const h = Math.max(4, (d.amount / max) * 100);
                return `<div class="bar-col">
                    <div class="bar-value">${d.amount ? '₹'+Math.round(d.amount) : ''}</div>
                    <div class="bar-fill" style="height:${h}%"></div>
                    <div class="bar-label">${d.label}</div>
                </div>`;
            }).join('') + '</div>';
        }
        if (payEl && data.payment_modes) {
            const max = Math.max(...data.payment_modes.map(m => m.amount), 1);
            if (!data.payment_modes.length) {
                payEl.innerHTML = '<p class="empty">No payments yet</p>';
            } else {
                payEl.innerHTML = '<div class="pay-bars">' + data.payment_modes.map(m => {
                    const pct = (m.amount / max) * 100;
                    return `<div class="pay-row">
                        <span class="label">${esc(m.payment_mode)}</span>
                        <div class="track"><div class="fill" style="width:${pct}%"></div></div>
                        <span class="amt">₹${Number(m.amount).toFixed(0)}</span>
                    </div>`;
                }).join('') + '</div>';
            }
        }
    } catch(e) {}
}

// Payment collection on reports
async function loadPaymentReport() {
    const period = document.getElementById('report-period')?.value || 'today';
    try {
        const data = await _apiRaw('/api/reports/payments?period=' + period);
        let box = document.getElementById('payment-collection-box');
        if (!box) {
            const reports = document.getElementById('reports-view');
            if (!reports) return;
            box = document.createElement('div');
            box.id = 'payment-collection-box';
            box.className = 'card';
            box.style.marginTop = '16px';
            reports.appendChild(box);
        }
        box.innerHTML = `<div class="card-header"><h3>Payment Collection</h3></div>
            <div class="table-wrapper"><table>
                <thead><tr><th>Mode</th><th>Bills</th><th>Amount</th><th>Profit</th></tr></thead>
                <tbody>
                ${(data.modes||[]).map(m => `<tr>
                    <td><strong>${esc(m.payment_mode)}</strong></td>
                    <td>${m.bills}</td>
                    <td>₹${Number(m.amount).toFixed(2)}</td>
                    <td>₹${Number(m.profit||0).toFixed(2)}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="empty">No data</td></tr>'}
                </tbody>
            </table></div>
            <div style="padding:12px 16px;font-weight:600">Total: ₹${Number(data.total_amount).toFixed(2)} (${data.total_bills} bills)</div>`;
    } catch(e) {}
}

// Hook charts into dashboard load
const _loadStatsOrig = loadStats;
loadStats = async function() {
    await _loadStatsOrig();
    loadCharts();
};

const _loadReportOrig = typeof loadReport === 'function' ? loadReport : null;
if (_loadReportOrig) {
    loadReport = async function() {
        await _loadReportOrig();
        loadPaymentReport();
    };
}

// ===== CONFIRM BEFORE DELETE (already has modal; strengthen generic) =====
function confirmAction(message) {
    return window.confirm(message);
}

// Ensure delete uses confirm - already has modal via confirmDelete

// ===== DOCTOR + PACK in sale/medicine forms =====
const _completeSaleOrig = completeSale;
completeSale = async function() {
    if (cart.length === 0) return;
    const customerName = document.getElementById('customer-name')?.value.trim();
    const doctorName = document.getElementById('doctor-name')?.value.trim() || '';
    const paymentMode = document.getElementById('payment-mode')?.value || 'Cash';
    const discount = parseFloat(document.getElementById('bill-discount')?.value || 0) || 0;
    const payload = {
        customer_name: customerName || 'Walk-in Customer',
        doctor_name: doctorName,
        payment_mode: paymentMode,
        discount: discount,
        items: cart.map(c => ({ medicine_id: c.medicine_id, quantity: c.quantity }))
    };
    try {
        const result = await api('/api/sales', { method: 'POST', body: JSON.stringify(payload) });
        showToast(`Sale completed! Bill: ${result.bill_no}`, 'success');
        cart = [];
        if (document.getElementById('customer-name')) document.getElementById('customer-name').value = '';
        if (document.getElementById('doctor-name')) document.getElementById('doctor-name').value = '';
        if (document.getElementById('bill-discount')) document.getElementById('bill-discount').value = 0;
        if (document.getElementById('payment-mode')) document.getElementById('payment-mode').value = 'Cash';
        renderCart();
        loadSaleStock();
        loadStats();
        viewBill(result.sale_id);
    } catch(e) {}
};

// Pack size in medicine payload
const _handleSubmitRef = typeof handleSubmit === 'function';
// patch via redefinition is hard; ensure form fields included when present:
document.getElementById('medicine-form')?.addEventListener('submit', function() {
    // fields units_per_strip and sell_unit will be read if we extend handleSubmit
}, true);

// Extend keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const map = {
        'F1': 'quicksale', 'F2': 'sales', 'F3': 'inventory', 'F4': 'dashboard',
        'F5': 'reports', 'F6': 'purchase', 'F7': 'returns', 'F8': 'expiry', 'F9': 'add'
    };
    if (map[e.key]) { e.preventDefault(); switchView(map[e.key]); }
    if (e.key === 'F10') { e.preventDefault(); holdCurrentBill(document.getElementById('quicksale-view')?.classList.contains('active') ? 'qs' : 'sales'); }
    if (e.key === 'F12') { e.preventDefault(); showShortcuts(); }
});

// Include pack fields when saving medicine - monkey patch handleSubmit body by wrapping form
(function() {
    const form = document.getElementById('medicine-form');
    if (!form) return;
    form.addEventListener('submit', function(e) {
        // After a tick, the original handler runs; we also ensure values exist in DOM
        // Original handleSubmit reads known fields - we need to patch it
    });
})();
