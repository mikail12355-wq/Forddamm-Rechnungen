const PDFDocument = require('pdfkit');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const EUR = (n) => Number(n).toFixed(2).replace('.', ',') + ' €';
const fmtDate = (s) => s ? new Date(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '';

// ─── Brand colours ────────────────────────────────────────────────────────────
const C = {
  dark:   '#2b1e0f',
  gold:   '#c8913a',
  mid:    '#6b4c2a',
  warm:   '#f5e9d3',
  cream:  '#fdf6ec',
  border: '#d4b896',
  gray:   '#9a8070',
  white:  '#ffffff',
  rowAlt: '#faf5ee',
};

function generatePDF(invoice, items, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Rechnung Nr. ${invoice.invoice_number}` } });
  doc.pipe(stream);

  const W = 595.28, H = 841.89;
  const mL = 48, mR = 48;
  const cW = W - mL - mR;

  // ════════════════════════════════════════════════════════════════════════════
  // 1 · HEADER BAR
  // ════════════════════════════════════════════════════════════════════════════
  doc.rect(0, 0, W, 88).fill(C.dark);

  // Firmenname
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(21)
     .text('BÄCKEREI FORDDAMM', mL, 20, { lineBreak: false });
  doc.fillColor(C.gold).font('Helvetica').fontSize(8.5)
     .text('Murat Öztürk  ·  Forddamm 13  ·  12107 Berlin', mL, 47, { lineBreak: false });

  // Rechnung-Label & Nummer (rechts)
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(8)
     .text('RECHNUNG', mL, 20, { width: cW, align: 'right', lineBreak: false });
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(26)
     .text(`Nr. ${invoice.invoice_number}`, mL, 34, { width: cW, align: 'right', lineBreak: false });

  // ════════════════════════════════════════════════════════════════════════════
  // 2 · ADRESSEN
  // ════════════════════════════════════════════════════════════════════════════
  let y = 108;
  const c1 = mL, c2 = mL + cW * 0.44;

  // Labels
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7)
     .text('RECHNUNGSADRESSE', c1, y, { lineBreak: false })
     .text('LIEFERADRESSE',    c2, y, { lineBreak: false });
  y += 13;

  const bill  = [invoice.customer_name, invoice.billing_street,
                 [invoice.billing_zip, invoice.billing_city].filter(Boolean).join(' ')].filter(Boolean);
  const deliv = [invoice.customer_name, invoice.delivery_contact, invoice.delivery_street,
                 [invoice.delivery_zip, invoice.delivery_city].filter(Boolean).join(' ')].filter(Boolean);

  const addrLines = Math.max(bill.length, deliv.length);
  doc.font('Helvetica').fontSize(9);
  for (let i = 0; i < addrLines; i++) {
    if (bill[i])  { doc.fillColor(i === 0 ? C.dark : C.mid).text(bill[i],  c1, y + i * 13, { width: cW * 0.42, lineBreak: false }); }
    if (deliv[i]) { doc.fillColor(i === 0 ? C.dark : C.mid).text(deliv[i], c2, y + i * 13, { width: cW * 0.40, lineBreak: false }); }
  }
  y += addrLines * 13 + 14;

  // ════════════════════════════════════════════════════════════════════════════
  // 3 · GOLDENE TRENNLINIE
  // ════════════════════════════════════════════════════════════════════════════
  doc.rect(mL, y, cW, 2).fill(C.gold);
  y += 12;

  // ════════════════════════════════════════════════════════════════════════════
  // 4 · METADATEN-ZEILE
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

  const mColW = cW / meta.length;
  meta.forEach(([label, val], i) => {
    const mx = mL + i * mColW;
    doc.fillColor(C.gray).font('Helvetica').fontSize(7).text(label, mx, y, { lineBreak: false });
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9).text(val, mx, y + 11, { lineBreak: false });
  });
  y += 34;

  // ════════════════════════════════════════════════════════════════════════════
  // 5 · TABELLE
  // ════════════════════════════════════════════════════════════════════════════
  const tA = mL;           // Artikel       x = 48
  const tM = mL + 230;     // Menge         x = 278
  const tE = mL + 280;     // Einzelpreis   x = 328
  const tG = mL + 385;     // Gesamtpreis   x = 433
  const tR = mL + cW;      // rechts        x = 547

  const rowH    = 21;
  const headerH = 24;

  // Tabellen-Header
  doc.rect(mL, y, cW, headerH).fill(C.dark);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7.5);
  doc.text('ARTIKEL',           tA + 8, y + 8, { lineBreak: false });
  doc.text('MENGE',             tM + 4, y + 8, { lineBreak: false });
  doc.text('EINZELPR. NETTO',   tE + 4, y + 8, { lineBreak: false });
  doc.text('GESAMTPR. NETTO',   tG + 4, y + 8, { width: tR - tG - 8, align: 'right', lineBreak: false });
  y += headerH;

  // Artikel-Zeilen
  let totalNetto = 0;
  items.forEach((item, idx) => {
    const rowTotal = Number(item.quantity) * Number(item.unit_price);
    totalNetto += rowTotal;

    doc.rect(mL, y, cW, rowH).fill(idx % 2 === 0 ? C.white : C.rowAlt);

    doc.fillColor(C.dark).font('Helvetica').fontSize(9);
    doc.text(String(item.article_name),        tA + 8, y + 6, { width: tM - tA - 12, lineBreak: false });
    doc.text(String(item.quantity),             tM + 4, y + 6, { width: tE - tM - 8,  lineBreak: false });
    doc.text(EUR(Number(item.unit_price)),       tE + 4, y + 6, { width: tG - tE - 8,  align: 'right', lineBreak: false });
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9);
    doc.text(EUR(rowTotal),                     tG + 4, y + 6, { width: tR - tG - 8,  align: 'right', lineBreak: false });
    y += rowH;
  });

  // Untere Tabellenlinie
  doc.rect(mL, y, cW, 1.5).fill(C.gold);
  y += 16;

  // ════════════════════════════════════════════════════════════════════════════
  // 6 · SUMMEN (rechtsbündig)
  // ════════════════════════════════════════════════════════════════════════════
  const ust         = totalNetto * 0.07;
  const totalBrutto = totalNetto + ust;
  const sumX        = tE;
  const sumValX     = tG;
  const sumValW     = tR - tG - 8;

  // Netto
  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text('Gesamtbetrag netto', sumX, y, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text(EUR(totalNetto), sumValX, y, { width: sumValW, align: 'right', lineBreak: false });
  y += 17;

  // USt
  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text('+ 7 % USt', sumX, y, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text(EUR(ust), sumValX, y, { width: sumValW, align: 'right', lineBreak: false });
  y += 14;

  // Trennstrich vor Brutto
  doc.rect(sumX, y, tR - sumX, 1).fill(C.border);
  y += 8;

  // Brutto-Box
  doc.rect(sumX - 6, y - 4, tR - sumX + 6, 30).fill(C.dark);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(8.5)
     .text('GESAMTBETRAG BRUTTO', sumX, y + 5, { lineBreak: false });
  doc.fillColor(C.white).font('Helvetica-Bold').fontSize(13)
     .text(EUR(totalBrutto), sumValX, y + 3, { width: sumValW, align: 'right', lineBreak: false });
  y += 42;

  // ════════════════════════════════════════════════════════════════════════════
  // 7 · ZAHLUNG
  // ════════════════════════════════════════════════════════════════════════════
  doc.rect(mL, y, cW, 1).fill(C.border);
  y += 14;

  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7.5)
     .text('ZAHLUNGSINFORMATIONEN', mL, y, { lineBreak: false });
  y += 14;

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

  doc.fillColor(C.gray).font('Helvetica').fontSize(7)
     .text('KONTOINHABER', p1, y, { lineBreak: false });
  y += 11;
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text('Murat Öztürk', p1, y, { lineBreak: false });

  // ════════════════════════════════════════════════════════════════════════════
  // 8 · FOOTER BAR
  // ════════════════════════════════════════════════════════════════════════════
  doc.rect(0, H - 34, W, 34).fill(C.dark);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(8)
     .text('SteuerNr. 20/460/01995', mL, H - 21, { lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5)
     .text('Bäckerei & Café Forddamm  ·  Forddamm 13, 12107 Berlin', mL, H - 21, { width: cW, align: 'right', lineBreak: false });

  doc.end();
}

module.exports = generatePDF;
