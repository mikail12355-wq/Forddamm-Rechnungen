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
};

// Layout-Konstanten
const W = 595.28, H = 841.89;
const mL = 52, mR = 52;
const cW = W - mL - mR;          // 491.28

// Tabellenspalten
const tA = mL;                    // Artikel         52
const tM = mL + 228;              // Menge           280
const tE = mL + 280;              // Einzelpreis     332
const tG = mL + 388;              // Gesamtpreis     440
const tR = mL + cW;               // rechter Rand    543.28

const ROW_H         = 21;
const PAGE_BOTTOM   = H - 44;     // unterste Schreibgrenze (Footer ab H-40)
const TOTALS_SPACE  = 165;        // Platz für Summen + Zahlungsinfos

// ─── Seitenfuss (jede Seite) ──────────────────────────────────────────────
function drawFooter(doc) {
  doc.rect(mL, H - 40, cW, 1).fill(C.border);
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5)
     .text('SteuerNr. 20/460/01995', mL, H - 26, { lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(7.5)
     .text('Bäckerei & Café Forddamm  ·  Forddamm 13, 12107 Berlin', mL, H - 26,
           { width: cW, align: 'right', lineBreak: false });
}

// ─── Kopfzeile Folgeseiten ────────────────────────────────────────────────
function drawContinuationHeader(doc, invoice) {
  const y0 = 36;
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(11)
     .text('BÄCKEREI FORDDAMM', mL, y0, { lineBreak: false });
  doc.fillColor(C.gray).font('Helvetica').fontSize(8.5)
     .text(`Rechnung Nr. ${invoice.invoice_number}  ·  Fortsetzung`,
           mL, y0, { width: cW, align: 'right', lineBreak: false });
  const lineY = y0 + 19;
  doc.rect(mL, lineY, cW, 1.5).fill(C.gold);
  return lineY + 16;
}

// ─── Tabellenkopf ────────────────────────────────────────────────────────
function drawTableHeader(doc, y) {
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7.5);
  doc.text('ARTIKEL',          tA,     y + 7, { lineBreak: false });
  doc.text('MENGE',            tM,     y + 7, { lineBreak: false });
  doc.text('EINZELPR. NETTO',  tE,     y + 7, { lineBreak: false });
  doc.text('GESAMTPR. NETTO',  tG + 4, y + 7,
           { width: tR - tG - 4, align: 'right', lineBreak: false });
  const lineY = y + 22;
  doc.rect(mL, lineY, cW, 1).fill(C.gold);
  return lineY + 6;
}

// ─── Hauptfunktion ───────────────────────────────────────────────────────
function generatePDF(invoice, items, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Rechnung Nr. ${invoice.invoice_number}` } });
  doc.pipe(stream);

  let y = 44;

  // ════ SEITE 1: HEADER ════════════════════════════════════════════════════
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(18)
     .text('BÄCKEREI FORDDAMM', mL, y, { lineBreak: false });
  doc.fillColor(C.gold).font('Helvetica').fontSize(8)
     .text('Murat Öztürk  ·  Forddamm 13  ·  12107 Berlin', mL, y + 24, { lineBreak: false });

  doc.fillColor(C.gray).font('Helvetica').fontSize(8)
     .text('RECHNUNG', mL, y, { width: cW, align: 'right', lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(22)
     .text(`Nr. ${invoice.invoice_number}`, mL, y + 14, { width: cW, align: 'right', lineBreak: false });

  y += 50;
  doc.rect(mL, y, cW, 1.5).fill(C.gold);
  y += 20;

  // ════ ADRESSEN ═══════════════════════════════════════════════════════════
  const c1 = mL, c2 = mL + cW * 0.44;
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7)
     .text('RECHNUNGSADRESSE', c1, y, { lineBreak: false })
     .text('LIEFERADRESSE',    c2, y, { lineBreak: false });
  y += 12;

  const bill  = [invoice.billing_name || invoice.customer_name, invoice.billing_street,
                 [invoice.billing_zip, invoice.billing_city].filter(Boolean).join(' ')].filter(Boolean);
  const deliv = [invoice.delivery_name || invoice.customer_name, invoice.delivery_contact, invoice.delivery_street,
                 [invoice.delivery_zip, invoice.delivery_city].filter(Boolean).join(' ')].filter(Boolean);

  const renderAddrCol = (lines, x, width) => {
    let cy = y;
    lines.forEach((line, i) => {
      const bold = i === 0;
      doc.fillColor(bold ? C.dark : C.mid)
         .font(bold ? 'Helvetica-Bold' : 'Helvetica')
         .fontSize(9)
         .text(line, x, cy, { width });
      cy = doc.y + 2;
    });
    return cy;
  };

  const billEnd  = renderAddrCol(bill,  c1, cW * 0.42);
  const delivEnd = renderAddrCol(deliv, c2, cW * 0.44);
  y = Math.max(billEnd, delivEnd) + 20;

  // ════ META ═══════════════════════════════════════════════════════════════
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

  doc.rect(mL, y - 6, cW, 34).fill('#f6f0e8');
  const mColW = cW / meta.length;
  meta.forEach(([label, val], i) => {
    const mx = mL + 10 + i * mColW;
    doc.fillColor(C.gray).font('Helvetica').fontSize(7).text(label, mx, y, { lineBreak: false });
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9).text(val,   mx, y + 11, { lineBreak: false });
  });
  y += 40;

  // ════ TABELLE ════════════════════════════════════════════════════════════
  y = drawTableHeader(doc, y);

  let totalNetto = 0;

  items.forEach((item, idx) => {
    // Seitenumbruch bei Bedarf
    if (y + ROW_H > PAGE_BOTTOM) {
      drawFooter(doc);
      doc.addPage();
      y = drawContinuationHeader(doc, invoice);
      y = drawTableHeader(doc, y);
    }

    const rowTotal = Number(item.quantity) * Number(item.unit_price);
    totalNetto += rowTotal;

    if (idx % 2 !== 0) doc.rect(mL, y, cW, ROW_H).fill(C.rowAlt);

    doc.fillColor(C.dark).font('Helvetica').fontSize(9);
    doc.text(String(item.article_name),     tA,     y + 6, { width: tM - tA - 8,  lineBreak: false });
    doc.text(String(item.quantity),          tM,     y + 6, { width: tE - tM - 8,  lineBreak: false });
    doc.text(EUR(Number(item.unit_price)),    tE,     y + 6, { width: tG - tE - 8,  align: 'right', lineBreak: false });
    doc.font('Helvetica-Bold');
    doc.text(EUR(rowTotal),                  tG + 4, y + 6, { width: tR - tG - 4,  align: 'right', lineBreak: false });
    y += ROW_H;
  });

  // Untere Tabellenlinie
  doc.rect(mL, y, cW, 1).fill(C.border);
  y += 18;

  // ════ SUMMEN – ggf. neue Seite ══════════════════════════════════════════
  if (y + TOTALS_SPACE > PAGE_BOTTOM) {
    drawFooter(doc);
    doc.addPage();
    y = drawContinuationHeader(doc, invoice);
  }

  const ust         = totalNetto * 0.07;
  const totalBrutto = totalNetto + ust;
  const sumValX     = tG;
  const sumValW     = tR - tG - 4;

  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text('Gesamtbetrag netto', tE, y, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text(EUR(totalNetto), sumValX, y, { width: sumValW, align: 'right', lineBreak: false });
  y += 17;

  doc.fillColor(C.gray).font('Helvetica').fontSize(9)
     .text('+ 7 % USt', tE, y, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica').fontSize(9)
     .text(EUR(ust), sumValX, y, { width: sumValW, align: 'right', lineBreak: false });
  y += 14;

  doc.rect(tE, y, tR - tE, 1).fill(C.border);
  y += 10;

  // Brutto mit goldenem Akzentstreifen
  doc.rect(tE - 6, y - 2, 3, 26).fill(C.gold);
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9)
     .text('Gesamtbetrag brutto', tE + 4, y + 1, { lineBreak: false });
  doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(15)
     .text(EUR(totalBrutto), sumValX, y - 2, { width: sumValW, align: 'right', lineBreak: false });
  y += 38;

  // ════ ZAHLUNGSINFORMATIONEN ═══════════════════════════════════════════════
  doc.rect(mL, y, cW, 1).fill(C.border);
  y += 14;

  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(7.5)
     .text('ZAHLUNGSINFORMATIONEN', mL, y, { lineBreak: false });
  y += 13;

  if (invoice.payment_method === 'cash') {
    doc.fillColor(C.gray).font('Helvetica').fontSize(7).text('ZAHLUNGSART', mL, y, { lineBreak: false });
    y += 11;
    doc.fillColor(C.dark).font('Helvetica-Bold').fontSize(9).text('Barzahlung', mL, y, { lineBreak: false });
  } else {
    const p1 = mL, p2 = mL + 200, p3 = mL + 355;
    doc.fillColor(C.gray).font('Helvetica').fontSize(7);
    doc.text('IBAN',        p1, y, { lineBreak: false });
    doc.text('BIC',         p2, y, { lineBreak: false });
    doc.text('ZAHLUNGSART', p3, y, { lineBreak: false });
    y += 11;
    doc.fillColor(C.dark).font('Helvetica').fontSize(9);
    doc.text('DE67 1005 0000 0191 3708 27', p1, y, { lineBreak: false });
    doc.text('BELADEBXXX',                  p2, y, { lineBreak: false });
    doc.text('Überweisung',                 p3, y, { lineBreak: false });
    y += 15;
    doc.fillColor(C.gray).font('Helvetica').fontSize(7).text('KONTOINHABER', p1, y, { lineBreak: false });
    y += 11;
    doc.fillColor(C.dark).font('Helvetica').fontSize(9).text('Murat Öztürk', p1, y, { lineBreak: false });
  }

  // Seitenfuss letzte Seite
  drawFooter(doc);

  doc.end();
}

module.exports = generatePDF;
