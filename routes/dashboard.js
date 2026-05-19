const express = require('express');
const router = express.Router();
const { db } = require('../db');

const MONTH_NAMES = ['Januar','Februar','März','April','Mai','Juni','Juli','August','September','Oktober','November','Dezember'];
const QUARTER_MONTHS = { 1: ['01','02','03'], 2: ['04','05','06'], 3: ['07','08','09'], 4: ['10','11','12'] };

// Gibt alle YYYY-MM Strings für einen Filterzeitraum zurück (null = alle)
function buildMonatsList(year, quarter, month) {
  if (!year || year === 'all') return null;
  if (month) return [`${year}-${String(month).padStart(2, '0')}`];
  const qm = quarter ? QUARTER_MONTHS[Number(quarter)] : ['01','02','03','04','05','06','07','08','09','10','11','12'];
  return (qm || []).map(m => `${year}-${m}`);
}

// Berechnet Mitarbeiterkosten korrekt:
// Für jeden Mitarbeiter gilt pro Monat: Override wenn vorhanden, sonst Standard-Gehalt
async function calcMaKosten(monats) {
  const [maRes, overridesRes] = await Promise.all([
    db.execute('SELECT id, gehalt FROM mitarbeiter'),
    monats
      ? db.execute(
          `SELECT ma_id, monat, betrag FROM mitarbeiter_kosten WHERE monat IN (${monats.map(() => '?').join(',')})`,
          monats
        )
      : db.execute('SELECT ma_id, monat, betrag FROM mitarbeiter_kosten'),
  ]);

  const employees = maRes.rows;
  if (employees.length === 0) return 0;

  const overrideMap = {};
  overridesRes.rows.forEach(r => { overrideMap[`${r.ma_id}:${r.monat}`] = r.betrag; });

  if (!monats) {
    // "Alle" – summe nur tatsächliche Override-Einträge (kein Gehalt-Fallback bei unbekannter Monatszahl)
    return overridesRes.rows.reduce((s, r) => s + r.betrag, 0);
  }

  let total = 0;
  for (const emp of employees) {
    for (const m of monats) {
      const key = `${emp.id}:${m}`;
      total += overrideMap[key] !== undefined ? overrideMap[key] : (emp.gehalt || 0);
    }
  }
  return total;
}

router.get('/', async (req, res) => {
  const { year, month, quarter } = req.query;

  let whereParts = [];
  let args = [];

  if (year && year !== 'all') {
    whereParts.push("strftime('%Y', i.date) = ?");
    args.push(String(year));

    if (month) {
      whereParts.push("strftime('%m', i.date) = ?");
      args.push(String(month).padStart(2, '0'));
    } else if (quarter) {
      const qm = QUARTER_MONTHS[Number(quarter)] || [];
      whereParts.push(`strftime('%m', i.date) IN (${qm.map(() => '?').join(',')})`);
      args.push(...qm);
    }
  }

  const where     = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const cashWhere = where.replace(/i\.date/g, 'date');
  const monats    = buildMonatsList(year, quarter, month);

  const [inv, cust, art, rev, latest, yearsRes, cashRes] = await Promise.all([
    db.execute(`SELECT COUNT(*) as count FROM invoices i ${where}`, args),
    db.execute('SELECT COUNT(*) as count FROM customers'),
    db.execute('SELECT COUNT(*) as count FROM articles WHERE active = 1'),
    db.execute(`SELECT COALESCE(SUM(ii.quantity * ii.unit_price), 0) as netto
                FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id ${where}`, args),
    db.execute(`
      SELECT i.id, i.invoice_number, i.date, c.name as customer_name,
        (SELECT SUM(ii.quantity * ii.unit_price) FROM invoice_items ii WHERE ii.invoice_id = i.id) as total_netto
      FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      ${where}
      ORDER BY i.invoice_number DESC LIMIT 20
    `, args),
    db.execute("SELECT DISTINCT strftime('%Y', date) as year FROM invoices WHERE date != '' ORDER BY year DESC"),
    db.execute(`SELECT COALESCE(SUM(revenue_7 + revenue_19), 0) as brutto FROM daily_cash ${cashWhere}`, args),
  ]);

  const maKosten = await calcMaKosten(monats);

  const activeYear    = year || 'all';
  const activeMonth   = month   ? Number(month)   : null;
  const activeQuarter = quarter ? Number(quarter) : null;

  let periodLabel = 'Gesamt';
  if (activeYear !== 'all') {
    if (activeMonth)        periodLabel = `${MONTH_NAMES[activeMonth - 1]} ${activeYear}`;
    else if (activeQuarter) periodLabel = `Q${activeQuarter} ${activeYear}`;
    else                    periodLabel = String(activeYear);
  }

  const liefNetto   = Number(rev.rows[0].netto)       || 0;
  const liefBrutto  = liefNetto * 1.07;
  const ladenBrutto = Number(cashRes.rows[0].brutto)  || 0;
  const gesamtEin   = liefBrutto + ladenBrutto;
  const gewinn      = gesamtEin - maKosten;

  res.render('dashboard', {
    title: 'Dashboard',
    stats: {
      invoices:  Number(inv.rows[0].count),
      customers: Number(cust.rows[0].count),
      articles:  Number(art.rows[0].count),
      revenue:   liefNetto,
    },
    latestInvoices: latest.rows,
    availableYears: yearsRes.rows.map(r => r.year).filter(Boolean),
    filter: { year: activeYear, month: activeMonth, quarter: activeQuarter },
    periodLabel,
    monthNames: ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'],
    uebersicht: { liefBrutto, ladenBrutto, gesamtEin, maKosten, gewinn },
  });
});

module.exports = router;
