// app.js
import { fetchProducts, saveTransaction, upsertProduct, getStats30d } from './assets/api.js';

/* =========================
   STATE & HELPERS
   ========================= */
const state = {
  products: [],
  productsByName: new Map(),
  filtered: [],
  cart: new Map(),
  cash: 0,
  discount: 0,
  discountType: 'rp',
  paymentMethod: 'Cash',
};

const money    = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const parseNum = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
const uid      = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const keyOf    = (p) => p.id || `${p.name}|${p.harga}`;
const todayStr = () => new Date().toLocaleDateString('id-ID');

function formatCurrencyInput(el, toStateCb) {
  el.addEventListener('input', () => {
    const raw = parseNum(el.value);
    el.value  = raw ? raw.toLocaleString('id-ID') : '';
    if (toStateCb) toStateCb(raw);
    updateSummary();
  });
}
function maskCurrency(el){
  if (!el || el.dataset.maskCurrency === '1') return;
  el.addEventListener('input', () => {
    const raw = parseNum(el.value);
    el.value = raw ? raw.toLocaleString('id-ID') : '';
  });
  el.dataset.maskCurrency = '1';
}

/* =========================
   DOM REFS
   ========================= */
const viewPos        = document.getElementById('view-pos');
const viewDashboard  = document.getElementById('view-dashboard');
const tabPos         = document.getElementById('tab-pos');
const tabDash        = document.getElementById('tab-dashboard');

const itemCount  = document.getElementById('itemCount');
const grid       = document.getElementById('productGrid');
const searchInput= document.getElementById('searchInput');

const cartList   = document.getElementById('cartList');
const subtotalEl = document.getElementById('subtotal');
const totalEl    = document.getElementById('total');
const cashInput  = document.getElementById('cashInput');
const changeEl   = document.getElementById('change');
const btnFinish  = document.getElementById('btnFinish');
const btnHold    = document.getElementById('btnHold');

const discountInput = document.getElementById('discountInput');
const discountTypeEl= document.getElementById('discountType');
const paymentMethodEl = document.getElementById('paymentMethod');

const addModal   = document.getElementById('addModal');
const addForm    = document.getElementById('addForm');
const btnOpenAdd = document.getElementById('btn-open-add');
const btnCloseAdd= document.getElementById('btnCloseAdd');

/* =========================
   HOLD MODAL
   ========================= */
const holdModal    = document.getElementById('holdModal');
const holdList     = document.getElementById('holdList');
const btnCloseHold = document.getElementById('btnCloseHold');

function openHoldModal() {
  renderHoldList();
  if (holdModal && typeof holdModal.showModal === 'function') holdModal.showModal();
}
function mountHoldButtons() {
  let btnOpen = document.getElementById('btn-open-hold');
  if (!btnOpen) {
    btnOpen = document.createElement('button');
    btnOpen.id = 'btn-open-hold';
    btnOpen.className = 'btn btn-hold btn-lg';
    btnOpen.innerHTML = '🛟&nbsp; Lihat Transaksi Tertahan';
  }
  btnOpen.onclick = openHoldModal;

  let row = document.getElementById('holdButtonsRow');
  if (!row) {
    row = document.createElement('div');
    row.id = 'holdButtonsRow';
  }
  const anchor  = document.getElementById('btnFinish');
  if (anchor && anchor.parentNode) anchor.insertAdjacentElement('afterend', row);
  const _btnHold = document.getElementById('btnHold');
  if (_btnHold && _btnHold.parentNode !== row) row.appendChild(_btnHold);
  if (btnOpen.parentNode !== row) row.appendChild(btnOpen);

  if (btnCloseHold && holdModal) {
    btnCloseHold.onclick = () =>
      (typeof holdModal.close === 'function') ? holdModal.close() : holdModal.classList.remove('open');
  }
}

/* Dashboard refs */
const elProfitToday = document.getElementById('kpi-profit-today');
const elOmzetToday  = document.getElementById('kpi-omzet-today');
const elHppToday    = document.getElementById('kpi-hpp-today');
const elCountToday  = document.getElementById('kpi-count-today');
const elProfit30 = document.getElementById('kpi-profit-30');
const elOmzet30  = document.getElementById('kpi-omzet-30');
const elHpp30    = document.getElementById('kpi-hpp-30');
const catList       = document.getElementById('catList');
const lowStockList  = document.getElementById('lowStockList');
const recentList    = document.getElementById('recentList');

const profitChart = document.getElementById('profitChart');
let chartCtx;

/* =========================
   INIT
   ========================= */
init().catch(console.error);
async function init(){
  mountHoldButtons();
  document.documentElement.classList.add('js-hold-ready');

  router('pos');
  attachEvents();
  await loadProducts();
  renderProducts();
  renderCart();
  await loadDashboard();
  renderHoldList();

  const receiptModal = document.getElementById('receiptModal');
  if (receiptModal) {
    const btnPrint = document.getElementById('btnPrint');
    const btnClose = document.getElementById('btnClose');
    btnPrint && btnPrint.addEventListener('click', () => window.print());
    btnClose && btnClose.addEventListener('click', () => {
      if (typeof receiptModal.close === 'function') receiptModal.close();
    });
    receiptModal.addEventListener('click', (e) => {
      if (e.target.tagName === 'DIALOG' && typeof receiptModal.close === 'function') receiptModal.close();
    });
    if (typeof receiptModal.close === 'function') try { receiptModal.close(); } catch {}
  }
}

/* =========================
   EVENTS
   ========================= */
function attachEvents(){
  tabPos && (tabPos.onclick  = () => router('pos'));
  tabDash && (tabDash.onclick = () => router('dashboard'));

  if (searchInput){
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      state.filtered = state.products.filter(p => (p.name||'').toLowerCase().includes(q));
      renderProducts();
    });
  }
  cashInput && formatCurrencyInput(cashInput, (raw) => state.cash = raw);

  if (discountInput) {
    discountInput.addEventListener('input', () => {
      const raw = parseNum(discountInput.value);
      state.discount = raw;
      if (state.discountType === 'rp') {
        discountInput.value = raw ? raw.toLocaleString('id-ID') : '';
      } else {
        discountInput.value = raw ? String(raw) : '';
      }
      updateSummary();
    });
  }
  if (paymentMethodEl) {
    state.paymentMethod = paymentMethodEl.value || 'Cash';
    paymentMethodEl.addEventListener('change', () => {
      state.paymentMethod = paymentMethodEl.value || 'Cash';
      updateSummary();
    });
  }
  if (discountTypeEl){
    discountTypeEl.addEventListener('change', () => {
      state.discountType = discountTypeEl.value;
      if (state.discountType === 'rp') {
        discountInput.value = state.discount ? state.discount.toLocaleString('id-ID') : '';
      } else {
        discountInput.value = state.discount ? String(state.discount) : '';
      }
      updateSummary();
    });
  }
  btnOpenAdd && (btnOpenAdd.onclick = openAddModal);
  btnCloseAdd && (btnCloseAdd.onclick = closeAddModal);
  addForm && addForm.addEventListener('submit', onSaveProduct);

  btnFinish && btnFinish.addEventListener('click', onFinish);
  btnHold   && btnHold.addEventListener('click', onHoldTransaction);

  btnCloseHold && holdModal && (btnCloseHold.onclick = () => {
    if (typeof holdModal.close === 'function') holdModal.close();
    else holdModal.classList.remove('open');
  });
}

/* =========================
   ROUTER
   ========================= */
function router(view){
  const isDash = view === 'dashboard';
  (isDash ? tabDash : tabPos)?.classList.add('tab-active');
  (isDash ? tabPos  : tabDash)?.classList.remove('tab-active');

  if (isDash){
    viewDashboard?.classList.remove('hidden');
    viewPos?.classList.add('hidden');
    loadDashboard();
  } else {
    viewPos?.classList.remove('hidden');
    viewDashboard?.classList.add('hidden');
  }
}

/* =========================
   CART & SUMMARY
   ========================= */
function calcSubtotal(){
  let s = 0; for (const it of state.cart.values()) s += Number(it.harga||0) * Number(it.qty||0); return s;
}
function calcDiscount(subtotal){
  const d = Number(state.discount || 0);
  if (!d) return 0;
  if (state.discountType === 'percent') return Math.min(subtotal, Math.round(subtotal * (d / 100)));
  return Math.min(subtotal, d);
}
function updateSummary(){
  const subtotal = calcSubtotal();
  const diskon   = calcDiscount(subtotal);
  const total    = Math.max(0, subtotal - diskon);
  const change   = Math.max(0, (state.cash||0) - total);
  subtotalEl && (subtotalEl.textContent = money(subtotal));
  totalEl    && (totalEl.textContent    = money(total));
  changeEl   && (changeEl.textContent   = money(change));
  const needsCash = state.paymentMethod === 'Cash';
  btnFinish && (btnFinish.disabled = !(total > 0 && (!needsCash || (state.cash || 0) >= total)));
}

/* =========================
   HOLD TRANSAKSI
   ========================= */
function onHoldTransaction(){
  if (state.cart.size === 0) return alert('Keranjang kosong.');
  const subtotal = calcSubtotal();
  const diskon   = calcDiscount(subtotal);
  const total    = Math.max(0, subtotal - diskon);
  const trx = {
    id: `HOLD-${uid()}`,
    cart: [...state.cart.values()],
    discount: state.discount,
    discountType: state.discountType,
    subtotal, total,
    createdAt: new Date().toISOString(),
  };
  const holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  holds.push(trx);
  localStorage.setItem('pos_hold', JSON.stringify(holds));
  state.cart.clear(); state.cash = 0; state.discount = 0;
  cashInput && (cashInput.value = ''); discountInput && (discountInput.value = '');
  renderCart(); updateSummary(); renderHoldList();
  alert('Transaksi disimpan sementara.');
}
function renderHoldList(){
  const holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  if (!holdList) return;
  holdList.innerHTML = '';
  if (!holds.length){ holdList.innerHTML = '<div class="muted">Tidak ada</div>'; return; }
  for (const h of holds){
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div>${h.id} • Total ${money(h.total)}</div>`;
    const btnLoad = document.createElement('button'); btnLoad.className='btn btn-sm'; btnLoad.textContent='Lanjutkan';
    btnLoad.onclick = () => resumeHold(h.id);
    const btnDel = document.createElement('button'); btnDel.className='btn btn-sm danger'; btnDel.textContent='Hapus';
    btnDel.onclick = () => deleteHold(h.id);
    const right = document.createElement('div'); right.style.display='flex'; right.style.gap='6px'; right.append(btnLoad, btnDel);
    row.appendChild(right); holdList.appendChild(row);
  }
}
function resumeHold(id){
  const holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  const h = holds.find(x => x.id === id); if (!h) return;
  state.cart.clear(); for (const it of (h.cart || [])) state.cart.set(keyOf(it), it);
  state.discount = Number(h.discount || 0); state.discountType = h.discountType || 'rp';
  discountTypeEl && (discountTypeEl.value = state.discountType);
  discountInput && (discountInput.value = state.discount
    ? (state.discountType === 'rp' ? state.discount.toLocaleString('id-ID') : String(state.discount)) : '');
  renderCart(); updateSummary();
  const rest = holds.filter(x => x.id !== id);
  localStorage.setItem('pos_hold', JSON.stringify(rest)); renderHoldList();
  if (holdModal) { if (typeof holdModal.showModal === 'function') holdModal.showModal(); else holdModal.classList.add('open'); }
}
function deleteHold(id){
  let holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  holds = holds.filter(x => x.id !== id);
  localStorage.setItem('pos_hold', JSON.stringify(holds));
  renderHoldList();
}

/* =========================
   FINISH / SIMPAN & CETAK (optimistic)
   ========================= */
async function onFinish(){
  const items = [...state.cart.values()];
  if (!items.length) return alert('Keranjang kosong.');

  const subtotal = calcSubtotal();
  const diskon   = calcDiscount(subtotal);
  const total    = Math.max(0, subtotal - diskon);

  const method = state.paymentMethod || 'Cash';
  if (method === 'Cash' && (state.cash || 0) < total) return alert('Uang tunai kurang.');

  const now = new Date();
  const trx = {
    transactionId: `TRX-${uid()}`,
    tanggal: now.toLocaleDateString('id-ID'),
    waktu: now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }),

    // [PATCH] simpan snapshot kategori & HPP saat ini (fallback sebelum data resmi FIFO datang)
    transaksi: items.map(it => {
      const key = String(it.name || '').toLowerCase();
      const ref = state.productsByName.get(key) || {};
      return {
        id: it.id ?? null,
        name: it.name,
        harga: +it.harga || 0,
        qty: +it.qty || 0,
        kategori: ref.kategori || it.kategori || 'Lainnya',
        modalAtSale: +ref.hargaModal || +it.hargaModal || 0
      };
    }),

    subtotal, diskon, diskonType: state.discountType,
    total, cash: state.cash, change: Math.max(0, (state.cash||0)-total),
    paymentMethod: paymentMethodEl?.value || 'Cash',
  };

  // 1) Show receipt & bersihkan UI lebih dulu (optimistic)
  showReceipt(trx);
  state.cart.clear(); state.cash = 0; state.discount = 0;
  cashInput && (cashInput.value = '');
  discountInput && (discountInput.value = '');
  renderCart(); updateSummary();

  // 2) Kirim ke backend TANPA await; sinkronkan bila respon datang
  saveTransaction(trx).then(res => {
    if (res && Array.isArray(res.updatedRows) && res.updatedRows.length) {
      for (const u of res.updatedRows) {
        const idx = state.products.findIndex(p =>
          (p.id ? p.id === u.id
                : (p.name||'').trim().toLowerCase() === (u.name||'').trim().toLowerCase()));
        if (idx >= 0) {
          if (u.stok != null)        state.products[idx].stok = +u.stok;
          if (u.harga != null)       state.products[idx].harga = +u.harga;
          if (u.hargaModal != null)  state.products[idx].hargaModal = +u.hargaModal;
        }
      }
      state.filtered = state.products.filter(p =>
        (p.name||'').toLowerCase().includes((searchInput?.value || '').toLowerCase()));
      renderProducts();
    } else {
      // fallback: refresh product list ringan
      setTimeout(() => loadProducts().then(renderProducts).catch(()=>{}), 1000);
    }

    // [PATCH] rekonsiliasi HPP dari backend (FIFO) -> update histori lokal + refresh dashboard
    if (res && Array.isArray(res.costSnapshot)) {
      const history = JSON.parse(localStorage.getItem('pos_history') || '[]');
      const last = history[0];
      if (last && Array.isArray(last.transaksi)) {
        const costMap = new Map(
          res.costSnapshot.map(x => [String(x.name).toLowerCase(), Number(x.modalAtSale || 0)])
        );
        for (const it of last.transaksi) {
          const m = costMap.get(String(it.name || '').toLowerCase());
          if (m != null) it.modalAtSale = m;
        }
        localStorage.setItem('pos_history', JSON.stringify(history));
      }
      // biar "Top Kategori by Laba" langsung pakai angka final
      loadDashboard().catch(()=>{});
    }
  }).catch(e => console.warn('saveTransaction error:', e?.message || e));

  // 3) histori lokal (buat dashboard offline)
  const history = JSON.parse(localStorage.getItem('pos_history') || '[]');
  history.unshift(trx);
  localStorage.setItem('pos_history', JSON.stringify(history));
}


/* =========================
   STRUK
   ========================= */
function showReceipt(trx) {
  const money2 = (n) => `Rp ${Number(n||0).toLocaleString('id-ID')}`;
  const modal = document.getElementById('receiptModal');
  if (!modal) return;
  let html = `
    <div class="struk">
      <div class="center strong">TOKO BG ATUY</div>
      <div class="center">Jl. Jalanin Aja Dulu</div>
      <div class="line"></div>
      <div>Tanggal : ${trx.tanggal}</div>
      <div>Waktu   : ${trx.waktu}</div>
      <div>ID      : ${trx.transactionId}</div>
      <div class="line"></div>
      ${trx.transaksi.map(it => `
        <div class="row">
          <span>${it.name}</span>
          <span>${money2(it.harga * it.qty)}</span>
        </div>
        <div class="subrow">${it.qty} x ${money2(it.harga)}</div>
      `).join('')}
      <div class="line"></div>
      <div class="row"><span>Subtotal</span><span>${money2(trx.subtotal)}</span></div>`;
  if (trx.diskon > 0) {
    html += `<div class="row"><span>Diskon</span><span>- ${money2(trx.diskon)}</span></div>`;
  }
  html += `
      <div class="row strong"><span>Total</span><span>${money2(trx.total)}</span></div>
      <div class="row"><span>Tunai</span><span>${money2(trx.cash)}</span></div>
      <div class="row"><span>Kembali</span><span>${money2(trx.change)}</span></div>
      <div class="line"></div>
      <div class="center">Terima kasih :)</div>
    </div>
  `;
  const slot = modal.querySelector('.receipt'); if (slot) slot.innerHTML = html;
  if (typeof modal.showModal === 'function') modal.showModal(); else modal.classList.add('open');
}

/* =========================
   ADD/UPSERT PRODUK
   ========================= */
async function onSaveProduct(e){
  e.preventDefault();
  if (!addForm) return;

  const fd = new FormData(addForm);
  const payload = {
    id: String(fd.get('id')||'').trim() || ('P'+uid()),
    name: String(fd.get('name')||'').trim(),
    harga: parseNum(fd.get('harga')),
    hargaModal: parseNum(fd.get('hargaModal')),
    stok: parseNum(fd.get('stok')),
    kategori: String(fd.get('kategori')||'').trim() || 'Lainnya',
  };
  if (!payload.name) return alert('Nama wajib.');

  try{
    const res = await upsertProduct(payload);
    const idx = state.products.findIndex(p => (p.name||'').toLowerCase() === payload.name.toLowerCase());

    if (res.mode === 'append' || idx === -1){
      const row = {
        id: res.id || payload.id,
        name: payload.name,
        harga: res.harga ?? payload.harga,
        hargaModal: res.hargaModal ?? payload.hargaModal,
        stok: res.after ?? payload.stok,
        kategori: res.kategori || payload.kategori || 'Lainnya'
      };
      state.products.unshift(row);
    } else {
      const p = state.products[idx];
      p.stok = res.after ?? (Number(p.stok||0) + payload.stok);
      if (res.harga != null) p.harga = res.harga;
      if (res.hargaModal != null) p.hargaModal = res.hargaModal;
      if (res.kategori) p.kategori = res.kategori;
    }

    state.productsByName.clear();
    for (const p of state.products) state.productsByName.set((p.name||'').toLowerCase(), p);

    state.filtered = state.products.filter(p => (p.name||'').toLowerCase().includes((searchInput?.value || '').toLowerCase()));
    renderProducts();
    populateSuggestions();
    closeAddModal();
    addForm.reset();
  }catch(err){
    alert('Gagal simpan ke Google Sheet: ' + (err?.message || err));
  }
}

/* =========================
   MODAL HELPERS
   ========================= */
function enforceUppercase(el){
  if(!el) return;
  el.addEventListener('input', () => {
    const s = el.selectionStart, e = el.selectionEnd;
    el.value = (el.value || '').toUpperCase();
    try { el.setSelectionRange(s, e); } catch {}
  });
}
function openAddModal(){
  populateSuggestions();
  const stokInput = document.getElementById('stokInput');
  if (stokInput) { stokInput.value = ''; stokInput.placeholder = 'Qty Restok (tambah)'; }
  if (!addModal) return;
  if (typeof addModal.showModal === 'function') addModal.showModal();
  else addModal.classList.add('open');
}
function closeAddModal(){
  if (!addModal) return;
  if (typeof addModal.close === 'function') addModal.close();
  else addModal.classList.remove('open');
}
function populateSuggestions() {
  const productList = document.getElementById('productList');
  if (productList) {
    productList.innerHTML = '';
    for (const p of state.products) {
      const opt = document.createElement('option'); opt.value = p.name; productList.appendChild(opt);
    }
  }
  const kategoriList = document.getElementById('kategoriList');
  if (kategoriList) {
    kategoriList.innerHTML = '';
    const unik = [...new Set(state.products.map(p => p.kategori || 'Lainnya'))];
    for (const c of unik) {
      const opt = document.createElement('option'); opt.value = c; kategoriList.appendChild(opt);
    }
  }
  const idInput       = document.getElementById('idInput');
  const nameInput     = document.getElementById('nameInput');
  const kategoriInput = document.getElementById('kategoriInput');
  const hargaModalInp = document.getElementById('hargaModalInput');
  const hargaInp      = document.getElementById('hargaInput');
  const stokInput     = document.getElementById('stokInput');

  maskCurrency(hargaModalInp); maskCurrency(hargaInp);
  enforceUppercase(idInput); enforceUppercase(nameInput); enforceUppercase(kategoriInput);

  const setMoney = (el, n) => { if (!el) return; const raw = Number(n || 0); el.value = raw ? raw.toLocaleString('id-ID') : ''; };
  function fillFromProduct(p) {
    if (!p) return;
    idInput       && (idInput.value       = String(p.id || '').toUpperCase());
    nameInput     && (nameInput.value     = String(p.name || '').toUpperCase());
    kategoriInput && (kategoriInput.value = String(p.kategori || 'Lainnya').toUpperCase());
    setMoney(hargaModalInp, p.hargaModal);
    setMoney(hargaInp,      p.harga);
    if (stokInput) { stokInput.value = ''; stokInput.placeholder = `Qty Restok (sisa stok: ${Number(p.stok || 0)})`; }
  }
  function findById(id) {
    const up = String(id || '').trim().toUpperCase();
    return state.products.find(x => String(x.id || '').trim().toUpperCase() === up);
  }
  function findByName(nm) {
    const key = String(nm || '').trim().toLowerCase();
    return state.productsByName.get(key);
  }
  idInput && idInput.addEventListener('change', () => fillFromProduct(findById(idInput.value)));
  if (nameInput) {
    const handler = () => fillFromProduct(findByName(nameInput.value));
    nameInput.addEventListener('input', handler);
    nameInput.addEventListener('change', handler);
    if (nameInput.value) handler();
  }
}

/* =========================
   PRODUCTS
   ========================= */
async function loadProducts(){
  const res = await fetchProducts();
  const arr = Array.isArray(res) ? res : (res?.products||[]);
  state.products = arr.map(p => ({
    id: p.id ?? null,
    name: p.name,
    harga: Number(p.harga||0),
    hargaModal: Number(p.hargaModal||0),
    stok: Number(p.stok||0),
    kategori: p.kategori || 'Lainnya',
    tanggalMasuk: p.tanggalMasuk || ''
  }));
  state.filtered = state.products.slice();
  state.productsByName.clear();
  for (const p of state.products) state.productsByName.set((p.name||'').toLowerCase(), p);
  itemCount && (itemCount.textContent = `${state.products.length} item`);
}
function renderProducts(){
  if (!grid) return; grid.innerHTML = '';
  for (const p of state.filtered) grid.appendChild(productCard(p));
}
function productCard(p){
  const stok = Number(p.stok||0);
  const pill = document.createElement('div');
  pill.className = 'pill ' + (stok <= 5 ? (stok<=0?'danger':'warn') : 'ok');
  pill.textContent = `Stok ${stok}`;
  const idpill = document.createElement('div'); idpill.className = 'pill'; idpill.textContent = p.id || '-';
  const header = divFlex(); header.append(idpill, pill);
  const name = document.createElement('div'); name.className = 'prod-name'; name.textContent = p.name;
  const price = document.createElement('div'); price.className = 'prod-price'; price.textContent = money(p.harga);
  const btn = document.createElement('button'); btn.className = 'btn btn-primary btn-add'; btn.textContent = 'Tambah';
  btn.onclick = () => addToCart(p);
  const card = document.createElement('div'); card.className = 'card-prod'; card.append(header, name, price, btn);
  return card;
}
function divFlex(){ const d = document.createElement('div'); d.style.display='flex'; d.style.alignItems='center'; d.style.justifyContent='space-between'; return d; }

/* =========================
   CART
   ========================= */
function addToCart(p){
  const key = keyOf(p);
  const cur = state.cart.get(key) || { ...p, qty: 0 };
  const max = Number(p.stok||Infinity);
  if (cur.qty + 1 > max) return alert('Stok tidak cukup.');
  cur.qty += 1; state.cart.set(key, cur); renderCart();
}
function inc(key){
  const it = state.cart.get(key); if(!it) return;
  const max = Number(it.stok||Infinity);
  if (it.qty + 1 > max) return;
  it.qty += 1; renderCart();
}
function dec(key){
  const it = state.cart.get(key); if(!it) return;
  it.qty -= 1; if (it.qty <= 0) state.cart.delete(key); renderCart();
}
function removeItem(key){ state.cart.delete(key); renderCart(); }
function renderCart(){
  if (!cartList) return;
  cartList.innerHTML = '';
  const list = [...state.cart.values()];
  for (const it of list) {
    const key = keyOf(it);
    const row = document.createElement('div'); row.className = 'cart-row';
    const left = document.createElement('div');
    left.innerHTML = `<div style="font-weight:600;">${it.name}</div><div class="muted" style="font-size:12px;">${money(it.harga)}</div>`;
    const lineTotal = document.createElement('div'); lineTotal.className = 'money strong'; lineTotal.textContent = money(it.harga * it.qty);
    const qty = document.createElement('div'); qty.className = 'qty';
    const bDec = document.createElement('button'); bDec.className='btn'; bDec.textContent='–'; bDec.onclick = () => dec(key);
    const qv = document.createElement('div'); qv.style.minWidth='24px'; qv.style.textAlign='center'; qv.textContent = it.qty;
    const bInc = document.createElement('button'); bInc.className='btn'; bInc.textContent='+'; bInc.onclick = () => inc(key);
    qty.append(bDec, qv, bInc);
    const del = document.createElement('button'); del.className = 'btn btn-trash'; del.innerHTML = '🗑️'; del.title = 'Hapus'; del.onclick = () => removeItem(key);
    row.append(left, qty, lineTotal, del); cartList.appendChild(row);
  }
  updateSummary();
}

/* =========================
   DASHBOARD (semua dari backend)
   ========================= */
async function loadDashboard(){
  try {
    const s = await getStats30d(); // ambil KPI, trend, topCategories, lowStock, recent

    // KPI hari ini
    elProfitToday && (elProfitToday.textContent = money(s.profitToday || 0));
    elOmzetToday  && (elOmzetToday.textContent  = money(s.omzetToday  || 0));
    elHppToday    && (elHppToday.textContent    = money(s.hppToday    || 0));
    elCountToday  && (elCountToday.textContent  = String(s.countToday || 0));

    // Akumulasi 30 hari
    elProfit30 && (elProfit30.textContent = money(s.profit30 || 0));
    elOmzet30  && (elOmzet30.textContent  = money(s.omzet30  || 0));
    elHpp30    && (elHpp30.textContent    = money(s.hpp30    || 0));

    // Trend 30 hari
    drawProfitChart(Array.isArray(s.trend) ? s.trend : []);

    // Top kategori by laba (30 hari)
    renderTopCategories(Array.isArray(s.topCategories) ? s.topCategories : []);

    // Stok tipis (≤5)
    renderLowStock(Array.isArray(s.lowStock) ? s.lowStock : []);

    // Transaksi terbaru
    renderRecent(Array.isArray(s.recent) ? s.recent : []);
  } catch (e) {
    console.warn('loadDashboard backend error:', e?.message || e);
    // fallback minimal: kosongkan chart & list
    drawProfitChart([]);
    renderTopCategories([]);
    renderLowStock([]);
    renderRecent([]);
    // KPI kosong
    elProfitToday && (elProfitToday.textContent = money(0));
    elOmzetToday  && (elOmzetToday.textContent  = money(0));
    elHppToday    && (elHppToday.textContent    = money(0));
    elCountToday  && (elCountToday.textContent  = '0');
    elProfit30 && (elProfit30.textContent = money(0));
    elOmzet30  && (elOmzet30.textContent  = money(0));
    elHpp30    && (elHpp30.textContent    = money(0));
  }
}

/* ---------- Render helpers ---------- */
function renderTopCategories(arr){
  if (!catList) return;
  catList.innerHTML = '';
  if (!arr.length) {
    catList.innerHTML = '<div class="muted">Belum ada data kategori.</div>';
    return;
  }
  for (const it of arr) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div>${it.name}</div><div class="money strong">${money(it.profit||0)}</div>`;
    catList.appendChild(row);
  }
}

function renderLowStock(arr){
  if (!lowStockList) return;
  lowStockList.innerHTML = '';
  if (!arr.length) {
    lowStockList.innerHTML = '<div class="muted">Semua stok aman.</div>';
    return;
  }
  for (const it of arr) {
    const row = document.createElement('div'); row.className = 'row';
    row.innerHTML = `<div>${it.name}</div><div class="badge">Sisa: ${Number(it.stok||0)}</div>`;
    lowStockList.appendChild(row);
  }
}

function renderRecent(arr){
  if (!recentList) return;
  recentList.innerHTML = '';
  if (!arr.length) return;
  for (const r of arr) {
    const el = document.createElement('div'); el.className = 'item';
    const itemsText = (r.itemCount != null) ? ` • ${r.itemCount} item` : '';
    el.innerHTML = `
      <div>
        <div class="strong">${r.id || '-'}</div>
        <div class="muted">${r.tanggal || ''} ${r.waktu || ''}${itemsText}</div>
      </div>
      <div class="strong money">${money(r.totalBayar || 0)}</div>`;
    recentList.appendChild(el);
  }
}


/* ---------- Chart helper tetap ---------- */
function drawProfitChart(points){
  if (!profitChart) return;
  if (!chartCtx) chartCtx = profitChart.getContext('2d');
  const W = profitChart.width = profitChart.clientWidth;
  const H = profitChart.height;
  chartCtx.clearRect(0,0,W,H);
  const values = points.map(p=>Number(p.profit||0));
  const max = Math.max(1, ...values);
  const pad = 10;
  const stepX = (W - pad*2) / Math.max(1, points.length-1);
  chartCtx.beginPath();
  points.forEach((p,i)=>{ const x = pad + i*stepX; const y = H - pad - (Number(p.profit||0)/max)*(H-pad*2); if(i===0) chartCtx.moveTo(x,y); else chartCtx.lineTo(x,y); });
  chartCtx.lineTo(W-pad, H-pad); chartCtx.lineTo(pad, H-pad); chartCtx.closePath();
  chartCtx.fillStyle = 'rgba(37, 99, 235, .12)'; chartCtx.fill();
  chartCtx.beginPath();
  points.forEach((p,i)=>{ const x = pad + i*stepX; const y = H - pad - (Number(p.profit||0)/max)*(H-pad*2); if(i===0) chartCtx.moveTo(x,y); else chartCtx.lineTo(x,y); });
  chartCtx.strokeStyle = '#2563EB'; chartCtx.lineWidth = 2; chartCtx.stroke();
}

