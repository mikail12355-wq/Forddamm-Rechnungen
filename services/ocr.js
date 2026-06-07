const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const pdfParse = require('pdf-parse');

const CATEGORIES = [
  'Backzutaten',
  'Brötchen & Gebäck',
  'Brot & Backwaren',
  'Wurst & Fleisch',
  'Käse & Milchprodukte',
  'Tiefkühlware',
  'Getränke',
  'Saucen & Gewürze',
  'Dienstleistungen',
  'Sonstiges'
];

const EXTRACT_PROMPT = `Du analysierst eine Eingangsrechnung (Lieferantenrechnung) einer Bäckerei.

Extrahiere folgende Daten und gib sie als JSON zurück:
- supplier_name: Name des Lieferanten (Firmenname des Absenders)
- invoice_number: Rechnungsnummer als Text (oder null)
- date: Rechnungsdatum im Format YYYY-MM-DD (oder null)
- items: Array ALLER Produktpositionen mit:
  - product_name: Produkt-/Artikelname (vollständig)
  - quantity: Bestellmenge als Zahl
  - unit: Einheit direkt aus der Rechnung (z.B. Stk., KG, Blech, l)
  - unit_price: Netto-Einzelpreis EXAKT wie gedruckt (Zahl ohne €)
  - line_total: Zeilenbetrag EXAKT wie gedruckt (Zahl, NICHT selbst ausrechnen)
  - category: eine aus: "Backzutaten", "Brötchen & Gebäck", "Brot & Backwaren",
    "Wurst & Fleisch", "Käse & Milchprodukte", "Tiefkühlware", "Getränke",
    "Saucen & Gewürze", "Dienstleistungen", "Sonstiges"

KATEGORIEN:
- Mehl, Zucker, Fette, Backpulver → "Backzutaten"
- Brötchen, Croissants, Laugengebäck, Stangen → "Brötchen & Gebäck"
- Brot, Schnecken, Kuchen, Torten, Pfannkuchen, Eclairs, Muffins, Plunder → "Brot & Backwaren"
- Wurst, Salami, Jagdwurst, Frikadellen, Chicken → "Wurst & Fleisch"
- Käse, Milch, Quark, Butter, Mozzarella → "Käse & Milchprodukte"
- Alles mit TK oder Tiefkühl → "Tiefkühlware"
- Saucen, Tomatencreme, Gewürze → "Saucen & Gewürze"
- Agio, Servicegebühren → "Dienstleistungen"

WICHTIG – Pfand weglassen:
Positionen wie "Pfand Bäckerkorb", "Pfand Kuchenblech" NICHT ins items-Array aufnehmen.

WICHTIG – Mengenspalte:
Wenn zwei Zahlen in der Mengenspalte stehen (z.B. "3,00 Stk. | 100"), ist die ERSTE die Bestellmenge.

WICHTIG – Keine Zusammenfassung:
Auch wenn dasselbe Produkt mehrmals auf der Rechnung vorkommt (z.B. in verschiedenen Lieferscheinen oder auf mehreren Seiten), liste JEDE Zeile als separaten Eintrag. Niemals gleichnamige Artikel zusammenfassen.

Gib NUR das JSON zurück, keine Erklärungen, kein Markdown.

Format:
{
  "supplier_name": "...",
  "invoice_number": "...",
  "date": "YYYY-MM-DD",
  "items": [
    {"product_name": "...", "quantity": 1, "unit": "Stk.", "unit_price": 2.24, "line_total": 2.24, "category": "Brot & Backwaren"}
  ]
}`;

async function extractTextFromPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parsed = await pdfParse(buffer);
  return parsed.text || '';
}

async function extractInvoiceData(files) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY nicht konfiguriert.');
  }

  // Normalize: accept single {path, mimetype} object or array
  if (!Array.isArray(files)) files = [files];

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    generationConfig: { maxOutputTokens: 65536, temperature: 0.1 }
  });

  const parts = [];

  for (let i = 0; i < files.length; i++) {
    const { path: filePath, mimetype: mimeType } = files[i];
    const label = files.length > 1 ? `[Seite ${i + 1} von ${files.length}] ` : '';

    if (mimeType === 'application/pdf') {
      const pdfText = await extractTextFromPdf(filePath);
      console.log(`[OCR] ${label}PDF-Text extrahiert: ${pdfText.trim().length} Zeichen`);

      if (pdfText.trim().length < 100) {
        console.log(`[OCR] ${label}Gescanntes PDF → sende als Base64`);
        const base64Data = fs.readFileSync(filePath).toString('base64');
        parts.push({ inlineData: { mimeType: 'application/pdf', data: base64Data } });
      } else {
        console.log(`[OCR] ${label}Text-PDF → sende als Text`);
        parts.push({ text: `--- RECHNUNGSSEITE ${i + 1} (PDF-Text) ---\n${pdfText}` });
      }
    } else {
      const base64Data = fs.readFileSync(filePath).toString('base64');
      const allowed    = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const mediaType  = allowed.includes(mimeType) ? mimeType : 'image/jpeg';
      parts.push({ inlineData: { mimeType: mediaType, data: base64Data } });
    }
  }

  parts.push({ text: EXTRACT_PROMPT });

  console.log('[OCR] Sende Anfrage an Gemini (streaming)...');
  const streamResult = await model.generateContentStream(parts);
  let text = '';
  for await (const chunk of streamResult.stream) {
    text += chunk.text();
  }
  text = text.trim();
  console.log(`[OCR] Antwort erhalten: ${text.length} Zeichen`);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Keine strukturierten Daten erkannt');

  let data;
  try {
    data = JSON.parse(jsonMatch[0]);
  } catch {
    // Truncated JSON — salvage all complete item objects
    const raw        = jsonMatch[0];
    const itemsMatch = raw.match(/"items"\s*:\s*(\[[\s\S]*)/);
    if (!itemsMatch) throw new Error('JSON konnte nicht verarbeitet werden');

    let partial     = itemsMatch[1];
    const lastBrace = partial.lastIndexOf('}');
    if (lastBrace === -1) throw new Error('Keine vollständigen Positionen erkannt');
    partial         = partial.substring(0, lastBrace + 1) + ']';

    const headerMatch = raw.match(/^\s*\{([\s\S]*?)"items"/);
    const header      = headerMatch
      ? '{' + headerMatch[1] + '"items":'
      : '{"supplier_name":null,"invoice_number":null,"date":null,"items":';
    data = JSON.parse(header + partial + '}');
  }

  // Normalize
  if (Array.isArray(data.items)) {
    data.items = data.items.map(item => {
      const qty       = parseFloat(item.quantity)   || 1;
      const unitPrice = parseFloat(item.unit_price) || 0;
      const lineTotal = parseFloat(item.line_total);
      const category  = CATEGORIES.includes(item.category) ? item.category : 'Sonstiges';
      return {
        product_name: String(item.product_name || '').trim(),
        quantity:     qty,
        unit:         String(item.unit || 'Stk.').trim(),
        unit_price:   unitPrice,
        line_total:   isNaN(lineTotal) ? null : lineTotal,
        category
      };
    }).filter(item => item.product_name);
  } else {
    data.items = [];
  }

  console.log(`[OCR] Extrahierte Positionen nach Bereinigung: ${data.items.length}`);
  return data;
}

module.exports = { extractInvoiceData, CATEGORIES };
