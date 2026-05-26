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

// ─── Farben & Hilfsfunktionen (Kassenbericht) ────────────────────────────────
const KB_C = {
  dark:   '#2b1e0f',
  gold:   '#c8913a',
  mid:    '#6b4c2a',
  border: '#d4b896',
  gray:   '#9a8070',
  rowAlt: '#f9f5ef',
  bg:     '#f6f0e8',
};
const KB_W = 595.28, KB_H = 841.89;
const KB_ML = 52, KB_MR = 52;
const KB_CW = KB_W - KB_ML - KB_MR;
const KB_DAYS_DE = ['So.','Mo.','Di.','Mi.','Do.','Fr.','Sa.'];

function kbHeader(doc, title, subtitle) {
  const mL = KB_ML, cW = KB_CW;
  let y = 44;
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(18)
     .text('BÄCKEREI FORDDAMM', mL, y, { lineBreak: false });
  doc.fillColor(KB_C.gold).font('Helvetica').fontSize(8)
     .text('Murat Öztürk  ·  Forddamm 13  ·  12107 Berlin', mL, y + 24, { lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text('KASSENBERICHT', mL, y, { width: cW, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(22)
     .text(title, mL, y + 14, { width: cW, align: 'right', lineBreak: false });
  y += 52;
  doc.rect(mL, y, cW, 1.5).fill(KB_C.gold);
  y += 16;
  doc.fillColor(KB_C.gold).font('Helvetica').fontSize(7.5)
     .text('BERICHTSZEITRAUM', mL, y, { lineBreak: false });
  y += 12;
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(13)
     .text(subtitle, mL, y, { lineBreak: false });
  y += 32;
  return y;
}

function kbFooter(doc) {
  const mL = KB_ML, cW = KB_CW, H = KB_H;
  doc.rect(mL, H - 40, cW, 1).fill(KB_C.border);
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('SteuerNr. 20/460/01995', mL, H - 26, { lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('Bäckerei & Café Forddamm  ·  Forddamm 13, 12107 Berlin',
           mL, H - 26, { width: cW, align: 'right', lineBreak: false });
}

// ─── KASSENBERICHT LOTTO (PDF) ───────────────────────────────────────────────
router.get('/kassenbericht-lotto', w(async (req, res) => {
  const { year, month } = req.query;
  if (!year || year === 'all' || !month || month === 'all') {
    req.flash('error', 'Bitte wählen Sie ein konkretes Jahr und einen Monat aus.');
    return res.redirect('/tageskasse');
  }

  const monthNum  = parseInt(month);
  const yearNum   = parseInt(year);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthName = MONTHS[monthNum - 1];

  const rows = await db.execute(
    "SELECT * FROM daily_cash WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? ORDER BY date ASC",
    [String(yearNum), String(monthNum).padStart(2, '0')]
  );
  const allEntries  = rows.rows;
  const lottoRows   = allEntries.filter(e => Number(e.lotto_revenue) !== 0);
  const dayMap      = {};
  lottoRows.forEach(e => { dayMap[parseInt(e.date.split('-')[2])] = e; });
  const totalLotto  = lottoRows.reduce((s, e) => s + Number(e.lotto_revenue), 0);

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Kassenbericht ${monthName} ${yearNum} Lotto` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Kassenbericht_${monthName}_${yearNum}_Lotto.pdf"`);
  doc.pipe(res);

  const mL = KB_ML, cW = KB_CW;
  const colBem = mL + 80;
  const ROW_H  = 22;

  let y = kbHeader(doc, 'LOTTO', `${monthName} ${yearNum}`);

  // Tabellenkopf
  doc.rect(mL, y, cW, 26).fill(KB_C.bg);
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7.5);
  doc.text('TAG',       mL + 6,  y + 9, { lineBreak: false });
  doc.text('BEMERKUNG', colBem,  y + 9, { lineBreak: false });
  doc.text('UMSATZ',    mL, y + 9, { width: cW - 6, align: 'right', lineBreak: false });
  y += 26;
  doc.rect(mL, y, cW, 1).fill(KB_C.gold);
  y += 1;

  // Tageszeilen — nur Tage mit Lotto-Eintrag
  let idx = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const e = dayMap[day];
    if (!e) continue;
    const lotto = Number(e.lotto_revenue);
    const date  = new Date(yearNum, monthNum - 1, day);
    const label = `${KB_DAYS_DE[date.getDay()]}  ${String(day).padStart(2, '0')}.`;

    const isAusz = lotto < 0;
    if (idx % 2 === 1) doc.rect(mL, y, cW, ROW_H).fill(isAusz ? '#f0fff4' : KB_C.rowAlt);
    doc.fillColor(KB_C.dark).font('Helvetica').fontSize(9)
       .text(label, mL + 6, y + 7, { lineBreak: false });
    const bemText = isAusz ? 'Gewinnausschüttung' + (e.notes ? ` (${e.notes})` : '') : (e.notes || '');
    if (bemText) doc.fillColor(isAusz ? '#27ae60' : KB_C.dark)
       .text(bemText, colBem, y + 7, { width: KB_W - KB_MR - colBem - 90, lineBreak: false });
    const lottoLabel = isAusz
      ? '− ' + Math.abs(lotto).toFixed(2).replace('.', ',') + ' €'
      : lotto.toFixed(2).replace('.', ',') + ' €';
    doc.fillColor(isAusz ? '#27ae60' : KB_C.dark).font('Helvetica-Bold')
       .text(lottoLabel, mL, y + 7, { width: cW - 6, align: 'right', lineBreak: false });
    y += ROW_H;
    idx++;
  }

  // Abschlusslinie + Gesamtsumme
  doc.rect(mL, y, cW, 1).fill(KB_C.border);
  y += 18;
  const accentColor = totalLotto >= 0 ? KB_C.gold : '#27ae60';
  doc.rect(mL, y - 2, 3, 28).fill(accentColor);
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(9)
     .text('ZU ÜBERWEISENDER BETRAG', mL + 10, y + 4, { lineBreak: false });
  const totalLabel = totalLotto >= 0
    ? totalLotto.toFixed(2).replace('.', ',') + ' €'
    : '− ' + Math.abs(totalLotto).toFixed(2).replace('.', ',') + ' € (Guthaben)';
  doc.fillColor(totalLotto >= 0 ? KB_C.dark : '#27ae60').font('Helvetica-Bold').fontSize(16)
     .text(totalLabel, mL, y, { width: cW - 6, align: 'right', lineBreak: false });
  y += 34;
  const einnahmen  = lottoRows.filter(e => Number(e.lotto_revenue) > 0).reduce((s, e) => s + Number(e.lotto_revenue), 0);
  const auszahlung = lottoRows.filter(e => Number(e.lotto_revenue) < 0).reduce((s, e) => s + Number(e.lotto_revenue), 0);
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text(`Einnahmen: ${einnahmen.toFixed(2).replace('.', ',')} €   ·   Gewinnausschüttungen: ${Math.abs(auszahlung).toFixed(2).replace('.', ',')} €   ·   ${lottoRows.length} Einträge · ${monthName} ${yearNum}`,
           mL + 10, y, { lineBreak: false });

  kbFooter(doc);
  doc.end();
}));

// ─── KASSENBERICHT LADEN ohne Lotto (PDF) ────────────────────────────────────
router.get('/kassenbericht-laden', w(async (req, res) => {
  const { year, month } = req.query;
  if (!year || year === 'all' || !month || month === 'all') {
    req.flash('error', 'Bitte wählen Sie ein konkretes Jahr und einen Monat aus.');
    return res.redirect('/tageskasse');
  }

  const monthNum  = parseInt(month);
  const yearNum   = parseInt(year);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthName = MONTHS[monthNum - 1];

  const rows = await db.execute(
    "SELECT * FROM daily_cash WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? ORDER BY date ASC",
    [String(yearNum), String(monthNum).padStart(2, '0')]
  );
  const ladenRows = rows.rows.filter(e => Number(e.revenue_7) > 0 || Number(e.revenue_19) > 0);
  const dayMap    = {};
  ladenRows.forEach(e => { dayMap[parseInt(e.date.split('-')[2])] = e; });
  const sumR7  = ladenRows.reduce((s, e) => s + Number(e.revenue_7),  0);
  const sumR19 = ladenRows.reduce((s, e) => s + Number(e.revenue_19), 0);

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Kassenbericht ${monthName} ${yearNum} Laden` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Kassenbericht_${monthName}_${yearNum}_Laden.pdf"`);
  doc.pipe(res);

  const mL  = KB_ML, cW = KB_CW;
  // Spalten (rechts-ausgerichtet): Tag | Bemerkung | 7% | 19% | Gesamt
  const colBem  = mL + 72;
  const col7R   = mL + 295;   // rechter Rand der 7%-Spalte
  const col19R  = mL + 395;   // rechter Rand der 19%-Spalte
  const colGesR = mL + cW;    // rechter Rand Gesamt
  const ROW_H   = 22;
  const EUR     = n => Number(n).toFixed(2).replace('.', ',') + ' €';

  let y = kbHeader(doc, 'LADEN', `${monthName} ${yearNum}`);

  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text('ohne Lotto-Umsatz', mL, y - 22, { lineBreak: false });

  // Tabellenkopf
  doc.rect(mL, y, cW, 26).fill(KB_C.bg);
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7.5);
  doc.text('TAG',        mL + 6,  y + 9, { lineBreak: false });
  doc.text('BEMERKUNG',  colBem,  y + 9, { lineBreak: false });
  doc.text('7 % BRUTTO', mL, y + 9, { width: col7R  - mL - 6, align: 'right', lineBreak: false });
  doc.text('19 % BRUTTO',mL, y + 9, { width: col19R - mL - 6, align: 'right', lineBreak: false });
  doc.text('GESAMT',     mL, y + 9, { width: cW     - 6,      align: 'right', lineBreak: false });
  y += 26;
  doc.rect(mL, y, cW, 1).fill(KB_C.gold);
  y += 1;

  // Tageszeilen — nur Tage mit Laden-Umsatz
  let idx = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const e = dayMap[day];
    if (!e) continue;
    const r7  = Number(e.revenue_7);
    const r19 = Number(e.revenue_19);
    const ges = r7 + r19;
    const date  = new Date(yearNum, monthNum - 1, day);
    const label = `${KB_DAYS_DE[date.getDay()]}  ${String(day).padStart(2, '0')}.`;

    if (idx % 2 === 1) doc.rect(mL, y, cW, ROW_H).fill(KB_C.rowAlt);
    doc.fillColor(KB_C.dark).font('Helvetica').fontSize(9)
       .text(label, mL + 6, y + 7, { lineBreak: false });
    if (e.notes) doc.text(e.notes, colBem, y + 7, { width: col7R - colBem - 50, lineBreak: false });
    if (r7  > 0) doc.text(EUR(r7),  mL, y + 7, { width: col7R  - mL - 6, align: 'right', lineBreak: false });
    if (r19 > 0) doc.text(EUR(r19), mL, y + 7, { width: col19R - mL - 6, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold')
       .text(EUR(ges), mL, y + 7, { width: cW - 6, align: 'right', lineBreak: false });
    y += ROW_H;
    idx++;
  }

  // Abschlusslinie
  doc.rect(mL, y, cW, 1).fill(KB_C.border);
  y += 22;

  // ─── Summen-Block ─────────────────────────────────────────────────────────
  const sumX   = mL + 140;
  const sumCW  = cW - 140;
  const valEnd = cW - 6;

  // 7%-Zeile
  doc.rect(mL, y, cW, 26).fill(KB_C.bg);
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7.5)
     .text('7 % UMSATZ', sumX + 6, y + 3, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(9)
     .text(EUR(sumR7), mL, y + 13, { width: col7R - mL - 6, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text('Netto (÷ 1,07)', mL, y + 3, { width: col19R - mL - 6, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR7 / 1.07), mL, y + 14, { width: col19R - mL - 6, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text('MwSt 7 %', mL, y + 3, { width: valEnd, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR7 - sumR7 / 1.07), mL, y + 14, { width: valEnd, align: 'right', lineBreak: false });
  y += 32;

  // 19%-Zeile
  doc.rect(mL, y, cW, 26).fill('#fff');
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7.5)
     .text('19 % UMSATZ', sumX + 6, y + 3, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(9)
     .text(EUR(sumR19), mL, y + 13, { width: col7R - mL - 6, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text('Netto (÷ 1,19)', mL, y + 3, { width: col19R - mL - 6, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR19 / 1.19), mL, y + 14, { width: col19R - mL - 6, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text('MwSt 19 %', mL, y + 3, { width: valEnd, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR19 - sumR19 / 1.19), mL, y + 14, { width: valEnd, align: 'right', lineBreak: false });
  y += 38;

  // Gesamtsumme mit Gold-Akzent
  doc.rect(mL, y - 2, 3, 30).fill(KB_C.gold);
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(9)
     .text('GESAMTUMSATZ LADEN (BRUTTO)', mL + 10, y + 4, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(16)
     .text(EUR(sumR7 + sumR19), mL, y, { width: valEnd, align: 'right', lineBreak: false });
  y += 30;
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text(`Gesamtnetto: ${EUR(sumR7 / 1.07 + sumR19 / 1.19)}   ·   Gesamt-MwSt: ${EUR((sumR7 - sumR7/1.07) + (sumR19 - sumR19/1.19))}`,
           mL + 10, y, { lineBreak: false });
  y += 18;
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(8)
     .text(`${ladenRows.length} Einträge · ${monthName} ${yearNum}`, mL + 10, y, { lineBreak: false });

  kbFooter(doc);
  doc.end();
}));

module.exports = router;
