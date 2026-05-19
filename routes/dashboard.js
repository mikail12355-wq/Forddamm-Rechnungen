const express = require('express');
const router = express.Router();
const { db } = require('../db');

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const QUARTER_MONTHS = { 1: ['01','02','03'], 2: ['04','05','06'], 3: ['07','08','09'], 4: ['10','11','12'] };

router.get('/', async (req, res) => {
  const { year, month, quarter } = req.query;

  // WHERE clause for invoices/tageskasse (date column)
  let whereParts = [];
  let args = [];

  if (year && year !== 'all') {
    whereParts.push("strftime('%Y', i.date) = ?");
    args.push(String(year));

    if (month) {
      whereParts.push("strftime('%m', i.date) = ?");
      args.push(String(month).padStart(2, '0'));
    } else if (quarter) {
      const qm = QUARTER_MONTHS[Number(quarter)] || [];
      whereParts.push(`strftime('%m', i.date) IN (${qm.map(() => '?').join(',')})`);
      args.push(...qm);
    }
  }

  const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  // Cash WHERE (no alias)
  const cashWhere = where.replace(/i\.date/g, 'date');

  // Build monat list for mitarbeiter_kosten (YYYY-MM format)
  let maKostenFilter = '';
  let maKostenArgs = [];
  if (year && year !== 'all') {
    if (month) {
      maKostenFilter = 'WHERE monat = ?';
      maKostenArgs   = [`${year}-${String(month).padStart(2, '0')}`];
    } else if (quarter) {
      const qm = QUARTER_MONTHS[Number(quarter)] || [];
      const monats = qm.map(m => `${year}-${m}`);
      maKostenFilter = `WHERE monat IN (${monats.map(() => '?').join(',')})`;
      maKostenArgs   = monats;
    } else {
      maKostenFilter = "WHERE monat LIKE ?";
      maKostenArgs   = [`${year}-%`];
    }
  }

  const [inv, cust, art, rev, latest, yearsRes, cashRes, maKostenRes] = await Promise.all([
    db.execute(`SELECT COUNT(*) as count FROM invoices i ${where}`, args),
    db.execute('SELECT COUNT(*) as count FROM customers'),
    db.execute('SELECT COUNT(*) as count FROM articles WHERE active = 1'),
    db.execute(`SELECT COALESCE(SUM(ii.quantity * ii.unit_price), 0) as netto
                FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id ${where}`, args),
    db.execute(`
      SELECT i.id, i.invoice_number, i.date, c.name as customer_name,
        (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
      FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      ${where}
      ORDER BY i.invoice_number DESC LIMIT 20
    `, args),
    db.execute("SELECT DISTINCT strftime('%Y', date) as year FROM invoices WHERE date != '' ORDER BY year DESC"),
    db.execute(`SELECT COALESCE(SUM(revenue_7 + revenue_19), 0) as brutto FROM daily_cash ${cashWhere}`, args),
    db.execute(`SELECT COALESCE(SUM(betrag), 0) as total FROM mitarbeiter_kosten ${maKostenFilter}`, maKostenArgs),
  ]);

  const activeYear    = year || 'all';
  const activeMonth   = month   ? Number(month)   : null;
  const activeQuarter = quarter ? Number(quarter) : null;

  let periodLabel = 'Gesamt';
  if (activeYear !== 'all') {
    if (activeMonth)    periodLabel = `${MONTH_NAMES[activeMonth - 1]} ${activeYear}`;
    else if (activeQuarter) periodLabel = `Q${activeQuarter} ${activeYear}`;
    else periodLabel = String(activeYear);
  }

  const liefNetto    = Number(rev.rows[0].netto)       || 0;
  const liefBrutto   = liefNetto * 1.07;
  const ladenBrutto  = Number(cashRes.rows[0].brutto)  || 0;
  const gesamtEin    = liefBrutto + ladenBrutto;
  const maKosten     = Number(maKostenRes.rows[0].total) || 0;
  const gewinn       = gesamtEin - maKosten;

  res.render('dashboard', {
    title: 'Dashboard',
    stats: {
      invoices:  Number(inv.rows[0].count),
      customers: Number(cust.rows[0].count),
      articles:  Number(art.rows[0].count),
      revenue:   liefNetto,
    },
    latestInvoices: latest.rows,
    availableYears: yearsRes.rows.map(r => r.year).filter(Boolean),
    filter: { year: activeYear, month: activeMonth, quarter: activeQuarter },
    periodLabel,
    monthNames: ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],
    uebersicht: { liefBrutto, ladenBrutto, gesamtEin, maKosten, gewinn },
  });
});

module.exports = router;
