const express = require('express');
const router = express.Router();
const { db } = require('../db');

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

const MONTHS = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];

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

  const entries   = rows.rows;
  const years     = yearsRes.rows.map(r => r.y).filter(Boolean);
  const sumCash   = entries.reduce((s, e) => s + Number(e.total_cash),    0);
  const sumLotto  = entries.reduce((s, e) => s + Number(e.lotto_revenue), 0);
  const ladenBrutto = sumCash - sumLotto;
  const ladenNetto  = ladenBrutto / 1.07;

  res.render('tageskasse/index', {
    title: 'Tageskasse', entries, years, year, month, MONTHS,
    sumCash, sumLotto, ladenBrutto, ladenNetto
  });
}));

// ─── NEUER EINTRAG ───────────────────────────────────────────────────────────
router.get('/neu', w(async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.render('tageskasse/form', { title: 'Tageskasse – Neuer Eintrag', entry: null, today });
}));

router.post('/neu', w(async (req, res) => {
  const { date, total_cash, lotto_revenue, notes } = req.body;
  if (!date || total_cash === undefined || total_cash === '') {
    req.flash('error', 'Datum und Kasseneinnahmen sind Pflichtfelder.');
    return res.redirect('/tageskasse/neu');
  }
  const existing = await db.execute('SELECT id FROM daily_cash WHERE date = ?', [date]);
  if (existing.rows[0]) {
    req.flash('error', `Für den ${new Date(date + 'T12:00:00').toLocaleDateString('de-DE')} existiert bereits ein Eintrag.`);
    return res.redirect('/tageskasse/neu');
  }
  const cash  = parseFloat(String(total_cash).replace(',', '.'))   || 0;
  const lotto = parseFloat(String(lotto_revenue).replace(',', '.')) || 0;
  await db.execute(
    'INSERT INTO daily_cash (date, total_cash, lotto_revenue, notes) VALUES (?, ?, ?, ?)',
    [date, cash, lotto, notes?.trim() || '']
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
  const { date, total_cash, lotto_revenue, notes } = req.body;
  const cash  = parseFloat(String(total_cash).replace(',', '.'))   || 0;
  const lotto = parseFloat(String(lotto_revenue).replace(',', '.')) || 0;
  await db.execute(
    'UPDATE daily_cash SET date=?, total_cash=?, lotto_revenue=?, notes=? WHERE id=?',
    [date, cash, lotto, notes?.trim() || '', +req.params.id]
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
