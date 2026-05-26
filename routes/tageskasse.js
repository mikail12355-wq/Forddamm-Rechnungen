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
const KB_CW = KB_W - KB_ML - KB_MR;   // 491.28
const KB_DAYS_DE = ['So.','Mo.','Di.','Mi.','Do.','Fr.','Sa.'];

// Kompakter Header — gibt Startposition der Tabelle zurück (~102px)
function kbHeader(doc, title, subtitle, note) {
  const mL = KB_ML, cW = KB_CW;
  let y = 36;
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(16)
     .text('BÄCKEREI FORDDAMM', mL, y, { lineBreak: false });
  doc.fillColor(KB_C.gold).font('Helvetica').fontSize(7.5)
     .text('Murat Öztürk  ·  Forddamm 13  ·  12107 Berlin', mL, y + 18, { lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('KASSENBERICHT', mL, y, { width: cW, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(18)
     .text(title, mL, y + 11, { width: cW, align: 'right', lineBreak: false });
  y += 40;
  doc.rect(mL, y, cW, 1.5).fill(KB_C.gold);
  y += 8;
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7)
     .text('BERICHTSZEITRAUM', mL, y + 2, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(11)
     .text(subtitle, mL + 108, y, { lineBreak: false });
  if (note) {
    doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
       .text(note, mL + 230, y + 2, { lineBreak: false });
  }
  y += 18;
  return y; // ~102
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

  const monthNum    = parseInt(month);
  const yearNum     = parseInt(year);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthName   = MONTHS[monthNum - 1];

  const rows = await db.execute(
    "SELECT * FROM daily_cash WHERE strftime('%Y', date) = ? AND strftime('%m', date) = ? ORDER BY date ASC",
    [String(yearNum), String(monthNum).padStart(2, '0')]
  );
  const lottoRows  = rows.rows;
  const dayMap     = {};
  lottoRows.forEach(e => { dayMap[parseInt(e.date.split('-')[2])] = e; });
  const totalLotto = lottoRows.reduce((s, e) => s + Number(e.lotto_revenue), 0);

  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Kassenbericht ${monthName} ${yearNum} Lotto` } });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="Kassenbericht_${monthName}_${yearNum}_Lotto.pdf"`);
  doc.pipe(res);

  const mL  = KB_ML, cW = KB_CW;
  const colBem = mL + 80;
  const ROW_H  = 16;

  let y = kbHeader(doc, 'LOTTO', `${monthName} ${yearNum}`);

  // Tabellenkopf
  doc.rect(mL, y, cW, 20).fill(KB_C.bg);
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7.5);
  doc.text('TAG',       mL + 6, y + 6, { lineBreak: false });
  doc.text('BEMERKUNG', colBem, y + 6, { lineBreak: false });
  doc.text('UMSATZ',    mL,     y + 6, { width: cW - 6, align: 'right', lineBreak: false });
  y += 20;
  doc.rect(mL, y, cW, 1).fill(KB_C.gold);
  y += 1;

  // Tageszeilen — nur Tage mit Lotto-Eintrag
  let idx = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const e = dayMap[day];
    if (!e) continue;
    const lotto  = Number(e.lotto_revenue);
    const isAusz = lotto < 0;
    const date   = new Date(yearNum, monthNum - 1, day);
    const label  = `${KB_DAYS_DE[date.getDay()]}  ${String(day).padStart(2, '0')}.`;
    const notes  = e.notes || '';

    if (idx % 2 === 1) doc.rect(mL, y, cW, ROW_H).fill(KB_C.rowAlt);
    doc.fillColor(KB_C.dark).font('Helvetica').fontSize(8.5)
       .text(label, mL + 6, y + 4, { lineBreak: false });
    if (notes) doc.fillColor(KB_C.dark)
       .text(notes, colBem, y + 4, { width: KB_W - KB_MR - colBem - 90, lineBreak: false });
    if (lotto !== 0) {
      const lottoLabel = isAusz
        ? '-' + Math.abs(lotto).toFixed(2).replace('.', ',') + ' €'
        : lotto.toFixed(2).replace('.', ',') + ' €';
      doc.fillColor(KB_C.dark).font('Helvetica-Bold')
         .text(lottoLabel, mL, y + 4, { width: cW - 6, align: 'right', lineBreak: false });
    }
    y += ROW_H;
    idx++;
  }

  // Abschlusslinie
  doc.rect(mL, y, cW, 1).fill(KB_C.border);
  y += 12;

  // Gesamtbetrag
  const accentColor = totalLotto >= 0 ? KB_C.gold : '#27ae60';
  doc.rect(mL, y, 3, 26).fill(accentColor);
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(8.5)
     .text('ZU ÜBERWEISENDER BETRAG', mL + 10, y + 3, { lineBreak: false });
  const totalLabel = totalLotto >= 0
    ? totalLotto.toFixed(2).replace('.', ',') + ' €'
    : '− ' + Math.abs(totalLotto).toFixed(2).replace('.', ',') + ' € (Guthaben)';
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(15)
     .text(totalLabel, mL, y, { width: cW - 6, align: 'right', lineBreak: false });
  y += 30;

  // Aufschlüsselung
  const einnahmen  = lottoRows.filter(e => Number(e.lotto_revenue) > 0).reduce((s, e) => s + Number(e.lotto_revenue), 0);
  const auszahlung = lottoRows.filter(e => Number(e.lotto_revenue) < 0).reduce((s, e) => s + Number(e.lotto_revenue), 0);
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text(
       `Einnahmen: ${einnahmen.toFixed(2).replace('.', ',')} €` +
       (auszahlung < 0 ? `   ·   Auszahlungen: ${Math.abs(auszahlung).toFixed(2).replace('.', ',')} €` : '') +
       `   ·   ${lottoRows.length} Einträge · ${monthName} ${yearNum}`,
       mL + 10, y, { lineBreak: false }
     );

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

  const monthNum    = parseInt(month);
  const yearNum     = parseInt(year);
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const monthName   = MONTHS[monthNum - 1];

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
  // Spalten: Tag | Bemerkung | 7% brutto | 19% brutto | Gesamt
  const colBem = mL + 68;
  const col7W  = col7R => col7R - mL - 6;   // Hilfsfunktion für width
  const col7RE  = mL + 290;  // rechter Rand 7%-Spalte
  const col19RE = mL + 390;  // rechter Rand 19%-Spalte
  const ROW_H   = 15;
  const EUR     = n => Number(n).toFixed(2).replace('.', ',') + ' €';

  let y = kbHeader(doc, 'LADEN', `${monthName} ${yearNum}`, 'ohne Lotto-Umsatz');

  // Tabellenkopf
  doc.rect(mL, y, cW, 20).fill(KB_C.bg);
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7);
  doc.text('TAG',         mL + 6,  y + 6, { lineBreak: false });
  doc.text('BEMERKUNG',   colBem,  y + 6, { lineBreak: false });
  doc.text('7 % BRUTTO',  mL,      y + 6, { width: col7RE  - mL - 6, align: 'right', lineBreak: false });
  doc.text('19 % BRUTTO', mL,      y + 6, { width: col19RE - mL - 6, align: 'right', lineBreak: false });
  doc.text('GESAMT',      mL,      y + 6, { width: cW - 6,           align: 'right', lineBreak: false });
  y += 20;
  doc.rect(mL, y, cW, 1).fill(KB_C.gold);
  y += 1;

  // Tageszeilen — nur Tage mit Laden-Umsatz
  let idx = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    const e = dayMap[day];
    if (!e) continue;
    const r7   = Number(e.revenue_7);
    const r19  = Number(e.revenue_19);
    const ges  = r7 + r19;
    const date  = new Date(yearNum, monthNum - 1, day);
    const label = `${KB_DAYS_DE[date.getDay()]}  ${String(day).padStart(2, '0')}.`;

    if (idx % 2 === 1) doc.rect(mL, y, cW, ROW_H).fill(KB_C.rowAlt);
    doc.fillColor(KB_C.dark).font('Helvetica').fontSize(8.5)
       .text(label, mL + 6, y + 3, { lineBreak: false });
    if (e.notes) doc.text(e.notes, colBem, y + 3, { width: col7RE - colBem - 8, lineBreak: false });
    if (r7  > 0) doc.text(EUR(r7),  mL, y + 3, { width: col7RE  - mL - 6, align: 'right', lineBreak: false });
    if (r19 > 0) doc.text(EUR(r19), mL, y + 3, { width: col19RE - mL - 6, align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold')
       .text(EUR(ges), mL, y + 3, { width: cW - 6, align: 'right', lineBreak: false });
    y += ROW_H;
    idx++;
  }

  // Abschlusslinie
  doc.rect(mL, y, cW, 1).fill(KB_C.border);
  y += 6;

  // ─── Summen-Block (kompakt, alles auf einer Seite) ────────────────────────
  const SH = 13; // Zeilenhöhe im Summen-Block

  // Hintergrund für Summen-Zeilen
  doc.rect(mL, y, cW, SH * 4 + 10).fill(KB_C.bg);

  // Zeile A: 7% brutto
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7)
     .text('7 % UMSATZ BRUTTO', mL + 6, y + 3, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(8.5)
     .text(EUR(sumR7), mL, y + 3, { width: cW - 6, align: 'right', lineBreak: false });
  y += SH;

  // Zeile B: 7% netto + MwSt
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('Netto (÷ 1,07)', mL + 14, y + 2, { lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR7 / 1.07), mL, y + 2, { width: col19RE - mL, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('MwSt:', col19RE + 6, y + 2, { lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR7 - sumR7 / 1.07), col19RE + 6, y + 2,
           { width: mL + cW - col19RE - 12, align: 'right', lineBreak: false });
  y += SH + 4;

  // Zeile C: 19% brutto
  doc.fillColor(KB_C.gold).font('Helvetica-Bold').fontSize(7)
     .text('19 % UMSATZ BRUTTO', mL + 6, y + 3, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(8.5)
     .text(EUR(sumR19), mL, y + 3, { width: cW - 6, align: 'right', lineBreak: false });
  y += SH;

  // Zeile D: 19% netto + MwSt
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('Netto (÷ 1,19)', mL + 14, y + 2, { lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR19 / 1.19), mL, y + 2, { width: col19RE - mL, align: 'right', lineBreak: false });
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text('MwSt:', col19RE + 6, y + 2, { lineBreak: false });
  doc.fillColor(KB_C.mid).font('Helvetica').fontSize(8)
     .text(EUR(sumR19 - sumR19 / 1.19), col19RE + 6, y + 2,
           { width: mL + cW - col19RE - 12, align: 'right', lineBreak: false });
  y += SH + 10;

  // Trennlinie vor Gesamt
  doc.rect(mL, y, cW, 1.5).fill(KB_C.border);
  y += 10;

  // Gesamtumsatz mit Gold-Akzent
  doc.rect(mL, y, 3, 26).fill(KB_C.gold);
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(8.5)
     .text('GESAMTUMSATZ LADEN (BRUTTO)', mL + 10, y + 2, { lineBreak: false });
  doc.fillColor(KB_C.dark).font('Helvetica-Bold').fontSize(14)
     .text(EUR(sumR7 + sumR19), mL, y, { width: cW - 6, align: 'right', lineBreak: false });
  y += 18;

  // Netto + MwSt-Gesamt
  doc.fillColor(KB_C.gray).font('Helvetica').fontSize(7.5)
     .text(
       `Gesamtnetto: ${EUR(sumR7 / 1.07 + sumR19 / 1.19)}` +
       `   ·   MwSt gesamt: ${EUR((sumR7 - sumR7 / 1.07) + (sumR19 - sumR19 / 1.19))}` +
       `   ·   ${ladenRows.length} Einträge · ${monthName} ${yearNum}`,
       mL + 10, y, { lineBreak: false }
     );

  kbFooter(doc);
  doc.end();
}));

module.exports = router;
