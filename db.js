require('dotenv').config();
const { createClient } = require('@libsql/client');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const url = process.env.TURSO_URL || (() => {
  const dir = path.dirname(process.env.DB_PATH || path.join(__dirname, 'data', 'forddamm.db'));
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return `file:${process.env.DB_PATH || path.join(__dirname, 'data', 'forddamm.db')}`;
})();

const db = createClient({
  url,
  authToken: process.env.TURSO_AUTH_TOKEN
});

async function initDB() {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
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

  // Migration: product aliases (canonical names across suppliers)
  await db.execute("CREATE TABLE IF NOT EXISTS product_aliases (product_name TEXT PRIMARY KEY, canonical_name TEXT NOT NULL)").catch(() => {});
  // Migration: line_total for purchase_items (exact printed amount from invoice)
  await db.execute("ALTER TABLE purchase_items ADD COLUMN line_total REAL").catch(() => {});
  // Migration: category for purchase_items
  await db.execute("ALTER TABLE purchase_items ADD COLUMN category TEXT DEFAULT 'Sonstiges'").catch(() => {});
  // Migration: delivery_contact moved from customers to invoices
  await db.execute("ALTER TABLE invoices ADD COLUMN delivery_contact TEXT DEFAULT ''").catch(() => {});
  // Migration: cost_center moved from customers to invoices (per-invoice entry)
  await db.execute("ALTER TABLE invoices ADD COLUMN cost_center TEXT DEFAULT ''").catch(() => {});
  // Migration: payment method (transfer = Überweisung, cash = Barzahlung)
  await db.execute("ALTER TABLE invoices ADD COLUMN payment_method TEXT DEFAULT 'transfer'").catch(() => {});
  // Migration: payment tracking
  await db.execute("ALTER TABLE invoices ADD COLUMN paid INTEGER DEFAULT 0").catch(() => {});
  await db.execute("ALTER TABLE invoices ADD COLUMN paid_at TEXT DEFAULT ''").catch(() => {});

  // Migration: daily cash register (Tageskasse)
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

  // Migration: VAT breakdown columns for Tageskasse
  await db.execute("ALTER TABLE daily_cash ADD COLUMN revenue_7  REAL NOT NULL DEFAULT 0").catch(() => {});
  await db.execute("ALTER TABLE daily_cash ADD COLUMN revenue_19 REAL NOT NULL DEFAULT 0").catch(() => {});

  // Migration: Mitarbeiter (anonyme Kürzel, DSGVO-konform)
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mitarbeiter (
      id    TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      type  TEXT NOT NULL
    )
  `).catch(() => {});

  // Migration: Mitarbeiter-Kosten pro Monat
  await db.execute(`
    CREATE TABLE IF NOT EXISTS mitarbeiter_kosten (
      monat TEXT NOT NULL,
      ma_id TEXT NOT NULL,
      betrag REAL NOT NULL DEFAULT 0,
      PRIMARY KEY (monat, ma_id)
    )
  `).catch(() => {});

  // Migration: Standard-Monatsgehalt pro Mitarbeiter
  await db.execute("ALTER TABLE mitarbeiter ADD COLUMN gehalt REAL DEFAULT 0").catch(() => {});

  // Indexes for JOIN and ORDER BY performance
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
  `);

  const adminRes = await db.execute('SELECT id FROM users WHERE username = ?', ['admin']);
  if (!adminRes.rows[0]) {
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Forddamm2024!', 10);
    await db.execute('INSERT INTO users (username, password_hash) VALUES (?, ?)', ['admin', hash]);
  }

  const artRes = await db.execute('SELECT COUNT(*) as count FROM articles');
  if (Number(artRes.rows[0].count) === 0) {
    await db.executeMultiple(`
      INSERT INTO articles (name, unit_price) VALUES ('Fitnessbrot', 4.50);
      INSERT INTO articles (name, unit_price) VALUES ('Kürbiskernbrot', 4.20);
      INSERT INTO articles (name, unit_price) VALUES ('Humus+Quark', 35.00);
      INSERT INTO articles (name, unit_price) VALUES ('Sonnenblumenbrot', 4.90);
      INSERT INTO articles (name, unit_price) VALUES ('Krustenkönig', 5.20);
      INSERT INTO articles (name, unit_price) VALUES ('Dinkelkruste', 3.50);
    `);
  }

  const custRes = await db.execute('SELECT COUNT(*) as count FROM customers');
  if (Number(custRes.rows[0].count) === 0) {
    await db.execute(
      `INSERT INTO customers (name, billing_street, billing_zip, billing_city, delivery_contact, delivery_street, delivery_zip, delivery_city, cost_center)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ['adesso SE', 'Adessoplatz 1', '44269', 'Dortmund', 'Charlotte Wieland', 'Prinzenstrasse 34', '10969', 'Berlin', 'GS Berlin  1010102002']
    );
  }
}

module.exports = { db, initDB };
