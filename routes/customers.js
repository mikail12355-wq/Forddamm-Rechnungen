const express = require('express');
const router = express.Router();
const { db } = require('../db');

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

router.get('/', w(async (req, res) => {
  const result = await db.execute('SELECT * FROM customers ORDER BY name');
  res.render('customers/index', { title: 'Kunden', customers: result.rows });
}));

router.get('/neu', (req, res) => {
  res.render('customers/form', { title: 'Neuer Kunde', customer: null, articles: [], customerPrices: [] });
});

router.post('/neu', w(async (req, res) => {
  const { name, billing_street, billing_zip, billing_city, delivery_street, delivery_zip, delivery_city, cost_center } = req.body;
  if (!name?.trim()) { req.flash('error', 'Name ist erforderlich.'); return res.redirect('/kunden/neu'); }

  const custRes = await db.execute(
    `INSERT INTO customers (name, billing_street, billing_zip, billing_city, delivery_street, delivery_zip, delivery_city, cost_center)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [name.trim(), billing_street||'', billing_zip||'', billing_city||'', delivery_street||'', delivery_zip||'', delivery_city||'', cost_center||'']
  );
  await saveCustomerPrices(Number(custRes.lastInsertRowid), req.body);
  req.flash('success', `Kunde "${name}" wurde angelegt.`);
  res.redirect('/kunden');
}));

router.get('/:id/bearbeiten', w(async (req, res) => {
  const [custRes, artRes, pricesRes] = await Promise.all([
    db.execute('SELECT * FROM customers WHERE id = ?', [+req.params.id]),
    db.execute('SELECT * FROM articles ORDER BY name'),
    db.execute('SELECT * FROM customer_prices WHERE customer_id = ?', [+req.params.id])
  ]);
  const customer = custRes.rows[0];
  if (!customer) { req.flash('error', 'Kunde nicht gefunden.'); return res.redirect('/kunden'); }
  res.render('customers/form', { title: 'Kunde bearbeiten', customer, articles: artRes.rows, customerPrices: pricesRes.rows });
}));

router.post('/:id/bearbeiten', w(async (req, res) => {
  const { name, billing_street, billing_zip, billing_city, delivery_street, delivery_zip, delivery_city, cost_center } = req.body;
  if (!name?.trim()) { req.flash('error', 'Name ist erforderlich.'); return res.redirect(`/kunden/${req.params.id}/bearbeiten`); }

  await db.execute(
    `UPDATE customers SET name=?, billing_street=?, billing_zip=?, billing_city=?, delivery_street=?, delivery_zip=?, delivery_city=?, cost_center=? WHERE id=?`,
    [name.trim(), billing_street||'', billing_zip||'', billing_city||'', delivery_street||'', delivery_zip||'', delivery_city||'', cost_center||'', +req.params.id]
  );
  await saveCustomerPrices(+req.params.id, req.body);
  req.flash('success', `Kunde "${name}" aktualisiert.`);
  res.redirect('/kunden');
}));

router.post('/:id/loeschen', w(async (req, res) => {
  const custRes = await db.execute('SELECT name FROM customers WHERE id = ?', [+req.params.id]);
  const customer = custRes.rows[0];
  if (!customer) { req.flash('error', 'Kunde nicht gefunden.'); return res.redirect('/kunden'); }

  const invCount = await db.execute('SELECT COUNT(*) as count FROM invoices WHERE customer_id = ?', [+req.params.id]);
  if (Number(invCount.rows[0].count) > 0) {
    req.flash('error', `Kunde kann nicht gelöscht werden – ${invCount.rows[0].count} Rechnung(en) zugeordnet.`);
    return res.redirect('/kunden');
  }
  await db.execute('DELETE FROM customers WHERE id = ?', [+req.params.id]);
  req.flash('success', `Kunde "${customer.name}" gelöscht.`);
  res.redirect('/kunden');
}));

router.get('/api/:id', w(async (req, res) => {
  const result = await db.execute('SELECT * FROM customers WHERE id = ?', [+req.params.id]);
  res.json(result.rows[0] || null);
}));

async function saveCustomerPrices(customerId, body) {
  const artRes = await db.execute('SELECT id FROM articles');
  const stmts = [{ sql: 'DELETE FROM customer_prices WHERE customer_id = ?', args: [customerId] }];
  for (const article of artRes.rows) {
    const raw = body[`price_article_${article.id}`];
    if (!raw || !String(raw).trim()) continue;
    const price = parseFloat(String(raw).replace(',', '.'));
    if (!isNaN(price) && price > 0) {
      stmts.push({
        sql: 'INSERT OR REPLACE INTO customer_prices (customer_id, article_id, unit_price) VALUES (?, ?, ?)',
        args: [customerId, article.id, price]
      });
    }
  }
  await db.batch(stmts, 'write');
}

module.exports = router;
