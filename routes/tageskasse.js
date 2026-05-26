const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
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

// ─── KASSENBERICHT LOTTO (PDF) ───────────────────────────────────────────────
router.get('/kassenbericht-lotto', w(async (req, res) => {
  const { year, month } = req.query;
  if (!year || year === 'all' || !month || month === 'all') {
    req.flash('error', 'Bitte wählen Sie ein konkretes Jahr und einen Monat aus.');
    return res.redirect('/tageskasse');
  }

  const monthNum    = parseInt(month);
  const yearNum     = parseInt(year);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthName   = MONTHS[monthNum - 1];

  const rows = await db.execute(
    "SELECT * FROM daily_cash WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? ORDER BY date ASC",
    [String(yearNum), String(monthNum).padStart(2, '0')]
  );
  const entries = rows.rows;
  const dayMap  = {};
  entries.forEach(e => { dayMap[parseInt(e.date.split('-')[2])] = e; });
  const totalLotto = entries.reduce((s, e) => s + Number(e.lotto_revenue), 0);

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Kassenbericht ${monthName} ${yearNum} Lotto` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Kassenbericht_${monthName}_${yearNum}_Lotto.pdf"`);
  doc.pipe(res);

  const W = 595.28, H = 841.89;
  const mL = 60, mR = 60;
  const cW = W - mL - mR;

  const colTag = mL;
  const colBem = mL + 55;

  let y = 50;

  // Header
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(20)
     .text(`Kassenbericht Monat:  ${monthName} ${yearNum}  Lotto`, mL, y);
  y += 40;

  // Tabellenkopf
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Tag',       colTag, y, { lineBreak: false });
  doc.text('Bemerkung', colBem, y, { lineBreak: false });
  doc.text('Umsatz',    mL, y, { width: cW, align: 'right', lineBreak: false });
  y += 6;
  doc.rect(mL, y, cW, 0.8).fill('#000');
  y += 10;

  // Tageszeilen
  doc.font('Helvetica').fontSize(10);
  const ROW_H = 17;
  for (let day = 1; day <= daysInMonth; day++) {
    const e     = dayMap[day];
    const lotto = e ? Number(e.lotto_revenue) : 0;
    const notes = e ? (e.notes || '') : '';

    doc.fillColor('#000');
    doc.text(String(day), colTag, y, { lineBreak: false });
    if (notes) doc.text(notes, colBem, y, { width: W - mR - colBem - 80, lineBreak: false });
    if (lotto > 0) {
      doc.text(lotto.toFixed(2).replace('.', ',') + ' €', mL, y, { width: cW, align: 'right', lineBreak: false });
    }
    y += ROW_H;
  }

  // Summe
  y += 6;
  doc.rect(mL, y, cW, 0.8).fill('#000');
  y += 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Summe:', colBem, y, { lineBreak: false });
  doc.text(totalLotto.toFixed(2).replace('.', ',') + ' €', mL, y, { width: cW, align: 'right', lineBreak: false });

  // Fußzeile
  doc.font('Helvetica').fontSize(8).fillColor('#666')
     .text('Seite 1', mL, H - 30, { width: cW, align: 'center', lineBreak: false });

  doc.end();
}));

// ─── KASSENBERICHT LADEN ohne Lotto (PDF) ────────────────────────────────────
router.get('/kassenbericht-laden', w(async (req, res) => {
  const { year, month } = req.query;
  if (!year || year === 'all' || !month || month === 'all') {
    req.flash('error', 'Bitte wählen Sie ein konkretes Jahr und einen Monat aus.');
    return res.redirect('/tageskasse');
  }

  const monthNum    = parseInt(month);
  const yearNum     = parseInt(year);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthName   = MONTHS[monthNum - 1];

  const rows = await db.execute(
    "SELECT * FROM daily_cash WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? ORDER BY date ASC",
    [String(yearNum), String(monthNum).padStart(2, '0')]
  );
  const entries = rows.rows;
  const dayMap  = {};
  entries.forEach(e => { dayMap[parseInt(e.date.split('-')[2])] = e; });

  const sumR7  = entries.reduce((s, e) => s + Number(e.revenue_7),  0);
  const sumR19 = entries.reduce((s, e) => s + Number(e.revenue_19), 0);

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Kassenbericht ${monthName} ${yearNum} Laden` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Kassenbericht_${monthName}_${yearNum}_Laden.pdf"`);
  doc.pipe(res);

  const W = 595.28, H = 841.89;
  const mL = 50, mR = 50;
  const cW = W - mL - mR;

  // Spalten: Tag | Bemerkung | 7% brutto | 19% brutto | Gesamt
  const colTag  = mL;
  const colBem  = mL + 45;
  const colR7   = mL + 245;
  const colR19  = mL + 345;
  const colGes  = mL + 445;
  const ROW_H   = 17;

  let y = 50;

  // Header
  doc.fillColor('#000').font('Helvetica-Bold').fontSize(20)
     .text(`Kassenbericht Monat:  ${monthName} ${yearNum}  Laden`, mL, y);
  y += 10;
  doc.font('Helvetica').fontSize(9).fillColor('#444')
     .text('(ohne Lotto-Umsatz)', mL, y);
  y += 30;

  // Tabellenkopf
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');
  doc.text('Tag',        colTag, y, { lineBreak: false });
  doc.text('Bemerkung',  colBem, y, { lineBreak: false, width: colR7 - colBem - 5 });
  doc.text('7% brutto',  colR7,  y, { width: colR19 - colR7, align: 'right', lineBreak: false });
  doc.text('19% brutto', colR19, y, { width: colGes - colR19, align: 'right', lineBreak: false });
  doc.text('Gesamt',     colGes, y, { width: W - mR - colGes, align: 'right', lineBreak: false });
  y += 6;
  doc.rect(mL, y, cW, 0.8).fill('#000');
  y += 10;

  // Tageszeilen
  doc.font('Helvetica').fontSize(9).fillColor('#000');
  for (let day = 1; day <= daysInMonth; day++) {
    const e    = dayMap[day];
    const r7   = e ? Number(e.revenue_7)  : 0;
    const r19  = e ? Number(e.revenue_19) : 0;
    const ges  = r7 + r19;
    const notes = e ? (e.notes || '') : '';

    doc.text(String(day), colTag, y, { lineBreak: false });
    if (notes) doc.text(notes, colBem, y, { width: colR7 - colBem - 5, lineBreak: false });
    if (r7  > 0) doc.text(r7.toFixed(2).replace('.', ',')  + ' €', colR7,  y, { width: colR19 - colR7,        align: 'right', lineBreak: false });
    if (r19 > 0) doc.text(r19.toFixed(2).replace('.', ',') + ' €', colR19, y, { width: colGes - colR19,       align: 'right', lineBreak: false });
    if (ges > 0) doc.font('Helvetica-Bold').text(ges.toFixed(2).replace('.', ',') + ' €', colGes, y, { width: W - mR - colGes, align: 'right', lineBreak: false });
    doc.font('Helvetica');
    y += ROW_H;
  }

  // Trennlinie
  y += 6;
  doc.rect(mL, y, cW, 0.8).fill('#000');
  y += 12;

  // Summen-Block
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#000');

  // 7%-Block
  doc.text('7% Umsatz (brutto):',  colR7 - 100, y, { lineBreak: false });
  doc.text(sumR7.toFixed(2).replace('.', ',') + ' €', colR7, y, { width: colR19 - colR7, align: 'right', lineBreak: false });
  y += 14;
  doc.font('Helvetica').fillColor('#555');
  doc.text('davon Netto (÷ 1,07):', colR7 - 100, y, { lineBreak: false });
  doc.text((sumR7 / 1.07).toFixed(2).replace('.', ',') + ' €', colR7, y, { width: colR19 - colR7, align: 'right', lineBreak: false });
  doc.text('MwSt 7%:', colR19 - 100, y, { lineBreak: false });
  doc.text((sumR7 - sumR7 / 1.07).toFixed(2).replace('.', ',') + ' €', colR19, y, { width: colGes - colR19, align: 'right', lineBreak: false });
  y += 20;

  // 19%-Block
  doc.font('Helvetica-Bold').fillColor('#000');
  doc.text('19% Umsatz (brutto):', colR7 - 100, y, { lineBreak: false });
  doc.text(sumR19.toFixed(2).replace('.', ',') + ' €', colR7, y, { width: colR19 - colR7, align: 'right', lineBreak: false });
  y += 14;
  doc.font('Helvetica').fillColor('#555');
  doc.text('davon Netto (÷ 1,19):', colR7 - 100, y, { lineBreak: false });
  doc.text((sumR19 / 1.19).toFixed(2).replace('.', ',') + ' €', colR7, y, { width: colR19 - colR7, align: 'right', lineBreak: false });
  doc.text('MwSt 19%:', colR19 - 100, y, { lineBreak: false });
  doc.text((sumR19 - sumR19 / 1.19).toFixed(2).replace('.', ',') + ' €', colR19, y, { width: colGes - colR19, align: 'right', lineBreak: false });
  y += 22;

  // Gesamtsumme
  doc.rect(mL + 140, y, cW - 140, 0.8).fill('#000');
  y += 10;
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#000');
  doc.text('Gesamtumsatz Laden (brutto):', colR7 - 100, y, { lineBreak: false });
  doc.text((sumR7 + sumR19).toFixed(2).replace('.', ',') + ' €', colGes, y, { width: W - mR - colGes, align: 'right', lineBreak: false });
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor('#555');
  doc.text('Gesamtumsatz Netto:', colR7 - 100, y, { lineBreak: false });
  doc.text((sumR7 / 1.07 + sumR19 / 1.19).toFixed(2).replace('.', ',') + ' €', colGes, y, { width: W - mR - colGes, align: 'right', lineBreak: false });

  // Fußzeile
  doc.font('Helvetica').fontSize(8).fillColor('#666')
     .text('Seite 1', mL, H - 30, { width: cW, align: 'center', lineBreak: false });

  doc.end();
}));

module.exports = router;
