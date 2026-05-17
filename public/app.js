// ── Flash auto-dismiss ────────────────────────────────────────────────
document.querySelectorAll('.flash').forEach(el => {
  setTimeout(() => { el.style.transition = 'opacity 0.5s'; el.style.opacity = '0'; }, 4000);
});

// ── Mobile sidebar toggle ─────────────────────────────────────────────
(function () {
  const btn     = document.getElementById('hamburger-btn');
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!btn || !sidebar || !overlay) return;

  const open  = () => { sidebar.classList.add('open');    overlay.classList.add('active'); };
  const close = () => { sidebar.classList.remove('open'); overlay.classList.remove('active'); };

  btn.addEventListener('click', open);
  overlay.addEventListener('click', close);
  sidebar.querySelectorAll('a.nav-item, button.nav-item').forEach(item => {
    item.addEventListener('click', () => { if (window.innerWidth <= 768) close(); });
  });
})();

// ── Invoice form ──────────────────────────────────────────────────────
(function () {
  const customerSelect  = document.getElementById('customer-select');
  const customerPreview = document.getElementById('customer-preview');
  const container       = document.getElementById('items-container');
  const addRowBtn       = document.getElementById('add-row');

  if (!container || !addRowBtn) return;

  // ── Totals ──────────────────────────────────────────────────────────
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

  // ── Customer price helpers ───────────────────────────────────────────
  const getCustomerPrices = () => {
    if (typeof CUSTOMER_PRICES === 'undefined' || !customerSelect || !customerSelect.value) return {};
    return CUSTOMER_PRICES[customerSelect.value] || {};
  };

  const resolvePrice = (articleId, defaultPrice) => {
    const prices = getCustomerPrices();
    return prices[String(articleId)] !== undefined ? prices[String(articleId)] : defaultPrice;
  };

  // ── Article option builder ───────────────────────────────────────────
  const buildArticleOptions = (selectedName) => {
    let html = '<option value="">— Artikel wählen —</option>';
    if (typeof ARTICLES !== 'undefined') {
      ARTICLES.forEach(a => {
        const sel   = a.name === selectedName ? 'selected' : '';
        const price = resolvePrice(a.id, a.price);
        html += `<option value="${a.name}" data-price="${price}" data-default-price="${a.price}" data-article-id="${a.id}" ${sel}>${a.name}</option>`;
      });
    }
    html += '<option value="__custom__">Eigener Artikel …</option>';
    return html;
  };

  // ── Apply customer prices to all existing rows ───────────────────────
  const applyCustomerPrices = () => {
    const prices = getCustomerPrices();
    container.querySelectorAll('.item-row').forEach(row => {
      const select     = row.querySelector('.article-select');
      const priceInput = row.querySelector('.inp-price');
      if (!select) return;

      Array.from(select.options).forEach(opt => {
        const articleId = opt.dataset.articleId;
        if (!articleId) return;
        opt.dataset.price = prices[articleId] !== undefined
          ? prices[articleId]
          : (opt.dataset.defaultPrice || opt.dataset.price);
      });

      const sel = select.options[select.selectedIndex];
      if (sel && sel.value && sel.value !== '__custom__') {
        priceInput.value = parseFloat(sel.dataset.price).toFixed(2).replace('.', ',');
      }
    });
    updateTotals();
  };

  // ── Customer preview ─────────────────────────────────────────────────
  if (customerSelect && customerPreview) {
    const showPreview = () => {
      const opt = customerSelect.options[customerSelect.selectedIndex];
      if (!opt || !opt.value) { customerPreview.style.display = 'none'; return; }
      document.getElementById('preview-billing').textContent  = opt.dataset.billing  || '—';
      document.getElementById('preview-delivery').textContent = opt.dataset.delivery || '—';
      const cc = opt.dataset.costcenter;
      document.getElementById('preview-costcenter').textContent = cc || '—';
      document.getElementById('preview-costcenter-row').style.display = cc ? '' : 'none';
      customerPreview.style.display = 'flex';
    };
    customerSelect.addEventListener('change', () => {
      showPreview();
      applyCustomerPrices();
    });
    showPreview();
  }

  // ── Add row ──────────────────────────────────────────────────────────
  const addRow = (name = '', qty = 1, price = '') => {
    const row = document.createElement('div');
    row.className = 'item-row';

    const priceFormatted = price !== '' ? parseFloat(price).toFixed(2).replace('.', ',') : '';

    row.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px">
        <select class="article-select">${buildArticleOptions(name)}</select>
        <input type="text" name="item_name" class="inp-name" value="${escHtml(name)}"
               placeholder="Artikelname" required style="display:${name && !(typeof ARTICLES !== 'undefined' && ARTICLES.find(a => a.name === name)) ? '' : 'none'}" />
      </div>
      <input type="number" name="item_qty"   class="inp-qty"   value="${qty}" min="0.1" step="0.1" required />
      <input type="text"   name="item_price" class="inp-price" value="${priceFormatted}" placeholder="0,00" required />
      <div class="item-total">—</div>
      <button type="button" class="remove-row" title="Entfernen">×</button>
    `;

    const select     = row.querySelector('.article-select');
    const nameInput  = row.querySelector('.inp-name');
    const priceInput = row.querySelector('.inp-price');
    const qtyInput   = row.querySelector('.inp-qty');

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

  if (typeof SEED_ITEMS !== 'undefined' && SEED_ITEMS.length > 0) {
    SEED_ITEMS.forEach(it => addRow(it.article_name, it.quantity, it.unit_price));
  } else {
    addRow();
  }
})();

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
