require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MemoryStore = require('memorystore')(session);
const flash = require('connect-flash');
const ejsLayouts = require('express-ejs-layouts');
const path = require('path');
const { initDB, getCompanyDb } = require('./db');

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
  cookie: { maxAge: 8 * 60 * 60 * 1000 },
  store: new MemoryStore({ checkPeriod: 8 * 60 * 60 * 1000 }),
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.user = req.session.user || null;
  res.locals.company = req.session.user?.company || null;
  if (req.session.user?.company_id) {
    req.db = getCompanyDb(req.session.user.company_id);
  }
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
app.use('/einkauf',     requireAuth, require('./routes/einkauf'));
app.use('/tageskasse',  requireAuth, require('./routes/tageskasse'));
app.use('/uebersicht',  requireAuth, require('./routes/uebersicht'));
app.use('/mitarbeiter', requireAuth, require('./routes/mitarbeiter'));
app.use('/angebote',   requireAuth, require('./routes/angebote'));
app.use('/api',        require('./routes/api'));

app.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/login');
});

app.get('/ping', (req, res) => res.sendStatus(200));

// Global error handler — catches unhandled async errors in routes
app.use((err, req, res, next) => {
  console.error('Unhandled route error:', err);
  if (res.headersSent) return next(err);
  req.flash?.('error', 'Ein unerwarteter Fehler ist aufgetreten.');
  res.status(500).redirect('back');
});

// Prevent unhandled promise rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Forddamm Rechnungssystem läuft auf http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Datenbankfehler beim Start:', err);
  process.exit(1);
});
