const PDFDocument = require('pdfkit');

const EUR = (n) => n.toFixed(2).replace('.', ',') + ' €';

const fmtDate = (dateStr) => {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

function generatePDF(invoice, items, stream) {
  const doc = new PDFDocument({ size: 'A4', margin: 0, info: { Title: `Rechnung Nr. ${invoice.invoice_number}` } });
  doc.pipe(stream);

  const W = 595.28;
  const mL = 50, mR = 50;
  const cW = W - mL - mR; // 495.28

  // ── HEADER ─────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(22)
     .text('Bäckerei Forddamm', mL, 45, { width: cW, align: 'right' });
  doc.font('Helvetica').fontSize(9)
     .text('Murat Öztürk',  mL, 74,  { width: cW, align: 'right' })
     .text('Forddamm 13',   mL, 85,  { width: cW, align: 'right' })
     .text('12107 Berlin',  mL, 96,  { width: cW, align: 'right' });

  // ── ADDRESS BLOCK ──────────────────────────────────────────────────────────
  let y = 120;
  const c1 = mL, c2 = mL + cW * 0.40, c3 = mL + cW * 0.73;

  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Rechnungsadresse:', c1, y);
  doc.text('Lieferadresse:', c2, y);
  if (invoice.order_number) doc.text(`Bestellung: ${invoice.order_number}`, c3, y);

  y += 14;
  doc.font('Helvetica').fontSize(9);

  const bill = [
    'An',
    invoice.customer_name || '',
    invoice.billing_street || '',
    [invoice.billing_zip, invoice.billing_city].filter(Boolean).join(' ')
  ].filter(Boolean);

  const deliv = [
    'An',
    invoice.customer_name || '',
    invoice.delivery_contact || '',
    invoice.delivery_street || '',
    [invoice.delivery_zip, invoice.delivery_city].filter(Boolean).join(' ')
  ].filter(Boolean);

  const maxLines = Math.max(bill.length, deliv.length);
  for (let i = 0; i < maxLines; i++) {
    if (bill[i])  doc.text(bill[i],  c1, y + i * 13, { width: cW * 0.38 });
    if (deliv[i]) doc.text(deliv[i], c2, y + i * 13, { width: cW * 0.32 });
  }
  y += maxLines * 13 + 12;

  // ── KOSTENSTELLE ──────────────────────────────────────────────────────────
  if (invoice.cost_center) {
    doc.font('Helvetica-Bold').fontSize(10)
       .text(`KostenstelleNr.${invoice.cost_center}`, c1, y, { underline: true, width: cW });
    y += 18;
  }

  // ── LIEFERDATUM ───────────────────────────────────────────────────────────
  y += 4;
  doc.font('Helvetica').fontSize(9).text('Lieferdatum:', c2, y);
  y += 12;
  if (invoice.delivery_from || invoice.delivery_to) {
    const delivText = invoice.delivery_from && invoice.delivery_to
      ? `${fmtDate(invoice.delivery_from)}-${fmtDate(invoice.delivery_to)}`
      : fmtDate(invoice.delivery_from || invoice.delivery_to);
    doc.text(delivText, c2, y);
  }
  y += 20;

  // ── RECHNUNG NR. / DATUM ──────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(10)
     .text('Rechnung Nr.', c1, y)
     .text(String(invoice.invoice_number), c1 + 88, y);

  doc.font('Helvetica').fontSize(9)
     .text('Datum:', c3, y)
     .text(fmtDate(invoice.date), c3 + 42, y);
  y += 12;
  doc.text('Tag der Lieferung:', c3, y);
  if (invoice.delivery_from) doc.text(fmtDate(invoice.delivery_from), c3 + 100, y);
  y += 20;

  // ── TABLE ─────────────────────────────────────────────────────────────────
  // Column x positions
  const tA = mL;          // Artikel
  const tM = mL + 275;    // Menge
  const tE = mL + 335;    // Einzelpreis netto
  const tG = mL + 420;    // Gesamtpreis netto
  const tRight = mL + cW;

  const rowH = 17;
  const colWidths = { a: 275, m: 60, e: 85, g: 75 };

  const drawRowBorder = (rowY) => {
    doc.rect(tA, rowY, cW, rowH).stroke('#999');
    doc.moveTo(tM, rowY).lineTo(tM, rowY + rowH).stroke('#999');
    doc.moveTo(tE, rowY).lineTo(tE, rowY + rowH).stroke('#999');
    doc.moveTo(tG, rowY).lineTo(tG, rowY + rowH).stroke('#999');
  };

  // Header row
  drawRowBorder(y);
  doc.font('Helvetica-Bold').fontSize(8.5);
  doc.text('Artikel',            tA + 3, y + 4, { width: colWidths.a });
  doc.text('Menge',              tM + 3, y + 4, { width: colWidths.m });
  doc.text('Einzelpreis, netto', tE + 3, y + 4, { width: colWidths.e });
  doc.text('Gesamtpreis, netto', tG + 3, y + 4, { width: colWidths.g });
  y += rowH;

  // Item rows
  doc.font('Helvetica').fontSize(8.5);
  let totalNetto = 0;
  for (const item of items) {
    const rowTotal = item.quantity * item.unit_price;
    totalNetto += rowTotal;
    drawRowBorder(y);
    doc.text(item.article_name,       tA + 3, y + 4, { width: colWidths.a });
    doc.text(String(item.quantity),   tM + 3, y + 4, { width: colWidths.m });
    doc.text(EUR(item.unit_price),    tE + 3, y + 4, { width: colWidths.e, align: 'right' });
    doc.text(EUR(rowTotal),           tG + 3, y + 4, { width: colWidths.g - 5, align: 'right' });
    y += rowH;
  }

  // 2 empty spacer rows
  for (let i = 0; i < 2; i++) { drawRowBorder(y); y += rowH; }

  // Total rows
  const ust = totalNetto * 0.07;
  const totalBrutto = totalNetto + ust;

  const totalRows = [
    { label: 'Gesamtbetrag, netto', value: EUR(totalNetto), bold: false },
    { label: '+ 7% USt',            value: EUR(ust),        bold: false },
    { label: 'Gesamtbetrag, brutto', value: EUR(totalBrutto), bold: true },
  ];

  for (const row of totalRows) {
    drawRowBorder(y);
    doc.font(row.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
    doc.text(row.label, tE + 3, y + 4, { width: colWidths.e });
    doc.text(row.value, tG + 3, y + 4, { width: colWidths.g - 5, align: 'right' });
    y += rowH;
  }

  y += 18;

  // ── PAYMENT INFO ──────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(9);
  doc.text('Bitte Überweisen Sie den gesamten Betrag bis zum', c1, y);
  y += 15;
  doc.text('auf folgendes Konto:', c1, y);

  const payX = c1 + 125;
  doc.text('BIC',      payX,      y); doc.text('BELADEBXXX',                  payX + 35, y);
  y += 13;
  doc.text('IBAN',     payX,      y); doc.text('DE67 1005 0000 0191 3708 27', payX + 35, y);
  y += 13;
  doc.text('Inhaber:', payX,      y); doc.text('Murat Öztürk',                payX + 50, y);
  y += 20;

  doc.font('Helvetica-Bold').fontSize(9).text('Zahlungsart:', c1, y);
  doc.font('Helvetica').text('Überweisung', c1 + 72, y);

  // ── FOOTER ────────────────────────────────────────────────────────────────
  doc.font('Helvetica').fontSize(8)
     .text('SteuerNr.20/460/01995', mL, 810, { width: cW, align: 'right' });

  doc.end();
}

module.exports = generatePDF;
