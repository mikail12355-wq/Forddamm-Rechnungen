const express = require('express');
const router = express.Router();
const { PassThrough } = require('stream');
const archiver = require('archiver');
const { db } = require('../db');
const generatePDF = require('../services/pdf');

router.get('/', async (req, res) => {
  const { search, sort = 'desc', status = 'all', year = 'all', period = 'all' } = req.query;
  const [result, yearsRes] = await Promise.all([
    queryInvoices({ search, sort, status, year, period }),
    db.execute("SELECT DISTINCT strftime('%Y', date) as y FROM invoices ORDER BY y DESC")
  ]);
  const years = yearsRes.rows.map(r => r.y).filter(Boolean);
  res.render('invoices/index', { title: 'Rechnungen', invoices: result.rows, search: search || '', sort, status, year, period, years });
});

router.get('/export', async (req, res) => {
  try {
    const { search, sort = 'desc', status = 'all', year = 'all', period = 'all' } = req.query;
    const listResult = await queryInvoices({ search, sort, status, year, period });
    const invRows = listResult.rows;

    if (invRows.length === 0) {
      req.flash('error', 'Keine Rechnungen für den gewählten Filter gefunden.');
      return res.redirect('/rechnungen');
    }

    // Alle Rechnungen mit vollständigen Kundendaten + alle Items in 2 Abfragen laden
    const ids = invRows.map(r => r.id);
    const ph  = ids.map(() => '?').join(',');
    const [fullRes, itemsRes] = await Promise.all([
      db.execute(`
        SELECT i.*, c.name as customer_name, c.billing_street, c.billing_zip, c.billing_city,
          c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
        WHERE i.id IN (${ph}) ORDER BY i.invoice_number ASC
      `, ids),
      db.execute(`
        SELECT * FROM invoice_items WHERE invoice_id IN (${ph}) ORDER BY invoice_id, sort_order
      `, ids)
    ]);

    const itemsByInvoice = {};
    for (const item of itemsRes.rows) {
      if (!itemsByInvoice[item.invoice_id]) itemsByInvoice[item.invoice_id] = [];
      itemsByInvoice[item.invoice_id].push(item);
    }

    // ZIP-Dateiname aus aktiven Filtern zusammensetzen
    const mNames = ['Jan','Feb','Maer','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
    const qNames = { Q1:'Q1_Jan-Maer', Q2:'Q2_Apr-Jun', Q3:'Q3_Jul-Sep', Q4:'Q4_Okt-Dez' };
    let parts = ['Rechnungen'];
    if (year   !== 'all') parts.push(year);
    if (period !== 'all') parts.push(period.startsWith('Q') ? qNames[period] : mNames[parseInt(period,10)-1]);
    if (status === 'paid') parts.push('Bezahlt');
    if (status === 'open') parts.push('Offen');
    const zipName = parts.join('-') + '.zip';

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);

    for (const invoice of fullRes.rows) {
      const items = itemsByInvoice[invoice.id] || [];
      const pt = new PassThrough();
      archive.append(pt, { name: `Rechnung-${invoice.invoice_number}.pdf` });
      generatePDF(invoice, items, pt);
    }

    await archive.finalize();
  } catch (err) {
    console.error('ZIP export error:', err);
    if (!res.headersSent) res.status(500).send('Export fehlgeschlagen: ' + err.message);
  }
});

router.get('/neu', async (req, res) => {
  const [custRes, artRes, lastRes, pricesRes] = await Promise.all([
    db.execute('SELECT * FROM customers ORDER BY name'),
    db.execute('SELECT * FROM articles WHERE active = 1 ORDER BY name'),
    db.execute('SELECT MAX(invoice_number) as max FROM invoices'),
    db.execute('SELECT customer_id, article_id, unit_price FROM customer_prices')
  ]);
  const nextNumber = (Number(lastRes.rows[0].max) || 247) + 1;
  const today = new Date().toISOString().split('T')[0];
  const customerPricesMap = buildPricesMap(pricesRes.rows);
  res.render('invoices/new', { title: 'Neue Rechnung', customers: custRes.rows, articles: artRes.rows, nextNumber, today, editInvoice: null, editItems: [], customerPricesMap });
});

router.post('/neu', async (req, res) => {
  const { invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes, delivery_contact, item_name, item_qty, item_price } = req.body;

  if (!invoice_number || !date || !customer_id) {
    req.flash('error', 'Bitte alle Pflichtfelder ausfüllen.');
    return res.redirect('/rechnungen/neu');
  }

  const existing = await db.execute('SELECT id FROM invoices WHERE invoice_number = ?', [+invoice_number]);
  if (existing.rows[0]) {
    req.flash('error', `Rechnung Nr. ${invoice_number} existiert bereits.`);
    return res.redirect('/rechnungen/neu');
  }

  const validItems = parseItems(item_name, item_qty, item_price);
  if (!validItems.length) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect('/rechnungen/neu');
  }

  const invRes = await db.execute(
    `INSERT INTO invoices (invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes, delivery_contact) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [+invoice_number, date, delivery_from || '', delivery_to || '', +customer_id, order_number || '', notes || '', delivery_contact || '']
  );
  const invoiceId = Number(invRes.lastInsertRowid);

  for (let i = 0; i < validItems.length; i++) {
    const it = validItems[i];
    await db.execute(
      'INSERT INTO invoice_items (invoice_id, article_name, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, it.name, it.qty, it.price, i]
    );
  }

  req.flash('success', `Rechnung Nr. ${invoice_number} wurde erstellt.`);
  res.redirect(`/rechnungen/${invoiceId}`);
});

router.get('/:id', async (req, res) => {
  const invRes = await db.execute(`
    SELECT i.*, i.paid, i.paid_at, c.name as customer_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `, [+req.params.id]);

  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }

  const itemsRes = await db.execute('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoice.id]);
  const items = itemsRes.rows;
  const totalNetto = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const ust = totalNetto * 0.07;

  res.render('invoices/view', { title: `Rechnung Nr. ${invoice.invoice_number}`, invoice, items, totalNetto, ust, totalBrutto: totalNetto + ust });
});

router.get('/:id/pdf', async (req, res) => {
  const invRes = await db.execute(`
    SELECT i.*, c.name as customer_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `, [+req.params.id]);

  const invoice = invRes.rows[0];
  if (!invoice) return res.status(404).send('Rechnung nicht gefunden');

  const itemsRes = await db.execute('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoice.id]);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Rechnung-${invoice.invoice_number}.pdf`);
  generatePDF(invoice, itemsRes.rows, res);
});

router.get('/:id/bearbeiten', async (req, res) => {
  const invRes = await db.execute(`
    SELECT i.*, c.name as customer_name FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `, [+req.params.id]);
  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }

  const [custRes, artRes, itemsRes, pricesRes] = await Promise.all([
    db.execute('SELECT * FROM customers ORDER BY name'),
    db.execute('SELECT * FROM articles WHERE active = 1 ORDER BY name'),
    db.execute('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoice.id]),
    db.execute('SELECT customer_id, article_id, unit_price FROM customer_prices')
  ]);
  const customerPricesMap = buildPricesMap(pricesRes.rows);

  res.render('invoices/new', {
    title: 'Rechnung bearbeiten', customers: custRes.rows, articles: artRes.rows,
    nextNumber: invoice.invoice_number, today: invoice.date,
    editInvoice: invoice, editItems: itemsRes.rows, customerPricesMap
  });
});

router.post('/:id/bearbeiten', async (req, res) => {
  const { invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes, delivery_contact, item_name, item_qty, item_price } = req.body;

  const validItems = parseItems(item_name, item_qty, item_price);
  if (!validItems.length) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect(`/rechnungen/${req.params.id}/bearbeiten`);
  }

  await db.execute(
    `UPDATE invoices SET invoice_number=?, date=?, delivery_from=?, delivery_to=?, customer_id=?, order_number=?, notes=?, delivery_contact=? WHERE id=?`,
    [+invoice_number, date, delivery_from || '', delivery_to || '', +customer_id, order_number || '', notes || '', delivery_contact || '', +req.params.id]
  );
  await db.execute('DELETE FROM invoice_items WHERE invoice_id = ?', [+req.params.id]);

  for (let i = 0; i < validItems.length; i++) {
    const it = validItems[i];
    await db.execute(
      'INSERT INTO invoice_items (invoice_id, article_name, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)',
      [+req.params.id, it.name, it.qty, it.price, i]
    );
  }

  req.flash('success', `Rechnung Nr. ${invoice_number} aktualisiert.`);
  res.redirect(`/rechnungen/${req.params.id}`);
});

router.post('/:id/zahlung', async (req, res) => {
  const invRes = await db.execute('SELECT paid FROM invoices WHERE id = ?', [+req.params.id]);
  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }
  const nowPaid = invoice.paid ? 0 : 1;
  const paidAt  = nowPaid ? new Date().toISOString().split('T')[0] : '';
  await db.execute('UPDATE invoices SET paid = ?, paid_at = ? WHERE id = ?', [nowPaid, paidAt, +req.params.id]);
  const back = req.body.back || '/rechnungen';
  res.redirect(back);
});

router.post('/:id/loeschen', async (req, res) => {
  const invRes = await db.execute('SELECT invoice_number FROM invoices WHERE id = ?', [+req.params.id]);
  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }
  await db.execute('DELETE FROM invoices WHERE id = ?', [+req.params.id]);
  req.flash('success', `Rechnung Nr. ${invoice.invoice_number} gelöscht.`);
  res.redirect('/rechnungen');
});

function queryInvoices({ search, sort = 'desc', status = 'all', year = 'all', period = 'all' }) {
  const order = sort === 'asc' ? 'ASC' : 'DESC';
  let sql = `
    SELECT i.id, i.invoice_number, i.date, i.delivery_from, i.delivery_to, i.order_number,
      i.paid, i.paid_at, c.name as customer_name,
      (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
  `;
  const args = [];
  const where = [];

  if (search) {
    where.push('(CAST(i.invoice_number AS TEXT) LIKE ? OR c.name LIKE ? OR i.order_number LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (status === 'paid') { where.push('i.paid = 1'); }
  if (status === 'open') { where.push('(i.paid = 0 OR i.paid IS NULL)'); }
  if (year !== 'all')    { where.push("strftime('%Y', i.date) = ?"); args.push(year); }
  if (period !== 'all') {
    const qMap = { Q1: ['01','02','03'], Q2: ['04','05','06'], Q3: ['07','08','09'], Q4: ['10','11','12'] };
    if (qMap[period]) {
      where.push(`strftime('%m', i.date) IN (${qMap[period].map(() => '?').join(',')})`);
      args.push(...qMap[period]);
    } else {
      where.push("strftime('%m', i.date) = ?");
      args.push(period.padStart(2, '0'));
    }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY i.invoice_number ${order}`;
  return db.execute(sql, args);
}

function buildPricesMap(rows) {
  const map = {};
  rows.forEach(r => {
    const cid = String(r.customer_id);
    if (!map[cid]) map[cid] = {};
    map[cid][String(r.article_id)] = r.unit_price;
  });
  return map;
}

function parseItems(item_name, item_qty, item_price) {
  const names  = Array.isArray(item_name)  ? item_name  : [item_name];
  const qtys   = Array.isArray(item_qty)   ? item_qty   : [item_qty];
  const prices = Array.isArray(item_price) ? item_price : [item_price];
  return names.map((n, i) => ({
    name:  n?.trim(),
    qty:   parseFloat(qtys[i])  || 0,
    price: parseFloat(String(prices[i]).replace(',', '.')) || 0
  })).filter(it => it.name && it.qty > 0 && it.price > 0);
}

module.exports = router;
