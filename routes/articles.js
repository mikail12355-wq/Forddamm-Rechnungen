const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  const articles = db.prepare('SELECT * FROM articles ORDER BY name').all();
  res.render('articles/index', { title: 'Artikel', articles });
});

router.get('/neu', (req, res) => {
  res.render('articles/form', { title: 'Neuer Artikel', article: null });
});

router.post('/neu', (req, res) => {
  const { name, unit_price } = req.body;
  const price = parseFloat(String(unit_price).replace(',', '.'));
  if (!name?.trim() || isNaN(price) || price <= 0) {
    req.flash('error', 'Name und gültiger Preis sind erforderlich.');
    return res.redirect('/artikel/neu');
  }
  db.prepare('INSERT INTO articles (name, unit_price) VALUES (?, ?)').run(name.trim(), price);
  req.flash('success', `Artikel "${name}" wurde angelegt.`);
  res.redirect('/artikel');
});

router.get('/:id/bearbeiten', (req, res) => {
  const article = db.prepare('SELECT * FROM articles WHERE id = ?').get(req.params.id);
  if (!article) { req.flash('error', 'Artikel nicht gefunden.'); return res.redirect('/artikel'); }
  res.render('articles/form', { title: 'Artikel bearbeiten', article });
});

router.post('/:id/bearbeiten', (req, res) => {
  const { name, unit_price, active } = req.body;
  const price = parseFloat(String(unit_price).replace(',', '.'));
  if (!name?.trim() || isNaN(price) || price <= 0) {
    req.flash('error', 'Name und gültiger Preis sind erforderlich.');
    return res.redirect(`/artikel/${req.params.id}/bearbeiten`);
  }
  db.prepare('UPDATE articles SET name=?, unit_price=?, active=? WHERE id=?').run(name.trim(), price, active ? 1 : 0, +req.params.id);
  req.flash('success', `Artikel "${name}" aktualisiert.`);
  res.redirect('/artikel');
});

router.post('/:id/loeschen', (req, res) => {
  const article = db.prepare('SELECT name FROM articles WHERE id = ?').get(req.params.id);
  if (!article) { req.flash('error', 'Artikel nicht gefunden.'); return res.redirect('/artikel'); }
  db.prepare('DELETE FROM articles WHERE id = ?').run(+req.params.id);
  req.flash('success', `Artikel "${article.name}" gelöscht.`);
  res.redirect('/artikel');
});

module.exports = router;
