const express = require('express');
const router = express.Router();
const { db } = require('../db');

router.get('/', async (req, res) => {
  const result = await db.execute('SELECT * FROM articles ORDER BY name');
  res.render('articles/index', { title: 'Artikel', articles: result.rows });
});

router.get('/neu', (req, res) => {
  res.render('articles/form', { title: 'Neuer Artikel', article: null });
});

router.post('/neu', async (req, res) => {
  const { name, unit_price } = req.body;
  const price = parseFloat(String(unit_price).replace(',', '.'));
  if (!name?.trim() || isNaN(price) || price <= 0) { req.flash('error', 'Name und gültiger Preis sind erforderlich.'); return res.redirect('/artikel/neu'); }
  await db.execute('INSERT INTO articles (name, unit_price) VALUES (?, ?)', [name.trim(), price]);
  req.flash('success', `Artikel "${name}" wurde angelegt.`);
  res.redirect('/artikel');
});

router.get('/:id/bearbeiten', async (req, res) => {
  const result = await db.execute('SELECT * FROM articles WHERE id = ?', [+req.params.id]);
  const article = result.rows[0];
  if (!article) { req.flash('error', 'Artikel nicht gefunden.'); return res.redirect('/artikel'); }
  res.render('articles/form', { title: 'Artikel bearbeiten', article });
});

router.post('/:id/bearbeiten', async (req, res) => {
  const { name, unit_price, active } = req.body;
  const price = parseFloat(String(unit_price).replace(',', '.'));
  if (!name?.trim() || isNaN(price) || price <= 0) { req.flash('error', 'Name und gültiger Preis sind erforderlich.'); return res.redirect(`/artikel/${req.params.id}/bearbeiten`); }
  await db.execute('UPDATE articles SET name=?, unit_price=?, active=? WHERE id=?', [name.trim(), price, active ? 1 : 0, +req.params.id]);
  req.flash('success', `Artikel "${name}" aktualisiert.`);
  res.redirect('/artikel');
});

router.post('/:id/loeschen', async (req, res) => {
  const result = await db.execute('SELECT name FROM articles WHERE id = ?', [+req.params.id]);
  const article = result.rows[0];
  if (!article) { req.flash('error', 'Artikel nicht gefunden.'); return res.redirect('/artikel'); }
  await db.execute('DELETE FROM articles WHERE id = ?', [+req.params.id]);
  req.flash('success', `Artikel "${article.name}" gelöscht.`);
  res.redirect('/artikel');
});

module.exports = router;
