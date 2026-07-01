const express = require('express');
const router = express.Router();
const generateAngebotPDF = require('../services/pdf-angebot');

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

// ─── LISTE ────────────────────────────────────────────────────────────────────
router.get('/', w(async (req, res) => {
  const db = req.db;
  const { search, sort = 'desc', year = 'all', period = 'all' } = req.query;
  const [result, yearsRes] = await Promise.all([
    queryQuotes(db, { search, sort, year, period }),
    db.execute("SELECT DISTINCT strftime('%Y', date) as y FROM quotes ORDER BY y DESC")
  ]);
  const years = yearsRes.rows.map(r => r.y).filter(Boolean);
  res.render('angebote/index', {
    title: 'Angebote', quotes: result.rows,
    search: search || '', sort, year, period, years
  });
}));

// ─── NEUES ANGEBOT ────────────────────────────────────────────────────────────
router.get('/neu', w(async (req, res) => {
  const db = req.db;
  const [custRes, artRes, pricesRes] = await Promise.all([
    db.execute('SELECT * FROM customers ORDER BY name'),
    db.execute('SELECT * FROM articles WHERE active = 1 ORDER BY name'),
    db.execute('SELECT customer_id, article_id, unit_price FROM customer_prices')
  ]);
  const today = new Date().toISOString().split('T')[0];
  const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  res.render('angebote/new', {
    title: 'Neues Angebot', customers: custRes.rows, articles: artRes.rows,
    today, validUntil, editQuote: null, editItems: [],
    customerPricesMap: buildPricesMap(pricesRes.rows)
  });
}));

router.post('/neu', w(async (req, res) => {
  const db = req.db;
  const { date, valid_until, delivery_from, delivery_to, customer_id,
          order_number, notes, delivery_contact, cost_center, subject,
          item_name, item_qty, item_price } = req.body;

  if (!date || !customer_id) {
    req.flash('error', 'Bitte alle Pflichtfelder ausfüllen.');
    return res.redirect('/angebote/neu');
  }
  const validItems = parseItems(item_name, item_qty, item_price);
  if (!validItems.length) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect('/angebote/neu');
  }

  const lastRes = await db.execute('SELECT MAX(quote_number) as max FROM quotes');
  const nextNumber = (Number(lastRes.rows[0].max) || 0) + 1;

  const qRes = await db.execute(
    `INSERT INTO quotes (quote_number, date, valid_until, delivery_from, delivery_to, customer_id, order_number, notes, delivery_contact, cost_center, subject)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nextNumber, date, valid_until||'', delivery_from||'', delivery_to||'', +customer_id,
     order_number||'', notes||'', delivery_contact||'', cost_center||'', subject||'']
  );
  const quoteId = Number(qRes.lastInsertRowid);

  for (let i = 0; i < validItems.length; i++) {
    const it = validItems[i];
    await db.execute(
      'INSERT INTO quote_items (quote_id, article_name, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)',
      [quoteId, it.name, it.qty, it.price, i]
    );
  }
  req.flash('success', 'Angebot wurde erstellt.');
  res.redirect(`/angebote/${quoteId}`);
}));

// ─── EINZELNES ANGEBOT ────────────────────────────────────────────────────────
router.get('/:id', w(async (req, res) => {
  const db = req.db;
  const vatRate = req.session.user?.company?.vat_rate ?? 0.07;
  const qRes = await db.execute(`
    SELECT q.*, c.name as customer_name, c.billing_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_name, c.delivery_street, c.delivery_zip, c.delivery_city
    FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?
  `, [+req.params.id]);
  const quote = qRes.rows[0];
  if (!quote) { req.flash('error', 'Angebot nicht gefunden.'); return res.redirect('/angebote'); }

  const itemsRes = await db.execute('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order', [quote.id]);
  const items = itemsRes.rows;
  const totalNetto = items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
  const ust = totalNetto * vatRate;
  res.render('angebote/view', {
    title: `Angebot Nr. ${quote.quote_number}`, quote, items,
    totalNetto, ust, totalBrutto: totalNetto + ust, vatRate
  });
}));

router.get('/:id/pdf', w(async (req, res) => {
  const db = req.db;
  const qRes = await db.execute(`
    SELECT q.*, c.name as customer_name, c.billing_name, c.billing_street, c.billing_zip, c.billing_city,
      c.delivery_name, c.delivery_street, c.delivery_zip, c.delivery_city
    FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?
  `, [+req.params.id]);
  const quote = qRes.rows[0];
  if (!quote) return res.status(404).send('Angebot nicht gefunden');

  const itemsRes = await db.execute('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order', [quote.id]);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=Angebot-${quote.quote_number}.pdf`);
  generateAngebotPDF(quote, itemsRes.rows, res, req.session.user?.company);
}));

router.get('/:id/bearbeiten', w(async (req, res) => {
  const db = req.db;
  const qRes = await db.execute(`
    SELECT q.*, c.name as customer_name FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?
  `, [+req.params.id]);
  const quote = qRes.rows[0];
  if (!quote) { req.flash('error', 'Angebot nicht gefunden.'); return res.redirect('/angebote'); }

  const [custRes, artRes, itemsRes, pricesRes] = await Promise.all([
    db.execute('SELECT * FROM customers ORDER BY name'),
    db.execute('SELECT * FROM articles WHERE active = 1 ORDER BY name'),
    db.execute('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order', [quote.id]),
    db.execute('SELECT customer_id, article_id, unit_price FROM customer_prices')
  ]);
  res.render('angebote/new', {
    title: 'Angebot bearbeiten', customers: custRes.rows, articles: artRes.rows,
    today: quote.date, validUntil: quote.valid_until || '',
    editQuote: quote, editItems: itemsRes.rows,
    customerPricesMap: buildPricesMap(pricesRes.rows)
  });
}));

router.post('/:id/bearbeiten', w(async (req, res) => {
  const db = req.db;
  const { date, valid_until, delivery_from, delivery_to, customer_id,
          order_number, notes, delivery_contact, cost_center, subject,
          item_name, item_qty, item_price } = req.body;

  const validItems = parseItems(item_name, item_qty, item_price);
  if (!validItems.length) {
    req.flash('error', 'Mindestens ein Artikel mit Menge und Preis erforderlich.');
    return res.redirect(`/angebote/${req.params.id}/bearbeiten`);
  }
  await db.execute(
    `UPDATE quotes SET date=?, valid_until=?, delivery_from=?, delivery_to=?,
     customer_id=?, order_number=?, notes=?, delivery_contact=?, cost_center=?, subject=? WHERE id=?`,
    [date, valid_until||'', delivery_from||'', delivery_to||'', +customer_id,
     order_number||'', notes||'', delivery_contact||'', cost_center||'', subject||'', +req.params.id]
  );
  await db.execute('DELETE FROM quote_items WHERE quote_id = ?', [+req.params.id]);
  for (let i = 0; i < validItems.length; i++) {
    const it = validItems[i];
    await db.execute(
      'INSERT INTO quote_items (quote_id, article_name, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)',
      [+req.params.id, it.name, it.qty, it.price, i]
    );
  }
  req.flash('success', 'Angebot aktualisiert.');
  res.redirect(`/angebote/${req.params.id}`);
}));

// ─── ZU RECHNUNG KONVERTIEREN ─────────────────────────────────────────────────
router.post('/:id/zu-rechnung', w(async (req, res) => {
  const db = req.db;
  const qRes = await db.execute(`
    SELECT q.*, c.name as customer_name FROM quotes q
    LEFT JOIN customers c ON c.id = q.customer_id WHERE q.id = ?
  `, [+req.params.id]);
  const quote = qRes.rows[0];
  if (!quote) { req.flash('error', 'Angebot nicht gefunden.'); return res.redirect('/angebote'); }

  const itemsRes = await db.execute('SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order', [quote.id]);
  const lastInvRes = await db.execute('SELECT MAX(invoice_number) as max FROM invoices');
  const nextInvNumber = (Number(lastInvRes.rows[0].max) || 0) + 1;

  const invRes = await db.execute(
    `INSERT INTO invoices (invoice_number, date, delivery_from, delivery_to, customer_id, order_number, notes, delivery_contact, cost_center, payment_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nextInvNumber, quote.date, quote.delivery_from||'', quote.delivery_to||'', quote.customer_id,
     quote.order_number||'', quote.notes||'', quote.delivery_contact||'', quote.cost_center||'', 'transfer']
  );
  const invoiceId = Number(invRes.lastInsertRowid);

  for (let i = 0; i < itemsRes.rows.length; i++) {
    const it = itemsRes.rows[i];
    await db.execute(
      'INSERT INTO invoice_items (invoice_id, article_name, quantity, unit_price, sort_order) VALUES (?, ?, ?, ?, ?)',
      [invoiceId, it.article_name, it.quantity, it.unit_price, i]
    );
  }
  req.flash('success', `Rechnung Nr. ${nextInvNumber} wurde aus Angebot Nr. ${quote.quote_number} erstellt.`);
  res.redirect(`/rechnungen/${invoiceId}`);
}));

router.post('/:id/loeschen', w(async (req, res) => {
  const db = req.db;
  const qRes = await db.execute('SELECT quote_number FROM quotes WHERE id = ?', [+req.params.id]);
  const quote = qRes.rows[0];
  if (!quote) { req.flash('error', 'Angebot nicht gefunden.'); return res.redirect('/angebote'); }
  await db.execute('DELETE FROM quotes WHERE id = ?', [+req.params.id]);
  req.flash('success', `Angebot Nr. ${quote.quote_number} gelöscht.`);
  res.redirect('/angebote');
}));

// ─── HILFSFUNKTIONEN ──────────────────────────────────────────────────────────
function queryQuotes(db, { search, sort = 'desc', year = 'all', period = 'all' }) {
  const order = sort === 'asc' ? 'ASC' : 'DESC';
  let sql = `
    SELECT q.id, q.quote_number, q.date, q.valid_until, q.delivery_from, q.delivery_to, q.order_number,
      c.name as customer_name,
      (SELECT SUM(qi.quantity * qi.unit_price) FROM quote_items qi WHERE qi.quote_id = q.id) as total_netto
    FROM quotes q LEFT JOIN customers c ON c.id = q.customer_id
  `;
  const args = [];
  const where = [];

  if (search) {
    where.push('(CAST(q.quote_number AS TEXT) LIKE ? OR c.name LIKE ? OR q.order_number LIKE ?)');
    args.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (year !== 'all')   { where.push("strftime('%Y', q.date) = ?"); args.push(year); }
  if (period !== 'all') {
    const qMap = { Q1:['01','02','03'], Q2:['04','05','06'], Q3:['07','08','09'], Q4:['10','11','12'] };
    if (qMap[period]) {
      where.push(`strftime('%m', q.date) IN (${qMap[period].map(()=>'?').join(',')})`);
      args.push(...qMap[period]);
    } else {
      where.push("strftime('%m', q.date) = ?");
      args.push(period.padStart(2, '0'));
    }
  }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ` ORDER BY q.quote_number ${order}`;
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
