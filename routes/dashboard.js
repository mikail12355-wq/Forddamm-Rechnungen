const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.get('/', async (req, res) => {
  const [inv, cust, art, rev, latest] = await Promise.all([
    db.execute('SELECT COUNT(*) as count FROM invoices'),
    db.execute('SELECT COUNT(*) as count FROM customers'),
    db.execute('SELECT COUNT(*) as count FROM articles WHERE active = 1'),
    db.execute('SELECT SUM(ii.quantity * ii.unit_price) as netto FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id'),
    db.execute(`
      SELECT i.id, i.invoice_number, i.date, c.name as customer_name,
        (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
      FROM invoices i
      LEFT JOIN customers c ON c.id = i.customer_id
      ORDER BY i.invoice_number DESC LIMIT 5
    `)
  ]);

  res.render('dashboard', {
    title: 'Dashboard',
    stats: {
      invoices:  Number(inv.rows[0].count),
      customers: Number(cust.rows[0].count),
      articles:  Number(art.rows[0].count),
      revenue:   Number(rev.rows[0].netto) || 0
    },
    latestInvoices: latest.rows
  });
});

module.exports = router;
