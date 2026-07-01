require('dotenv').config();
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

// ── Master-Datenbank (Firma 1 / Bäckerei Forddamm) ──────────────────────────
const masterUrl = process.env.TURSO_URL || (() => {
  const dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'forddamm.db');
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return `file:${dbPath}`;
})();

const masterDb = createClient({ url: masterUrl, authToken: process.env.TURSO_AUTH_TOKEN });

// Firma 1 zeigt immer auf masterDb
const companyClients = { 1: masterDb };

// Gibt den DB-Client für eine bestimmte Firma zurück (gecacht)
function getCompanyDb(companyId) {
  const id = Number(companyId) || 1;
  if (companyClients[id]) return companyClients[id];

  // Separate Turso-DB via Umgebungsvariable möglich (z.B. TURSO_URL_2)
  const tursoUrl   = process.env[`TURSO_URL_${id}`];
  const tursoToken = process.env[`TURSO_AUTH_TOKEN_${id}`];
  const url = tursoUrl || (() => {
    const dbPath = path.join(__dirname, 'data', `company_${id}.db`);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return `file:${dbPath}`;
  })();

  const client = createClient({ url, authToken: tursoToken });
  companyClients[id] = client;
  return client;
}

// ── Firmen-Datentabellen initialisieren (für jede Firma separat) ─────────────
async function initCompanyDB(db) {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      billing_street TEXT DEFAULT '',
      billing_zip TEXT DEFAULT '',
      billing_city TEXT DEFAULT '',
      delivery_contact TEXT DEFAULT '',
      delivery_street TEXT DEFAULT '',
      delivery_zip TEXT DEFAULT '',
      delivery_city TEXT DEFAULT '',
      cost_center TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      unit_price REAL NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number INTEGER NOT NULL UNIQUE,
      date TEXT NOT NULL,
      delivery_from TEXT DEFAULT '',
      delivery_to TEXT DEFAULT '',
      customer_id INTEGER REFERENCES customers(id),
      order_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      article_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS customer_prices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      unit_price REAL NOT NULL,
      UNIQUE(customer_id, article_id)
    );
    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS purchase_invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER REFERENCES suppliers(id),
      invoice_number TEXT DEFAULT '',
      date TEXT NOT NULL,
      notes TEXT DEFAULT '',
      pdf_filename TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_invoice_id INTEGER NOT NULL REFERENCES purchase_invoices(id) ON DELETE CASCADE,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 1,
      unit TEXT DEFAULT 'kg',
      unit_price REAL NOT NULL
    );
  `);

  await db.execute("CREATE TABLE IF NOT EXISTS product_aliases (product_name TEXT PRIMARY KEY, canonical_name TEXT NOT NULL)").catch(() => {});
  await db.execute("ALTER TABLE purchase_items ADD COLUMN line_total REAL").catch(() => {});
  await db.execute("ALTER TABLE purchase_items ADD COLUMN category TEXT DEFAULT 'Sonstiges'").catch(() => {});
  await db.execute("ALTER TABLE purchase_items ADD COLUMN pieces_per_unit INTEGER DEFAULT NULL").catch(() => {});
  await db.execute("ALTER TABLE customers ADD COLUMN billing_name TEXT DEFAULT ''").catch(() => {});
  await db.execute("ALTER TABLE customers ADD COLUMN delivery_name TEXT DEFAULT ''").catch(() => {});
  await db.execute("ALTER TABLE invoices ADD COLUMN delivery_contact TEXT DEFAULT ''").catch(() => {});
  await db.execute("ALTER TABLE invoices ADD COLUMN cost_center TEXT DEFAULT ''").catch(() => {});
  await db.execute("ALTER TABLE invoices ADD COLUMN payment_method TEXT DEFAULT 'transfer'").catch(() => {});
  await db.execute("ALTER TABLE invoices ADD COLUMN paid INTEGER DEFAULT 0").catch(() => {});
  await db.execute("ALTER TABLE invoices ADD COLUMN paid_at TEXT DEFAULT ''").catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS daily_cash (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT NOT NULL UNIQUE,
      total_cash    REAL NOT NULL DEFAULT 0,
      lotto_revenue REAL NOT NULL DEFAULT 0,
      notes         TEXT DEFAULT '',
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `).catch(() => {});
  await db.execute("ALTER TABLE daily_cash ADD COLUMN revenue_7  REAL NOT NULL DEFAULT 0").catch(() => {});
  await db.execute("ALTER TABLE daily_cash ADD COLUMN revenue_19 REAL NOT NULL DEFAULT 0").catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mitarbeiter (
      id    TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type  TEXT NOT NULL
    )
  `).catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mitarbeiter_kosten (
      monat TEXT NOT NULL,
      ma_id TEXT NOT NULL,
      betrag REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (monat, ma_id)
    )
  `).catch(() => {});
  await db.execute("ALTER TABLE mitarbeiter ADD COLUMN gehalt REAL DEFAULT 0").catch(() => {});
  await db.execute("ALTER TABLE purchase_invoices ADD COLUMN billing_month TEXT DEFAULT ''").catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_number INTEGER NOT NULL UNIQUE,
      date TEXT NOT NULL,
      valid_until TEXT DEFAULT '',
      delivery_from TEXT DEFAULT '',
      delivery_to TEXT DEFAULT '',
      customer_id INTEGER REFERENCES customers(id),
      order_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      delivery_contact TEXT DEFAULT '',
      cost_center TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).catch(() => {});
  await db.execute("ALTER TABLE quotes ADD COLUMN subject TEXT DEFAULT ''").catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS quote_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quote_id INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
      article_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      sort_order INTEGER DEFAULT 0
    )
  `).catch(() => {});
  await db.execute("CREATE INDEX IF NOT EXISTS idx_quote_items_quote_id ON quote_items(quote_id)").catch(() => {});
  await db.execute("CREATE INDEX IF NOT EXISTS idx_quotes_date ON quotes(date DESC)").catch(() => {});
  await db.execute(`
    CREATE TABLE IF NOT EXISTS bestellungen (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      kunde        TEXT NOT NULL,
      produkt      TEXT NOT NULL,
      menge        INTEGER NOT NULL DEFAULT 1,
      lieferdatum  TEXT NOT NULL,
      lieferzeit   TEXT DEFAULT '',
      notizen      TEXT DEFAULT '',
      status       TEXT DEFAULT 'offen',
      created_at   TEXT DEFAULT (datetime('now'))
    )
  `).catch(() => {});
  await db.execute("CREATE INDEX IF NOT EXISTS idx_bestellungen_datum ON bestellungen(lieferdatum)").catch(() => {});
  await db.executeMultiple(`
    CREATE INDEX IF NOT EXISTS idx_purchase_items_invoice_id   ON purchase_items(purchase_invoice_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_product_name ON purchase_items(product_name);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_category     ON purchase_items(category);
    CREATE INDEX IF NOT EXISTS idx_purchase_invoices_supplier  ON purchase_invoices(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_invoices_date      ON purchase_invoices(date DESC);
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice_id    ON invoice_items(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_invoices_date               ON invoices(date DESC);
    CREATE INDEX IF NOT EXISTS idx_invoices_number             ON invoices(invoice_number);
    CREATE INDEX IF NOT EXISTS idx_daily_cash_date             ON daily_cash(date DESC);
  `).catch(() => {});
}

// ── Haupt-Initialisierung ────────────────────────────────────────────────────
async function initDB() {
  // users + companies Tabellen in der Master-DB anlegen
  await masterDb.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS companies (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      subtitle   TEXT DEFAULT '',
      owner      TEXT DEFAULT '',
      street     TEXT DEFAULT '',
      zip        TEXT DEFAULT '',
      city       TEXT DEFAULT '',
      iban       TEXT DEFAULT '',
      bic        TEXT DEFAULT '',
      tax_number TEXT DEFAULT '',
      vat_rate   REAL DEFAULT 0.19,
      emoji      TEXT DEFAULT '🏪'
    );
  `);
  await masterDb.execute("ALTER TABLE users ADD COLUMN company_id INTEGER DEFAULT 1").catch(() => {});

  // Firma 1: Bäckerei Forddamm
  const c1 = await masterDb.execute('SELECT id FROM companies WHERE id = 1');
  if (!c1.rows[0]) {
    await masterDb.execute(
      `INSERT INTO companies (id, name, subtitle, owner, street, zip, city, iban, bic, tax_number, vat_rate, emoji)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [1, 'Bäckerei Forddamm', 'Bäckerei & Café', 'Murat Öztürk', 'Forddamm 13', '12107', 'Berlin',
       'DE67 1005 0000 0191 3708 27', 'BELADEBXXX', '20/460/01995', 0.07, '🥖']
    );
  }

  // Firma 2: Änderungsschneiderei Lankwitz
  const c2 = await masterDb.execute('SELECT id FROM companies WHERE id = 2');
  if (!c2.rows[0]) {
    await masterDb.execute(
      `INSERT INTO companies (id, name, subtitle, owner, street, zip, city, iban, bic, tax_number, vat_rate, emoji)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [2, 'Änderungsschneiderei Lankwitz', 'Änderungsschneiderei', 'Murat Öztürk',
       'Leonorenstraße 91', '12247', 'Berlin', '', '', '', 0.19, '✂️']
    );
  }

  // Benutzer: admin → Firma 1
  const adminRes = await masterDb.execute("SELECT id FROM users WHERE username = 'admin'");
  if (!adminRes.rows[0]) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Forddamm2024!', 10);
    await masterDb.execute(
      'INSERT INTO users (username, password_hash, company_id) VALUES (?, ?, ?)',
      ['admin', hash, 1]
    );
  }
  await masterDb.execute("UPDATE users SET company_id = 1 WHERE username = 'admin'").catch(() => {});

  // Benutzer: schneider → Firma 2
  const schnRes = await masterDb.execute("SELECT id FROM users WHERE username = 'schneider'");
  if (!schnRes.rows[0]) {
    const hash = bcrypt.hashSync('Schneiderei2024!', 10);
    await masterDb.execute(
      'INSERT INTO users (username, password_hash, company_id) VALUES (?, ?, ?)',
      ['schneider', hash, 2]
    );
  }
  await masterDb.execute("UPDATE users SET company_id = 2 WHERE username = 'schneider'").catch(() => {});

  // Firma 1 DB (= masterDb) initialisieren + Seed-Daten
  await initCompanyDB(masterDb);

  const artRes = await masterDb.execute('SELECT COUNT(*) as count FROM articles');
  if (Number(artRes.rows[0].count) === 0) {
    await masterDb.executeMultiple(`
      INSERT INTO articles (name, unit_price) VALUES ('Fitnessbrot', 4.50);
      INSERT INTO articles (name, unit_price) VALUES ('Kürbiskernbrot', 4.20);
      INSERT INTO articles (name, unit_price) VALUES ('Humus+Quark', 35.00);
      INSERT INTO articles (name, unit_price) VALUES ('Sonnenblumenbrot', 4.90);
      INSERT INTO articles (name, unit_price) VALUES ('Krustenkönig', 5.20);
      INSERT INTO articles (name, unit_price) VALUES ('Dinkelkruste', 3.50);
    `);
  }
  const custRes = await masterDb.execute('SELECT COUNT(*) as count FROM customers');
  if (Number(custRes.rows[0].count) === 0) {
    await masterDb.execute(
      `INSERT INTO customers (name, billing_street, billing_zip, billing_city, delivery_contact, delivery_street, delivery_zip, delivery_city, cost_center)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['adesso SE', 'Adessoplatz 1', '44269', 'Dortmund', 'Charlotte Wieland',
       'Prinzenstrasse 34', '10969', 'Berlin', 'GS Berlin  1010102002']
    );
  }

  // Firma 2 DB (schneiderei) initialisieren — Fehler hier dürfen den Server nicht stoppen
  try {
    await initCompanyDB(getCompanyDb(2));
  } catch (err) {
    console.error('Schneiderei-DB konnte nicht initialisiert werden:', err.message);
  }
}

module.exports = { masterDb, db: masterDb, getCompanyDb, initDB };
