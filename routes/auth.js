const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { title: 'Anmelden', layout: false });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'Benutzername oder Passwort falsch.');
    return res.redirect('/login');
  }

  req.session.user = { id: user.id, username: user.username };
  res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/passwort', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.render('password', { title: 'Passwort ändern', layout: 'layout' });
});

router.post('/passwort', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  const { current, newpass, confirm } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.user.id);
  if (!bcrypt.compareSync(current, user.password_hash)) {
    req.flash('error', 'Aktuelles Passwort falsch.');
    return res.redirect('/passwort');
  }
  if (newpass !== confirm) {
    req.flash('error', 'Neues Passwort stimmt nicht überein.');
    return res.redirect('/passwort');
  }
  if (newpass.length < 8) {
    req.flash('error', 'Passwort muss mindestens 8 Zeichen haben.');
    return res.redirect('/passwort');
  }

  const hash = bcrypt.hashSync(newpass, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id);
  req.flash('success', 'Passwort erfolgreich geändert.');
  res.redirect('/dashboard');
});

module.exports = router;
