const express = require('express');
const router = express.Router();
const { db } = require('../db');
const generatePDF = require('../services/pdf');

router.get('/', async (req, res) => {
  const { search, sort = 'desc' } = req.query;
  const order = sort === 'asc' ? 'ASC' : 'DESC';

  let sql = `
    SELECT i.id, i.invoice_number, i.date, i.delivery_from, i.delivery_to, i.order_number,
      c.name as customer_name,
      (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
    FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
  `;
  const args = [];

  if (search) {
    sql += ` WHERE (CAST(i.invoice_number AS TEXT) LIKE ? OR c.name LIKE ? OR i.order_number LIKE ?)`;
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ` ORDER BY i.invoice_number ${order}`;

  const result = await db.execute(sql, args);
  res.render('invoices/index', { title: 'Rechnungen', invoices: result.rows, search: search || '', sort });
});

router.get('/neu', async (req, res) => {
  const [custRes, artRes, lastRes] = await Promise.all([
    db.execute('SELECT * FROM customers ORDER BY name'),
    db.execute('SELECT * FROM articles WHERE active = 1 ORDER BY name'),
    db.execute('SELECT MAX(invoice_number) as max FROM invoices')
  ]);
  const nextNumber = (Number(lastRes.rows[0].max) || 247) + 1;
  const today = new Date().toISOString().split('T')[0];
  res.render('invoices/new', { title: 'Neue Rechnung', customers: custRes.rows, articles: artRes.rows, nextNumber, today, editInvoice: null, editItems: [] });
});

router.post('/neu', async (req, res) => {
  const { invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes, item_name, item_qty, item_price } = req.body;

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
    `INSERT INTO invoices (invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [+invoice_number, date, delivery_from || '', delivery_to || '', +customer_id, order_number || '', notes || '']
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
    SELECT i.*, c.name as customer_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_contact, c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
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
      c.delivery_contact, c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
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

  const [custRes, artRes, itemsRes] = await Promise.all([
    db.execute('SELECT * FROM customers ORDER BY name'),
    db.execute('SELECT * FROM articles WHERE active = 1 ORDER BY name'),
    db.execute('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order', [invoice.id])
  ]);

  res.render('invoices/new', {
    title: 'Rechnung bearbeiten', customers: custRes.rows, articles: artRes.rows,
    nextNumber: invoice.invoice_number, today: invoice.date,
    editInvoice: invoice, editItems: itemsRes.rows
  });
});

router.post('/:id/bearbeiten', async (req, res) => {
  const { invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes, item_name, item_qty, item_price } = req.body;

  const validItems = parseItems(item_name, item_qty, item_price);
  if (!validItems.length) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect(`/rechnungen/${req.params.id}/bearbeiten`);
  }

  await db.execute(
    `UPDATE invoices SET invoice_number=?, date=?, delivery_from=?, delivery_to=?, customer_id=?, order_number=?, notes=? WHERE id=?`,
    [+invoice_number, date, delivery_from || '', delivery_to || '', +customer_id, order_number || '', notes || '', +req.params.id]
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

router.post('/:id/loeschen', async (req, res) => {
  const invRes = await db.execute('SELECT invoice_number FROM invoices WHERE id = ?', [+req.params.id]);
  const invoice = invRes.rows[0];
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }
  await db.execute('DELETE FROM invoices WHERE id = ?', [+req.params.id]);
  req.flash('success', `Rechnung Nr. ${invoice.invoice_number} gelöscht.`);
  res.redirect('/rechnungen');
});

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
