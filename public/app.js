// ── Flash auto-dismiss ────────────────────────────────────────────────
document.querySelectorAll('.flash').forEach(el => {
  setTimeout(() => { el.style.transition = 'opacity 0.5s'; el.style.opacity = '0'; }, 4000);
});

// ── Customer select preview ───────────────────────────────────────────
const customerSelect = document.getElementById('customer-select');
const customerPreview = document.getElementById('customer-preview');

if (customerSelect) {
  const showPreview = () => {
    const opt = customerSelect.options[customerSelect.selectedIndex];
    if (!opt || !opt.value) { customerPreview.style.display = 'none'; return; }

    document.getElementById('preview-billing').textContent   = opt.dataset.billing   || '—';
    document.getElementById('preview-delivery').textContent  = opt.dataset.delivery  || '—';
    const cc = opt.dataset.costcenter;
    document.getElementById('preview-costcenter').textContent = cc || '—';
    document.getElementById('preview-costcenter-row').style.display = cc ? '' : 'none';
    customerPreview.style.display = 'flex';
  };
  customerSelect.addEventListener('change', showPreview);
  showPreview();
}

// ── Invoice items dynamic rows ────────────────────────────────────────
const container = document.getElementById('items-container');
const addRowBtn  = document.getElementById('add-row');

if (container && addRowBtn) {
  const formatEUR = (n) => isNaN(n) ? '—' : n.toFixed(2).replace('.', ',') + ' €';

  const updateTotals = () => {
    let netto = 0;
    container.querySelectorAll('.item-row').forEach(row => {
      const qty   = parseFloat(row.querySelector('.inp-qty').value)   || 0;
      const price = parseFloat(row.querySelector('.inp-price').value.replace(',', '.')) || 0;
      const total = qty * price;
      row.querySelector('.item-total').textContent = formatEUR(total);
      netto += total;
    });
    const ust    = netto * 0.07;
    const brutto = netto + ust;
    document.getElementById('total-netto').textContent  = formatEUR(netto);
    document.getElementById('total-ust').textContent    = formatEUR(ust);
    document.getElementById('total-brutto').textContent = formatEUR(brutto);
  };

  const buildArticleOptions = (selectedName) => {
    let html = '<option value="">— Artikel wählen —</option>';
    if (typeof ARTICLES !== 'undefined') {
      ARTICLES.forEach(a => {
        const sel = a.name === selectedName ? 'selected' : '';
        html += `<option value="${a.name}" data-price="${a.unit_price}" ${sel}>${a.name}</option>`;
      });
    }
    html += '<option value="__custom__">Eigener Artikel …</option>';
    return html;
  };

  const addRow = (name = '', qty = 1, price = '') => {
    const row = document.createElement('div');
    row.className = 'item-row';

    const priceFormatted = price !== '' ? parseFloat(price).toFixed(2).replace('.', ',') : '';

    row.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px">
        <select class="article-select">${buildArticleOptions(name)}</select>
        <input type="text" name="item_name" class="inp-name" value="${escHtml(name)}"
               placeholder="Artikelname" required style="display:${name && !ARTICLES.find(a=>a.name===name) ? '' : 'none'}" />
      </div>
      <input type="number" name="item_qty" class="inp-qty" value="${qty}" min="0.1" step="0.1" required />
      <input type="text"   name="item_price" class="inp-price" value="${priceFormatted}" placeholder="0,00" required />
      <div class="item-total">—</div>
      <button type="button" class="remove-row" title="Entfernen">×</button>
    `;

    const select = row.querySelector('.article-select');
    const nameInput = row.querySelector('.inp-name');
    const priceInput = row.querySelector('.inp-price');
    const qtyInput = row.querySelector('.inp-qty');

    select.addEventListener('change', () => {
      const opt = select.options[select.selectedIndex];
      if (opt.value === '__custom__') {
        nameInput.style.display = '';
        nameInput.value = '';
        nameInput.focus();
        priceInput.value = '';
      } else if (opt.value) {
        nameInput.style.display = 'none';
        nameInput.value = opt.value;
        priceInput.value = parseFloat(opt.dataset.price).toFixed(2).replace('.', ',');
      } else {
        nameInput.style.display = 'none';
        nameInput.value = '';
        priceInput.value = '';
      }
      updateTotals();
    });

    [priceInput, qtyInput, nameInput].forEach(el => el.addEventListener('input', updateTotals));
    row.querySelector('.remove-row').addEventListener('click', () => { row.remove(); updateTotals(); });

    container.appendChild(row);
    updateTotals();
  };

  addRowBtn.addEventListener('click', () => addRow());

  // Seed existing items (edit mode) or add one blank row
  if (typeof SEED_ITEMS !== 'undefined' && SEED_ITEMS.length > 0) {
    SEED_ITEMS.forEach(it => addRow(it.article_name, it.quantity, it.unit_price));
  } else {
    addRow();
  }
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
