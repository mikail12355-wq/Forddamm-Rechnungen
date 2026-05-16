const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const customers = db.prepare('SELECT * FROM customers ORDER BY name').all();
  res.render('customers/index', { title: 'Kunden', customers });
});

router.get('/neu', (req, res) => {
  res.render('customers/form', { title: 'Neuer Kunde', customer: null });
});

router.post('/neu', (req, res) => {
  const { name, billing_street, billing_zip, billing_city,
          delivery_contact, delivery_street, delivery_zip, delivery_city, cost_center } = req.body;

  if (!name?.trim()) {
    req.flash('error', 'Name ist erforderlich.');
    return res.redirect('/kunden/neu');
  }

  db.prepare(`INSERT INTO customers
    (name, billing_street, billing_zip, billing_city, delivery_contact, delivery_street, delivery_zip, delivery_city, cost_center)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    name.trim(), billing_street||'', billing_zip||'', billing_city||'',
    delivery_contact||'', delivery_street||'', delivery_zip||'', delivery_city||'', cost_center||''
  );

  req.flash('success', `Kunde "${name}" wurde angelegt.`);
  res.redirect('/kunden');
});

router.get('/:id/bearbeiten', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) { req.flash('error', 'Kunde nicht gefunden.'); return res.redirect('/kunden'); }
  res.render('customers/form', { title: 'Kunde bearbeiten', customer });
});

router.post('/:id/bearbeiten', (req, res) => {
  const { name, billing_street, billing_zip, billing_city,
          delivery_contact, delivery_street, delivery_zip, delivery_city, cost_center } = req.body;

  if (!name?.trim()) {
    req.flash('error', 'Name ist erforderlich.');
    return res.redirect(`/kunden/${req.params.id}/bearbeiten`);
  }

  db.prepare(`UPDATE customers SET name=?, billing_street=?, billing_zip=?, billing_city=?,
    delivery_contact=?, delivery_street=?, delivery_zip=?, delivery_city=?, cost_center=?
    WHERE id=?`).run(
    name.trim(), billing_street||'', billing_zip||'', billing_city||'',
    delivery_contact||'', delivery_street||'', delivery_zip||'', delivery_city||'', cost_center||'',
    +req.params.id
  );

  req.flash('success', `Kunde "${name}" aktualisiert.`);
  res.redirect('/kunden');
});

router.post('/:id/loeschen', (req, res) => {
  const customer = db.prepare('SELECT name FROM customers WHERE id = ?').get(req.params.id);
  if (!customer) { req.flash('error', 'Kunde nicht gefunden.'); return res.redirect('/kunden'); }
  const invoiceCount = db.prepare('SELECT COUNT(*) as count FROM invoices WHERE customer_id = ?').get(+req.params.id);
  if (invoiceCount.count > 0) {
    req.flash('error', `Kunde kann nicht gelöscht werden, da ${invoiceCount.count} Rechnung(en) zugeordnet sind.`);
    return res.redirect('/kunden');
  }
  db.prepare('DELETE FROM customers WHERE id = ?').run(+req.params.id);
  req.flash('success', `Kunde "${customer.name}" gelöscht.`);
  res.redirect('/kunden');
});

// API endpoint for invoice form
router.get('/api/:id', (req, res) => {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
  res.json(customer || null);
});

module.exports = router;
