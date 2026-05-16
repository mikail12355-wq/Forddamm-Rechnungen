const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const totalInvoices = db.prepare('SELECT COUNT(*) as count FROM invoices').get();
  const totalCustomers = db.prepare('SELECT COUNT(*) as count FROM customers').get();
  const totalArticles = db.prepare('SELECT COUNT(*) as count FROM articles WHERE active = 1').get();

  const revenueData = db.prepare(`
    SELECT SUM(ii.quantity * ii.unit_price) as netto
    FROM invoices i
    JOIN invoice_items ii ON ii.invoice_id = i.id
  `).get();

  const latestInvoices = db.prepare(`
    SELECT i.*, c.name as customer_name,
      (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ORDER BY i.invoice_number DESC
    LIMIT 5
  `).all();

  res.render('dashboard', {
    title: 'Dashboard',
    stats: {
      invoices: totalInvoices.count,
      customers: totalCustomers.count,
      articles: totalArticles.count,
      revenue: revenueData.netto || 0
    },
    latestInvoices
  });
});

module.exports = router;
