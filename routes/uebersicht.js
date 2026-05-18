const express = require('express');
const router = express.Router();
const { db } = require('../db');

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

router.get('/', w(async (req, res) => {
  const { year = 'all', period = 'all' } = req.query;

  // Build date filters
  const invWhere  = [];
  const cashWhere = [];
  const invArgs   = [];
  const cashArgs  = [];

  if (year !== 'all') {
    invWhere.push("strftime('%Y', i.date) = ?");   invArgs.push(year);
    cashWhere.push("strftime('%Y', date) = ?");     cashArgs.push(year);
  }
  if (period !== 'all') {
    const qMap = { Q1:['01','02','03'], Q2:['04','05','06'], Q3:['07','08','09'], Q4:['10','11','12'] };
    if (qMap[period]) {
      const ph = qMap[period].map(() => '?').join(',');
      invWhere.push(`strftime('%m', i.date) IN (${ph})`);   invArgs.push(...qMap[period]);
      cashWhere.push(`strftime('%m', date) IN (${ph})`);    cashArgs.push(...qMap[period]);
    } else {
      const m = String(period).padStart(2, '0');
      invWhere.push("strftime('%m', i.date) = ?");   invArgs.push(m);
      cashWhere.push("strftime('%m', date) = ?");    cashArgs.push(m);
    }
  }

  const invFilter  = invWhere.length  ? 'WHERE ' + invWhere.join(' AND ')  : '';
  const cashFilter = cashWhere.length ? 'WHERE ' + cashWhere.join(' AND ') : '';

  const [invRes, cashRes, yearsInvRes, yearsCashRes] = await Promise.all([
    db.execute(`
      SELECT SUM(ii.quantity * ii.unit_price) as netto
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      ${invFilter}
    `, invArgs),
    db.execute(`
      SELECT SUM(total_cash) as sum_cash, SUM(lotto_revenue) as sum_lotto
      FROM daily_cash
      ${cashFilter}
    `, cashArgs),
    db.execute("SELECT DISTINCT strftime('%Y', date) as y FROM invoices ORDER BY y DESC"),
    db.execute("SELECT DISTINCT strftime('%Y', date) as y FROM daily_cash ORDER BY y DESC"),
  ]);

  // Merge year lists
  const yearSet = new Set([
    ...yearsInvRes.rows.map(r => r.y),
    ...yearsCashRes.rows.map(r => r.y)
  ].filter(Boolean));
  const years = [...yearSet].sort((a, b) => b - a);

  // Lieferungen (outgoing invoices)
  const liefNetto  = Number(invRes.rows[0]?.netto)     || 0;
  const liefBrutto = liefNetto * 1.07;

  // Tageskasse
  const sumCash     = Number(cashRes.rows[0]?.sum_cash)   || 0;
  const sumLotto    = Number(cashRes.rows[0]?.sum_lotto)  || 0;
  const ladenBrutto = sumCash - sumLotto;
  const ladenNetto  = ladenBrutto / 1.07;

  // Gesamt (Lotto already excluded from Laden figures)
  const gesamtBrutto = liefBrutto + ladenBrutto;
  const gesamtNetto  = liefNetto  + ladenNetto;

  res.render('uebersicht/index', {
    title: 'Gesamtüberblick',
    year, period, years,
    liefNetto, liefBrutto,
    ladenBrutto, ladenNetto, sumLotto,
    gesamtBrutto, gesamtNetto
  });
}));

module.exports = router;
