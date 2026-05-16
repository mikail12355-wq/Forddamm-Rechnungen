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
