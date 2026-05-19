const express = require('express');
const router = express.Router();
const { db } = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'einkauf');
const TMP_DIR     = path.join(__dirname, '..', 'uploads', 'tmp');
[UPLOADS_DIR, TMP_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `eingang_${Date.now()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Nur PDF-Dateien erlaubt'));
  }
});

const scanStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `scan_${Date.now()}${ext}`);
  }
});
const scanUpload = multer({
  storage: scanStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Nur Bilder (JPG, PNG, WEBP) oder PDF erlaubt'));
  }
});

// Serve uploaded PDFs
router.get('/uploads/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);
  if (!fs.existsSync(filePath)) return res.status(404).send('Datei nicht gefunden');
  res.sendFile(filePath);
});

// Product list grouped by supplier → category (with canonical name support)
router.get('/produkte', async (req, res) => {
  const rows = await db.execute(`
    SELECT pit.product_name, pit.unit, pit.unit_price, pit.line_total, pit.quantity,
           pit.category, s.name as supplier_name, pi.date, pi.id as invoice_id,
           COALESCE(pa.canonical_name, pit.product_name) as display_name
    FROM purchase_items pit
    JOIN purchase_invoices pi ON pit.purchase_invoice_id = pi.id
    JOIN suppliers s ON pi.supplier_id = s.id
    LEFT JOIN product_aliases pa ON pit.product_name = pa.product_name
    ORDER BY s.name ASC, pit.category ASC, display_name ASC, pi.date DESC
  `);

  // Group: supplier_name → category → display_name → { displayName, originalNames[], hasAlias, entries[] }
  const bySupplier = {};
  rows.rows.forEach(row => {
    const sup = row.supplier_name || 'Unbekannt';
    const cat = row.category || 'Sonstiges';
    const key = row.display_name;
    if (!bySupplier[sup]) bySupplier[sup] = {};
    if (!bySupplier[sup][cat]) bySupplier[sup][cat] = {};
    if (!bySupplier[sup][cat][key]) bySupplier[sup][cat][key] = { displayName: key, originalNames: [], hasAlias: false, entries: [] };
    bySupplier[sup][cat][key].entries.push(row);
    if (!bySupplier[sup][cat][key].originalNames.includes(row.product_name.trim()))
      bySupplier[sup][cat][key].originalNames.push(row.product_name.trim());
    if (row.display_name !== row.product_name) bySupplier[sup][cat][key].hasAlias = true;
  });

  const supplierNames = Object.keys(bySupplier);
  res.render('einkauf/produkte', { title: 'Einkauf – Produkte', bySupplier, supplierNames });
});

// Set / remove canonical alias for one or more product names
router.post('/produkte/alias', async (req, res) => {
  const names  = Array.isArray(req.body.product_names) ? req.body.product_names : (req.body.product_names ? [req.body.product_names] : []);
  const alias  = (req.body.canonical_name || '').trim();
  for (const name of names) {
    if (!name.trim()) continue;
    if (!alias) {
      await db.execute('DELETE FROM product_aliases WHERE product_name = ?', [name.trim()]);
    } else {
      await db.execute(
        'INSERT INTO product_aliases (product_name, canonical_name) VALUES (?, ?) ON CONFLICT(product_name) DO UPDATE SET canonical_name = excluded.canonical_name',
        [name.trim(), alias]
      );
    }
  }
  res.json({ ok: true });
});

// Scan form
router.get('/scan', (req, res) => {
  res.render('einkauf/scan', { title: 'Einkauf – Rechnung scannen' });
});

// Process scan with Claude AI
router.post('/scan', scanUpload.single('scan_file'), async (req, res) => {
  if (!req.file) {
    req.flash('error', 'Keine Datei hochgeladen.');
    return res.redirect('/einkauf/scan');
  }

  try {
    const { extractInvoiceData } = require('../services/ocr');
    const extracted = await extractInvoiceData(req.file.path, req.file.mimetype);
    fs.unlink(req.file.path, () => {});

    const suppliers = await db.execute('SELECT * FROM suppliers ORDER BY name');
    const today = new Date().toISOString().split('T')[0];
    res.render('einkauf/form', {
      title: 'Eingangsrechnung erfassen',
      suppliers: suppliers.rows,
      today,
      scanData: extracted
    });
  } catch (err) {
    fs.unlink(req.file?.path || '', () => {});
    console.error('OCR Fehler:', err);
    req.flash('error', `Fehler: ${err.message}`);
    res.redirect('/einkauf/scan');
  }
});

// Price comparison
router.get('/preisvergleich', async (req, res) => {
  const items = await db.execute(`
    SELECT pit.product_name, pit.quantity, pit.unit, pit.unit_price,
           s.name as supplier_name, pi.date, pi.id as invoice_id
    FROM purchase_items pit
    JOIN purchase_invoices pi ON pit.purchase_invoice_id = pi.id
    JOIN suppliers s ON pi.supplier_id = s.id
    ORDER BY pit.product_name ASC, pi.date DESC
  `);

  const grouped = {};
  items.rows.forEach(item => {
    const key = item.product_name.trim();
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(item);
  });

  res.render('einkauf/preisvergleich', { title: 'Einkauf – Preisvergleich', grouped });
});

// List
router.get('/', async (req, res) => {
  const invoices = await db.execute(`
    SELECT pi.*, s.name as supplier_name,
           COUNT(pit.id) as item_count,
           SUM(COALESCE(pit.line_total, pit.quantity * pit.unit_price)) as total
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON pi.supplier_id = s.id
    LEFT JOIN purchase_items pit ON pit.purchase_invoice_id = pi.id
    GROUP BY pi.id
    ORDER BY pi.date DESC, pi.created_at DESC
  `);
  res.render('einkauf/index', { title: 'Einkauf', invoices: invoices.rows });
});

// New form
router.get('/neu', async (req, res) => {
  const suppliers = await db.execute('SELECT * FROM suppliers ORDER BY name');
  const today = new Date().toISOString().split('T')[0];
  res.render('einkauf/form', { title: 'Eingangsrechnung erfassen', suppliers: suppliers.rows, today, scanData: null });
});

// Create
router.post('/neu', upload.single('pdf'), async (req, res) => {
  const { supplier_name, invoice_number, date, notes, item_name, item_qty, item_unit, item_price, billing_month } = req.body;

  if (!supplier_name?.trim() || !date) {
    req.flash('error', 'Lieferant und Datum sind erforderlich.');
    return res.redirect('/einkauf/neu');
  }

  const billingMonth = billing_month?.trim() || '';

  let supplierRes = await db.execute('SELECT id FROM suppliers WHERE name = ?', [supplier_name.trim()]);
  let supplierId;
  if (supplierRes.rows[0]) {
    supplierId = supplierRes.rows[0].id;
  } else {
    const ins = await db.execute('INSERT INTO suppliers (name) VALUES (?)', [supplier_name.trim()]);
    supplierId = Number(ins.lastInsertRowid);
  }

  const pdfFilename = req.file ? req.file.filename : '';
  const invRes = await db.execute(
    'INSERT INTO purchase_invoices (supplier_id, invoice_number, date, notes, pdf_filename, billing_month) VALUES (?, ?, ?, ?, ?, ?)',
    [supplierId, invoice_number?.trim() || '', date, notes?.trim() || '', pdfFilename, billingMonth]
  );
  const invoiceId = Number(invRes.lastInsertRowid);

  const { CATEGORIES } = require('../services/ocr');
  const names      = Array.isArray(item_name)             ? item_name             : (item_name             ? [item_name]             : []);
  const qtys       = Array.isArray(item_qty)              ? item_qty              : (item_qty              ? [item_qty]              : []);
  const units      = Array.isArray(item_unit)             ? item_unit             : (item_unit             ? [item_unit]             : []);
  const prices     = Array.isArray(item_price)            ? item_price            : (item_price            ? [item_price]            : []);
  const lineTotals = Array.isArray(req.body.item_line_total)  ? req.body.item_line_total  : (req.body.item_line_total  ? [req.body.item_line_total]  : []);
  const categories = Array.isArray(req.body.item_category)    ? req.body.item_category    : (req.body.item_category    ? [req.body.item_category]    : []);

  for (let i = 0; i < names.length; i++) {
    if (!names[i]?.trim()) continue;
    const qty       = parseFloat(String(qtys[i]   || '1').replace(',', '.')) || 1;
    const price     = parseFloat(String(prices[i] || '0').replace(',', '.')) || 0;
    const unit      = units[i]?.trim() || 'kg';
    const lineTotal = lineTotals[i] ? parseFloat(String(lineTotals[i]).replace(',', '.')) : null;
    const category  = CATEGORIES.includes(categories[i]) ? categories[i] : 'Sonstiges';
    await db.execute(
      'INSERT INTO purchase_items (purchase_invoice_id, product_name, quantity, unit, unit_price, line_total, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [invoiceId, names[i].trim(), qty, unit, price, isNaN(lineTotal) ? null : lineTotal, category]
    );
  }

  req.flash('success', `Eingangsrechnung von "${supplier_name.trim()}" wurde gespeichert.`);
  res.redirect('/einkauf');
});

// Detail view
router.get('/:id', async (req, res) => {
  const invRes = await db.execute(`
    SELECT pi.*, s.name as supplier_name
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON pi.supplier_id = s.id
    WHERE pi.id = ?
  `, [+req.params.id]);
  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/einkauf'); }

  const itemsRes = await db.execute(
    'SELECT * FROM purchase_items WHERE purchase_invoice_id = ? ORDER BY id',
    [+req.params.id]
  );
  res.render('einkauf/view', {
    title: `Eingangsrechnung – ${invoice.supplier_name || 'Unbekannt'}`,
    invoice,
    items: itemsRes.rows
  });
});

// Delete
router.post('/:id/loeschen', async (req, res) => {
  const invRes = await db.execute(`
    SELECT pi.*, s.name as supplier_name
    FROM purchase_invoices pi
    LEFT JOIN suppliers s ON pi.supplier_id = s.id
    WHERE pi.id = ?
  `, [+req.params.id]);
  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/einkauf'); }

  if (invoice.pdf_filename) {
    fs.unlink(path.join(UPLOADS_DIR, invoice.pdf_filename), () => {});
  }

  await db.execute('DELETE FROM purchase_invoices WHERE id = ?', [+req.params.id]);
  req.flash('success', `Eingangsrechnung von "${invoice.supplier_name}" gelöscht.`);
  res.redirect('/einkauf');
});

module.exports = router;
