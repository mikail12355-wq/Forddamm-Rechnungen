const express = require('express');
const router = express.Router();
const db = require('../db');
const generatePDF = require('../services/pdf');

router.get('/', (req, res) => {
  const { search, sort = 'desc' } = req.query;
  const order = sort === 'asc' ? 'ASC' : 'DESC';

  let query = `
    SELECT i.*, c.name as customer_name,
      (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
  `;
  const params = [];

  if (search) {
    query += ` WHERE (CAST(i.invoice_number AS TEXT) LIKE ? OR c.name LIKE ? OR i.order_number LIKE ?)`;
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  query += ` ORDER BY i.invoice_number ${order}`;

  const invoices = db.prepare(query).all(...params);
  res.render('invoices/index', { title: 'Rechnungen', invoices, search: search || '', sort });
});

router.get('/neu', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY name').all();
  const articles = db.prepare('SELECT * FROM articles WHERE active = 1 ORDER BY name').all();
  const lastInvoice = db.prepare('SELECT MAX(invoice_number) as max FROM invoices').get();
  const nextNumber = (lastInvoice.max || 247) + 1;
  const today = new Date().toISOString().split('T')[0];

  res.render('invoices/new', { title: 'Neue Rechnung', customers, articles, nextNumber, today, editInvoice: null });
});

router.post('/neu', (req, res) => {
  const { invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes,
          item_name, item_qty, item_price } = req.body;

  if (!invoice_number || !date || !customer_id) {
    req.flash('error', 'Bitte alle Pflichtfelder ausfüllen.');
    return res.redirect('/rechnungen/neu');
  }

  const existing = db.prepare('SELECT id FROM invoices WHERE invoice_number = ?').get(+invoice_number);
  if (existing) {
    req.flash('error', `Rechnung Nr. ${invoice_number} existiert bereits.`);
    return res.redirect('/rechnungen/neu');
  }

  const names = Array.isArray(item_name) ? item_name : [item_name];
  const qtys  = Array.isArray(item_qty)  ? item_qty  : [item_qty];
  const prices = Array.isArray(item_price) ? item_price : [item_price];

  const validItems = names.map((n, i) => ({
    name: n?.trim(),
    qty: parseFloat(qtys[i]) || 0,
    price: parseFloat(String(prices[i]).replace(',', '.')) || 0
  })).filter(it => it.name && it.qty > 0 && it.price > 0);

  if (validItems.length === 0) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect('/rechnungen/neu');
  }

  const createInvoice = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO invoices (invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(+invoice_number, date, delivery_from || '', delivery_to || '', +customer_id, order_number || '', notes || '');

    const invoiceId = result.lastInsertRowid;
    const insertItem = db.prepare(`
      INSERT INTO invoice_items (invoice_id, article_name, quantity, unit_price, sort_order)
      VALUES (?, ?, ?, ?, ?)
    `);
    validItems.forEach((item, idx) => insertItem.run(invoiceId, item.name, item.qty, item.price, idx));
    return invoiceId;
  });

  const invoiceId = createInvoice();
  req.flash('success', `Rechnung Nr. ${invoice_number} wurde erstellt.`);
  res.redirect(`/rechnungen/${invoiceId}`);
});

router.get('/:id', (req, res) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_contact, c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
  const totalNetto = items.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const ust = totalNetto * 0.07;

  res.render('invoices/view', {
    title: `Rechnung Nr. ${invoice.invoice_number}`,
    invoice, items, totalNetto, ust, totalBrutto: totalNetto + ust
  });
});

router.get('/:id/pdf', (req, res) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_contact, c.delivery_street, c.delivery_zip, c.delivery_city, c.cost_center
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    WHERE i.id = ?
  `).get(req.params.id);

  if (!invoice) return res.status(404).send('Rechnung nicht gefunden');

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Rechnung-${invoice.invoice_number}.pdf`);
  generatePDF(invoice, items, res);
});

router.get('/:id/bearbeiten', (req, res) => {
  const invoice = db.prepare(`
    SELECT i.*, c.name as customer_name FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ?
  `).get(req.params.id);
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }

  const items = db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order').all(invoice.id);
  const customers = db.prepare('SELECT * FROM customers ORDER BY name').all();
  const articles = db.prepare('SELECT * FROM articles WHERE active = 1 ORDER BY name').all();

  res.render('invoices/new', { title: `Rechnung bearbeiten`, customers, articles, nextNumber: invoice.invoice_number, today: invoice.date, editInvoice: invoice, editItems: items });
});

router.post('/:id/bearbeiten', (req, res) => {
  const { invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes,
          item_name, item_qty, item_price } = req.body;

  const names  = Array.isArray(item_name)  ? item_name  : [item_name];
  const qtys   = Array.isArray(item_qty)   ? item_qty   : [item_qty];
  const prices = Array.isArray(item_price) ? item_price : [item_price];

  const validItems = names.map((n, i) => ({
    name: n?.trim(),
    qty: parseFloat(qtys[i]) || 0,
    price: parseFloat(String(prices[i]).replace(',', '.')) || 0
  })).filter(it => it.name && it.qty > 0 && it.price > 0);

  if (validItems.length === 0) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect(`/rechnungen/${req.params.id}/bearbeiten`);
  }

  const update = db.transaction(() => {
    db.prepare(`
      UPDATE invoices SET invoice_number=?, date=?, delivery_from=?, delivery_to=?,
        customer_id=?, order_number=?, notes=? WHERE id=?
    `).run(+invoice_number, date, delivery_from||'', delivery_to||'', +customer_id, order_number||'', notes||'', +req.params.id);

    db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(+req.params.id);
    const ins = db.prepare('INSERT INTO invoice_items (invoice_id, article_name, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)');
    validItems.forEach((it, idx) => ins.run(+req.params.id, it.name, it.qty, it.price, idx));
  });

  update();
  req.flash('success', `Rechnung Nr. ${invoice_number} aktualisiert.`);
  res.redirect(`/rechnungen/${req.params.id}`);
});

router.post('/:id/loeschen', (req, res) => {
  const invoice = db.prepare('SELECT invoice_number FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) { req.flash('error', 'Rechnung nicht gefunden.'); return res.redirect('/rechnungen'); }
  db.prepare('DELETE FROM invoices WHERE id = ?').run(+req.params.id);
  req.flash('success', `Rechnung Nr. ${invoice.invoice_number} gelöscht.`);
  res.redirect('/rechnungen');
});

module.exports = router;
