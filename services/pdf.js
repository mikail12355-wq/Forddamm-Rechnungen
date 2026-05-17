const PDFDocument = require('pdfkit');

const EUR = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

const C = {
  dark:   '#2b1e0f',
  gold:   '#c8913a',
  mid:    '#6b4c2a',
  border: '#d4b896',
  gray:   '#9a8070',
  rowAlt: '#f9f5ef',
  white:  '#ffffff',
};

function generatePDF(invoice, items, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Rechnung Nr. ${invoice.invoice_number}` } });
  doc.pipe(stream);

  const W = 595.28, H = 841.89;
  const mL = 52, mR = 52;
  const cW = W - mL - mR;

  // ════════════════════════════════════════════════════════════════════════════
  // 1 · HEADER (kein Balken – nur Typografie)
  // ════════════════════════════════════════════════════════════════════════════
  let y = 44;

  // Firmenname links
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(18)
     .text('BÄCKEREI FORDDAMM', mL, y, { lineBreak: false });
  doc.fillColor(C.gold).font('Helvetica').fontSize(8)
     .text('Murat Öztürk  ·  Forddamm 13  ·  12107 Berlin', mL, y + 24, { lineBreak: false });

  // Rechnung-Nr. rechts
  doc.fillColor(C.gray).font('Helvetica').fontSize(8)
     .text('RECHNUNG', mL, y, { width: cW, align: 'right', lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(22)
     .text(`Nr. ${invoice.invoice_number}`, mL, y + 14, { width: cW, align: 'right', lineBreak: false });

  y += 50;

  // Dünne Goldlinie als Trenner
  doc.rect(mL, y, cW, 1.5).fill(C.gold);
  y += 20;

  // ════════════════════════════════════════════════════════════════════════════
  // 2 · ADRESSEN
  // ════════════════════════════════════════════════════════════════════════════
  const c1 = mL, c2 = mL + cW * 0.44;

  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7)
     .text('RECHNUNGSADRESSE', c1, y, { lineBreak: false })
     .text('LIEFERADRESSE',    c2, y, { lineBreak: false });
  y += 12;

  const bill  = [invoice.customer_name, invoice.billing_street,
                 [invoice.billing_zip, invoice.billing_city].filter(Boolean).join(' ')].filter(Boolean);
  const deliv = [invoice.customer_name, invoice.delivery_contact, invoice.delivery_street,
                 [invoice.delivery_zip, invoice.delivery_city].filter(Boolean).join(' ')].filter(Boolean);

  const addrLines = Math.max(bill.length, deliv.length);
  doc.fontSize(9);
  for (let i = 0; i < addrLines; i++) {
    if (bill[i])  { doc.fillColor(i === 0 ? C.dark : C.mid).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').text(bill[i],  c1, y + i * 13, { width: cW * 0.42, lineBreak: false }); }
    if (deliv[i]) { doc.fillColor(i === 0 ? C.dark : C.mid).font(i === 0 ? 'Helvetica-Bold' : 'Helvetica').text(deliv[i], c2, y + i * 13, { width: cW * 0.44, lineBreak: false }); }
  }
  y += addrLines * 13 + 20;

  // ════════════════════════════════════════════════════════════════════════════
  // 3 · METADATEN-ZEILE
  // ════════════════════════════════════════════════════════════════════════════
  const meta = [];
  if (invoice.order_number)  meta.push(['BESTELLNR.', invoice.order_number]);
  if (invoice.cost_center)   meta.push(['KOSTENSTELLE', invoice.cost_center]);
  if (invoice.delivery_from) {
    const dl = invoice.delivery_to
      ? `${fmtDate(invoice.delivery_from)} – ${fmtDate(invoice.delivery_to)}`
      : fmtDate(invoice.delivery_from);
    meta.push(['LIEFERDATUM', dl]);
  }
  meta.push(['RECHNUNGSDATUM', fmtDate(invoice.date)]);

  // Heller Hintergrundstreifen für Meta
  doc.rect(mL, y - 6, cW, 34).fill('#f6f0e8');
  const mColW = cW / meta.length;
  meta.forEach(([label, val], i) => {
    const mx = mL + 10 + i * mColW;
    doc.fillColor(C.gray).font('Helvetica').fontSize(7).text(label, mx, y, { lineBreak: false });
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9).text(val, mx, y + 11, { lineBreak: false });
  });
  y += 40;

  // ════════════════════════════════════════════════════════════════════════════
  // 4 · TABELLE
  // ════════════════════════════════════════════════════════════════════════════
  const tA = mL;
  const tM = mL + 228;
  const tE = mL + 280;
  const tG = mL + 388;
  const tR = mL + cW;

  const rowH    = 21;
  const headerH = 22;

  // Tabellen-Header: nur unterstrichener Text, kein Balken
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7.5);
  doc.text('ARTIKEL',           tA,     y + 7,  { lineBreak: false });
  doc.text('MENGE',             tM,     y + 7,  { lineBreak: false });
  doc.text('EINZELPR. NETTO',   tE,     y + 7,  { lineBreak: false });
  doc.text('GESAMTPR. NETTO',   tG + 4, y + 7,  { width: tR - tG - 4, align: 'right', lineBreak: false });
  y += headerH;
  doc.rect(mL, y, cW, 1).fill(C.gold);
  y += 6;

  // Artikel-Zeilen
  let totalNetto = 0;
  items.forEach((item, idx) => {
    const rowTotal = Number(item.quantity) * Number(item.unit_price);
    totalNetto += rowTotal;

    if (idx % 2 !== 0) doc.rect(mL, y, cW, rowH).fill(C.rowAlt);

    doc.fillColor(C.dark).font('Helvetica').fontSize(9);
    doc.text(String(item.article_name),       tA,     y + 6, { width: tM - tA - 8,  lineBreak: false });
    doc.text(String(item.quantity),            tM,     y + 6, { width: tE - tM - 8,  lineBreak: false });
    doc.text(EUR(Number(item.unit_price)),      tE,     y + 6, { width: tG - tE - 8,  align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold');
    doc.text(EUR(rowTotal),                    tG + 4, y + 6, { width: tR - tG - 4,  align: 'right', lineBreak: false });
    y += rowH;
  });

  doc.rect(mL, y, cW, 1).fill(C.border);
  y += 18;

  // ════════════════════════════════════════════════════════════════════════════
  // 5 · SUMMEN
  // ════════════════════════════════════════════════════════════════════════════
  const ust         = totalNetto * 0.07;
  const totalBrutto = totalNetto + ust;
  const sumX        = tE;
  const sumValX     = tG;
  const sumValW     = tR - tG - 4;

  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text('Gesamtbetrag netto', sumX, y, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text(EUR(totalNetto), sumValX, y, { width: sumValW, align: 'right', lineBreak: false });
  y += 17;

  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text('+ 7 % USt', sumX, y, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text(EUR(ust), sumValX, y, { width: sumValW, align: 'right', lineBreak: false });
  y += 14;

  doc.rect(sumX, y, tR - sumX, 1).fill(C.border);
  y += 10;

  // Brutto: Goldener Akzentstreifen links, kein dunkler Kasten
  doc.rect(sumX - 6, y - 2, 3, 26).fill(C.gold);
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9)
     .text('Gesamtbetrag brutto', sumX + 4, y + 1, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(15)
     .text(EUR(totalBrutto), sumValX, y - 2, { width: sumValW, align: 'right', lineBreak: false });
  y += 38;

  // ════════════════════════════════════════════════════════════════════════════
  // 6 · ZAHLUNG
  // ════════════════════════════════════════════════════════════════════════════
  doc.rect(mL, y, cW, 1).fill(C.border);
  y += 14;

  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7.5)
     .text('ZAHLUNGSINFORMATIONEN', mL, y, { lineBreak: false });
  y += 13;

  const p1 = mL, p2 = mL + 200, p3 = mL + 355;

  doc.fillColor(C.gray).font('Helvetica').fontSize(7);
  doc.text('IBAN',         p1, y, { lineBreak: false });
  doc.text('BIC',          p2, y, { lineBreak: false });
  doc.text('ZAHLUNGSART',  p3, y, { lineBreak: false });
  y += 11;

  doc.fillColor(C.dark).font('Helvetica').fontSize(9);
  doc.text('DE67 1005 0000 0191 3708 27', p1, y, { lineBreak: false });
  doc.text('BELADEBXXX',                  p2, y, { lineBreak: false });
  doc.text('Überweisung',                 p3, y, { lineBreak: false });
  y += 15;

  doc.fillColor(C.gray).font('Helvetica').fontSize(7).text('KONTOINHABER', p1, y, { lineBreak: false });
  y += 11;
  doc.fillColor(C.dark).font('Helvetica').fontSize(9).text('Murat Öztürk', p1, y, { lineBreak: false });

  // ════════════════════════════════════════════════════════════════════════════
  // 7 · FOOTER (kein Balken – nur kleiner Text)
  // ════════════════════════════════════════════════════════════════════════════
  doc.rect(mL, H - 40, cW, 1).fill(C.border);
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5)
     .text('SteuerNr. 20/460/01995', mL, H - 26, { lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5)
     .text('Bäckerei & Café Forddamm  ·  Forddamm 13, 12107 Berlin', mL, H - 26, { width: cW, align: 'right', lineBreak: false });

  doc.end();
}

module.exports = generatePDF;
