const express = require('express');
const router  = express.Router();
const { db }  = require('../db');

const w = fn => (req, res, next) => fn(req, res, next).catch(next);

const MONTHS = ['Januar','Februar','März','April','Mai','Juni',
                'Juli','August','September','Oktober','November','Dezember'];

// ── Hauptseite ───────────────────────────────────────────────
router.get('/', w(async (req, res) => {
  const now   = new Date();
  const monat = req.query.monat ||
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const [y, m] = monat.split('-');
  const monatLabel = MONTHS[parseInt(m) - 1] + ' ' + y;

  const [maRes, kostenRes, invRes, cashRes] = await Promise.all([
    db.execute('SELECT * FROM mitarbeiter ORDER BY rowid'),
    db.execute('SELECT ma_id, betrag FROM mitarbeiter_kosten WHERE monat = ?', [monat]),
    db.execute(`
      SELECT COALESCE(SUM(ii.quantity * ii.unit_price), 0) AS netto
      FROM invoice_items ii
      JOIN invoices i ON ii.invoice_id = i.id
      WHERE strftime('%Y-%m', i.date) = ?
    `, [monat]),
    db.execute(`
      SELECT COALESCE(SUM(revenue_7 + revenue_19), 0) AS brutto
      FROM daily_cash
      WHERE strftime('%Y-%m', date) = ?
    `, [monat]),
  ]);

  const employees = maRes.rows;

  // monatliche Überschreibung; fehlt sie, gilt das Standard-Gehalt
  const overrides = {};
  kostenRes.rows.forEach(r => { overrides[r.ma_id] = r.betrag; });

  const kosten = {};
  employees.forEach(e => {
    kosten[e.id] = overrides[e.id] !== undefined ? overrides[e.id] : (e.gehalt || 0);
  });

  const liefNetto   = Number(invRes.rows[0]?.netto)  || 0;
  const liefBrutto  = liefNetto * 1.07;
  const ladenBrutto = Number(cashRes.rows[0]?.brutto) || 0;
  const gesamtEin   = liefBrutto + ladenBrutto;

  const summen = { vz: 0, tz: 0, mj: 0 };
  employees.forEach(e => { summen[e.type] = (summen[e.type] || 0) + kosten[e.id]; });
  const totalKosten = summen.vz + summen.tz + summen.mj;
  const gewinn      = gesamtEin - totalKosten;

  res.render('mitarbeiter/index', {
    title: 'Mitarbeiter',
    monat, monatLabel,
    employees, kosten, overrides,
    liefBrutto, ladenBrutto, gesamtEin,
    summen, totalKosten, gewinn,
  });
}));

// ── API: Mitarbeiter hinzufügen ──────────────────────────────
router.post('/ma', w(async (req, res) => {
  const { id, label, type, gehalt } = req.body;
  if (!id || !label || !type) return res.status(400).json({ error: 'Fehlende Felder' });
  await db.execute(
    'INSERT INTO mitarbeiter (id, label, type, gehalt) VALUES (?, ?, ?, ?)',
    [id, label, type, parseFloat(gehalt) || 0]
  );
  res.json({ ok: true });
}));

// ── API: Mitarbeiter bearbeiten ──────────────────────────────
router.put('/ma/:id', w(async (req, res) => {
  const { label, type, gehalt } = req.body;
  if (!label || !type) return res.status(400).json({ error: 'Fehlende Felder' });
  await db.execute(
    'UPDATE mitarbeiter SET label = ?, type = ?, gehalt = ? WHERE id = ?',
    [label, type, parseFloat(gehalt) || 0, req.params.id]
  );
  res.json({ ok: true });
}));

// ── API: Mitarbeiter löschen ─────────────────────────────────
router.delete('/ma/:id', w(async (req, res) => {
  await db.execute('DELETE FROM mitarbeiter_kosten WHERE ma_id = ?', [req.params.id]);
  await db.execute('DELETE FROM mitarbeiter WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
}));

// ── API: Monatskosten speichern (Überschreibung) ─────────────
router.put('/kosten/:monat/:maId', w(async (req, res) => {
  const { monat, maId } = req.params;
  const betrag = req.body.betrag;

  // Hole das Standard-Gehalt des Mitarbeiters
  const maRes = await db.execute('SELECT gehalt FROM mitarbeiter WHERE id = ?', [maId]);
  const gehalt = Number(maRes.rows[0]?.gehalt) || 0;
  const val    = betrag === '' || betrag === null || betrag === undefined
    ? null
    : parseFloat(betrag) || 0;

  // Nur speichern wenn der Wert vom Standard-Gehalt abweicht
  if (val === null || val === gehalt) {
    await db.execute(
      'DELETE FROM mitarbeiter_kosten WHERE monat = ? AND ma_id = ?',
      [monat, maId]
    );
  } else {
    await db.execute(
      'INSERT OR REPLACE INTO mitarbeiter_kosten (monat, ma_id, betrag) VALUES (?, ?, ?)',
      [monat, maId, val]
    );
  }
  res.json({ ok: true });
}));

module.exports = router;
