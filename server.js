require('dotenv').config();
const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET || 'forddamm-fallback-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.user = req.session.user || null;
  next();
});

const requireAuth = (req, res, next) => {
  if (req.session.user) return next();
  res.redirect('/login');
};

app.use('/', require('./routes/auth'));
app.use('/dashboard', requireAuth, require('./routes/dashboard'));
app.use('/rechnungen', requireAuth, require('./routes/invoices'));
app.use('/kunden', requireAuth, require('./routes/customers'));
app.use('/artikel', requireAuth, require('./routes/articles'));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.listen(PORT, () => {
  console.log(`Forddamm Rechnungssystem läuft auf http://localhost:${PORT}`);
});
