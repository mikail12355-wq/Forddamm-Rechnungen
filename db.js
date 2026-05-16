require('dotenv').config();
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'forddamm.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
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

// Seed admin user
const adminUser = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
if (!adminUser) {
  const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Forddamm2024!', 10);
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run('admin', hash);
}

// Seed default articles
const articleCount = db.prepare('SELECT COUNT(*) as count FROM articles').get();
if (articleCount.count === 0) {
  const ins = db.prepare('INSERT INTO articles (name, unit_price) VALUES (?, ?)');
  ins.run('Fitnessbrot', 4.50);
  ins.run('Kürbiskernbrot', 4.20);
  ins.run('Humus+Quark', 35.00);
  ins.run('Sonnenblumenbrot', 4.90);
  ins.run('Krustenkönig', 5.20);
  ins.run('Dinkelkruste', 3.50);
}

// Seed adesso as demo customer
const customerCount = db.prepare('SELECT COUNT(*) as count FROM customers').get();
if (customerCount.count === 0) {
  db.prepare(`INSERT INTO customers
    (name, billing_street, billing_zip, billing_city, delivery_contact, delivery_street, delivery_zip, delivery_city, cost_center)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'adesso SE', 'Adessoplatz 1', '44269', 'Dortmund',
    'Charlotte Wieland', 'Prinzenstrasse 34', '10969', 'Berlin',
    'GS Berlin  1010102002'
  );
}

module.exports = db;
