const express = require('express');
const router = express.Router();
const { db } = require('../db');

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

function parseDE(val) {
  return parseFloat(String(val || '0').replace(',', '.')) || 0;
}

function buildQuery({ year, month }) {
  let sql = 'SELECT * FROM daily_cash';
  const args = [];
  const where = [];
  if (year  !== 'all') { where.push("strftime('%Y', date) = ?"); args.push(year); }
  if (month !== 'all') { where.push("strftime('%m', date) = ?"); args.push(String(month).padStart(2, '0')); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY date DESC';
  return db.execute(sql, args);
}

// ─── LISTE ───────────────────────────────────────────────────────────────────
router.get('/', w(async (req, res) => {
  const { year = 'all', month = 'all' } = req.query;

  const [rows, yearsRes] = await Promise.all([
    buildQuery({ year, month }),
    db.execute("SELECT DISTINCT strftime('%Y', date) as y FROM daily_cash ORDER BY y DESC")
  ]);

  const entries  = rows.rows;
  const years    = yearsRes.rows.map(r => r.y).filter(Boolean);

  const sumR7    = entries.reduce((s, e) => s + Number(e.revenue_7),    0);
  const sumR19   = entries.reduce((s, e) => s + Number(e.revenue_19),   0);
  const sumLotto = entries.reduce((s, e) => s + Number(e.lotto_revenue), 0);
  const sumBrutto = sumR7 + sumR19;
  const sumNetto  = sumR7 / 1.07 + sumR19 / 1.19;

  res.render('tageskasse/index', {
    title: 'Tageskasse', entries, years, year, month, MONTHS,
    sumR7, sumR19, sumLotto, sumBrutto, sumNetto
  });
}));

// ─── NEUER EINTRAG ───────────────────────────────────────────────────────────
router.get('/neu', w(async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.render('tageskasse/form', { title: 'Tageskasse – Neuer Eintrag', entry: null, today });
}));

router.post('/neu', w(async (req, res) => {
  const { date, revenue_7, revenue_19, lotto_revenue, notes } = req.body;
  if (!date) {
    req.flash('error', 'Datum ist ein Pflichtfeld.');
    return res.redirect('/tageskasse/neu');
  }
  const existing = await db.execute('SELECT id FROM daily_cash WHERE date = ?', [date]);
  if (existing.rows[0]) {
    req.flash('error', `Für den ${new Date(date + 'T12:00:00').toLocaleDateString('de-DE')} existiert bereits ein Eintrag.`);
    return res.redirect('/tageskasse/neu');
  }
  const r7    = parseDE(revenue_7);
  const r19   = parseDE(revenue_19);
  const lotto = parseDE(lotto_revenue);
  const total = r7 + r19 + lotto;
  await db.execute(
    'INSERT INTO daily_cash (date, revenue_7, revenue_19, lotto_revenue, total_cash, notes) VALUES (?, ?, ?, ?, ?, ?)',
    [date, r7, r19, lotto, total, notes?.trim() || '']
  );
  req.flash('success', `Tageskasse für den ${new Date(date + 'T12:00:00').toLocaleDateString('de-DE')} gespeichert.`);
  res.redirect('/tageskasse');
}));

// ─── BEARBEITEN ───────────────────────────────────────────────────────────────
router.get('/:id/bearbeiten', w(async (req, res) => {
  const r = await db.execute('SELECT * FROM daily_cash WHERE id = ?', [+req.params.id]);
  const entry = r.rows[0];
  if (!entry) { req.flash('error', 'Eintrag nicht gefunden.'); return res.redirect('/tageskasse'); }
  res.render('tageskasse/form', { title: 'Tageskasse – Bearbeiten', entry, today: entry.date });
}));

router.post('/:id/bearbeiten', w(async (req, res) => {
  const { date, revenue_7, revenue_19, lotto_revenue, notes } = req.body;
  const r7    = parseDE(revenue_7);
  const r19   = parseDE(revenue_19);
  const lotto = parseDE(lotto_revenue);
  const total = r7 + r19 + lotto;
  await db.execute(
    'UPDATE daily_cash SET date=?, revenue_7=?, revenue_19=?, lotto_revenue=?, total_cash=?, notes=? WHERE id=?',
    [date, r7, r19, lotto, total, notes?.trim() || '', +req.params.id]
  );
  req.flash('success', 'Eintrag aktualisiert.');
  res.redirect('/tageskasse');
}));

// ─── LÖSCHEN ─────────────────────────────────────────────────────────────────
router.post('/:id/loeschen', w(async (req, res) => {
  await db.execute('DELETE FROM daily_cash WHERE id = ?', [+req.params.id]);
  req.flash('success', 'Eintrag gelöscht.');
  res.redirect('/tageskasse');
}));

module.exports = router;
