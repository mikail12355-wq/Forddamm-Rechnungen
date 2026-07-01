const express = require('express');
const router = express.Router();
const { masterDb: db } = require('../db');

const requireApiKey = (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

router.use(requireApiKey);

// GET /api/bestellungen?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/bestellungen', async (req, res) => {
  try {
    const { from, to } = req.query;
    let sql = 'SELECT * FROM bestellungen';
    const args = [];
    if (from && to) {
      sql += ' WHERE lieferdatum >= ? AND lieferdatum <= ?';
      args.push(from, to);
    } else if (from) {
      sql += ' WHERE lieferdatum >= ?';
      args.push(from);
    }
    sql += ' ORDER BY lieferdatum ASC, lieferzeit ASC';
    const result = await db.execute({ sql, args });
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/bestellungen/:id
router.get('/bestellungen/:id', async (req, res) => {
  try {
    const result = await db.execute({ sql: 'SELECT * FROM bestellungen WHERE id = ?', args: [req.params.id] });
    if (!result.rows[0]) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/bestellungen
router.post('/bestellungen', async (req, res) => {
  try {
    const { kunde, produkt, menge, lieferdatum, lieferzeit, notizen, status } = req.body;
    if (!kunde || !produkt || !lieferdatum) {
      return res.status(400).json({ error: 'kunde, produkt und lieferdatum sind Pflichtfelder' });
    }
    const result = await db.execute({
      sql: 'INSERT INTO bestellungen (kunde, produkt, menge, lieferdatum, lieferzeit, notizen, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [kunde, produkt, menge ?? 1, lieferdatum, lieferzeit ?? '', notizen ?? '', status ?? 'offen']
    });
    const row = await db.execute({ sql: 'SELECT * FROM bestellungen WHERE id = ?', args: [result.lastInsertRowid] });
    res.status(201).json(row.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/bestellungen/:id
router.put('/bestellungen/:id', async (req, res) => {
  try {
    const { kunde, produkt, menge, lieferdatum, lieferzeit, notizen, status } = req.body;
    if (!kunde || !produkt || !lieferdatum) {
      return res.status(400).json({ error: 'kunde, produkt und lieferdatum sind Pflichtfelder' });
    }
    await db.execute({
      sql: 'UPDATE bestellungen SET kunde=?, produkt=?, menge=?, lieferdatum=?, lieferzeit=?, notizen=?, status=? WHERE id=?',
      args: [kunde, produkt, menge ?? 1, lieferdatum, lieferzeit ?? '', notizen ?? '', status ?? 'offen', req.params.id]
    });
    const row = await db.execute({ sql: 'SELECT * FROM bestellungen WHERE id = ?', args: [req.params.id] });
    if (!row.rows[0]) return res.status(404).json({ error: 'Nicht gefunden' });
    res.json(row.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/bestellungen/:id
router.delete('/bestellungen/:id', async (req, res) => {
  try {
    await db.execute({ sql: 'DELETE FROM bestellungen WHERE id = ?', args: [req.params.id] });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/kunden — Kundennamen für Autocomplete
router.get('/kunden', async (req, res) => {
  try {
    const result = await db.execute('SELECT id, name FROM customers ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
