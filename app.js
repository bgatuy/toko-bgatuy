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
  paymentMethod: 'Cash',        // ⬅️ hanya dicatat
};


const money    = (n) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`;
const parseNum = (s) => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
const uid      = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const keyOf    = (p) => p.id || `${p.name}|${p.harga}`;
const todayStr = () => new Date().toLocaleDateString('id-ID');

// format input angka dengan ribuan (jaga caret simple)
function formatCurrencyInput(el, toStateCb) {
  el.addEventListener('input', () => {
    const raw = parseNum(el.value);
    el.value  = raw ? raw.toLocaleString('id-ID') : '';
    if (toStateCb) toStateCb(raw);
    updateSummary();
  });
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
const paymentMethodEl = document.getElementById('paymentMethod'); // ⬅️ baru

/* Modal Tambah Produk (pakai <dialog>, fallback aman) */
const addModal   = document.getElementById('addModal');
const addForm    = document.getElementById('addForm');
const btnOpenAdd = document.getElementById('btn-open-add');
const btnCloseAdd= document.getElementById('btnCloseAdd');

/* =========================
   HOLD MODAL (auto-create)
   ========================= */
/* Hold modal */
const holdModal    = document.getElementById('holdModal');
const holdList     = document.getElementById('holdList');
const btnCloseHold = document.getElementById('btnCloseHold');

function openHoldModal() {
  renderHoldList();
  if (holdModal && typeof holdModal.showModal === 'function') holdModal.showModal();
}

function mountHoldButtons() {
  // sudah ada? cukup hubungkan event & selesai
  let btnOpen = document.getElementById('btn-open-hold');
  if (!btnOpen) {
    btnOpen = document.createElement('button');
    btnOpen.id = 'btn-open-hold';
    btnOpen.className = 'btn btn-hold btn-lg';
    btnOpen.innerHTML = '🛟&nbsp; Lihat Transaksi Tertahan';
  }
  btnOpen.onclick = openHoldModal;

  // bungkus dua tombol ke dalam satu baris (flex)
  let row = document.getElementById('holdButtonsRow');
  if (!row) {
    row = document.createElement('div');
    row.id = 'holdButtonsRow';
  }
  // tempatkan persis setelah tombol bayar
  const payCard = document.querySelector('#paymentCard') || document;
  const anchor  = document.getElementById('btnFinish'); // tombol biru “Bayar & Cetak”
  if (anchor && anchor.parentNode) {
    // pastikan urut: [btnFinish] lalu [row berisi btnHold & btnOpen]
    anchor.insertAdjacentElement('afterend', row);
  } else {
    // fallback
    payCard.appendChild(row);
  }

  // pindahkan/memasukkan tombol kuning ke dalam row
  const btnHold = document.getElementById('btnHold');
  if (btnHold && btnHold.parentNode !== row) row.appendChild(btnHold);
  if (btnOpen.parentNode !== row) row.appendChild(btnOpen);

  // close di modal
  if (btnCloseHold && holdModal) {
    btnCloseHold.onclick = () =>
      (typeof holdModal.close === 'function') ? holdModal.close() : holdModal.classList.remove('open');
  }
}


/* Dashboard */
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
const btnResetLocal = document.getElementById('btn-reset-local');

const profitChart = document.getElementById('profitChart');
let chartCtx;

/* =========================
   INIT
   ========================= */
init().catch(console.error);

async function init(){
  // 1) pasang tombol dan barisnya seawal mungkin
  mountHoldButtons();

  // 2) tampilkan (unhide) setelah layout 2-kolom siap
  document.documentElement.classList.add('js-hold-ready');

  // lanjut proses lain
  router('pos');
  attachEvents();
  await loadProducts();
  renderProducts();
  renderCart();
  await loadDashboard();
  renderHoldList();

  // Receipt modal: tombol print/close (kalau ada)
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
    // pastikan tertutup saat load
    if (typeof receiptModal.close === 'function') try { receiptModal.close(); } catch {}
  }
}

/* =========================
   EVENTS
   ========================= */
function attachEvents(){
  // Tabs
  tabPos && (tabPos.onclick  = () => router('pos'));
  tabDash && (tabDash.onclick = () => router('dashboard'));

  // Search produk
  if (searchInput){
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase();
      state.filtered = state.products.filter(p => (p.name||'').toLowerCase().includes(q));
      renderProducts();
    });
  }

  // Input uang & diskon (ribuan)
  if (cashInput) formatCurrencyInput(cashInput, (raw) => state.cash = raw);

  if (discountInput) {
    // saat mengetik → jika tipe 'rp' format ribuan, kalau 'percent' tampil angka apa adanya
    discountInput.addEventListener('input', () => {
      const raw = parseNum(discountInput.value);
      state.discount = raw;
      if (state.discountType === 'rp') {
        discountInput.value = raw ? raw.toLocaleString('id-ID') : '';
      } else {
        // percent: tampilkan tanpa pemisah ribuan biar jelas "10" = 10%
        discountInput.value = raw ? String(raw) : '';
      }
      updateSummary();
    });
  }

    // Metode pembayaran (hanya dicatat, tidak mempengaruhi perhitungan)
  if (paymentMethodEl) {
    state.paymentMethod = paymentMethodEl.value || 'Cash';
    paymentMethodEl.addEventListener('change', () => {
      state.paymentMethod = paymentMethodEl.value || 'Cash';
      updateSummary(); // supaya tombol Bayar ikut menyesuaikan
    });
  }

  // Ubah tipe diskon → reformat tampilan input-nya
  if (discountTypeEl){
    discountTypeEl.addEventListener('change', () => {
      state.discountType = discountTypeEl.value;
      // normalisasi tampilan field
      if (state.discountType === 'rp') {
        discountInput.value = state.discount ? state.discount.toLocaleString('id-ID') : '';
      } else {
        discountInput.value = state.discount ? String(state.discount) : '';
      }
      updateSummary();
    });
  }

  // Modal Tambah Produk
  if (btnOpenAdd) btnOpenAdd.onclick = openAddModal;
  if (btnCloseAdd) btnCloseAdd.onclick = closeAddModal;

  // Submit produk baru
  if (addForm) addForm.addEventListener('submit', onSaveProduct);

  // Selesai transaksi & Tahan
  if (btnFinish) btnFinish.addEventListener('click', onFinish);
  if (btnHold)   btnHold.addEventListener('click', onHoldTransaction);

  // Hold modal close
  if (btnCloseHold && holdModal) btnCloseHold.onclick = () => {
    if (typeof holdModal.close === 'function') holdModal.close();
    else holdModal.classList.remove('open');
  };

  // Reset histori lokal (dashboard)
  if (btnResetLocal){
    btnResetLocal.addEventListener('click', () => {
      if (!confirm('Hapus histori lokal? Data di Google Sheet tetap aman.')) return;
      localStorage.removeItem('pos_history');
      loadDashboard();
    });
  }
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
  let s = 0;
  for (const it of state.cart.values()) s += Number(it.harga||0) * Number(it.qty||0);
  return s;
}

function calcDiscount(subtotal){
  const d = Number(state.discount || 0);
  if (!d) return 0;
  if (state.discountType === 'percent') {
    return Math.min(subtotal, Math.round(subtotal * (d / 100)));
  }
  return Math.min(subtotal, d);
}

function updateSummary(){
  const subtotal = calcSubtotal();
  const diskon   = calcDiscount(subtotal);
  const total    = Math.max(0, subtotal - diskon);
  const change   = Math.max(0, (state.cash||0) - total);
  if (subtotalEl) subtotalEl.textContent = money(subtotal);
  if (totalEl)    totalEl.textContent    = money(total);
  if (changeEl)   changeEl.textContent   = money(change);
  const needsCash = state.paymentMethod === 'Cash';
  btnFinish.disabled = !(total > 0 && (!needsCash || (state.cash || 0) >= total));
}

/* =========================
   HOLD TRANSAKSI (PARKIR)
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

  // clear keranjang
  state.cart.clear(); state.cash = 0; state.discount = 0;
  if (cashInput) cashInput.value = '';
  if (discountInput) discountInput.value = '';
  renderCart(); updateSummary();
  renderHoldList();
  alert('Transaksi disimpan sementara.');
}

function renderHoldList(){
  const holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  if (!holdList) return;
  holdList.innerHTML = '';
  if (!holds.length){
    holdList.innerHTML = '<div class="muted">Tidak ada</div>';
    return;
  }
  for (const h of holds){
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<div>${h.id} • Total ${money(h.total)}</div>`;
    const btnLoad = document.createElement('button');
    btnLoad.className='btn btn-sm'; btnLoad.textContent='Lanjutkan';
    btnLoad.onclick = () => resumeHold(h.id);

    const btnDel = document.createElement('button');
    btnDel.className='btn btn-sm danger'; btnDel.textContent='Hapus';
    btnDel.onclick = () => deleteHold(h.id);

    const right = document.createElement('div');
    right.append(btnLoad, btnDel);
    right.style.display = 'flex';
    right.style.gap = '6px';

    row.appendChild(right);
    holdList.appendChild(row);
  }
}

function resumeHold(id){
  const holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  const h = holds.find(x => x.id === id);
  if (!h) return;

  state.cart.clear();
  for (const it of (h.cart || [])) state.cart.set(keyOf(it), it);

  state.discount = Number(h.discount || 0);
  state.discountType = h.discountType || 'rp';

  if (discountTypeEl) discountTypeEl.value = state.discountType;
  if (discountInput) {
    discountInput.value = state.discount
      ? (state.discountType === 'rp' ? state.discount.toLocaleString('id-ID') : String(state.discount))
      : '';
  }

  renderCart(); updateSummary();

  // remove dari hold list
  const rest = holds.filter(x => x.id !== id);
  localStorage.setItem('pos_hold', JSON.stringify(rest));
  renderHoldList();

  // Tampilkan modal hold (kalau ada)
  if (holdModal) {
    if (typeof holdModal.showModal === 'function') holdModal.showModal();
    else holdModal.classList.add('open');
  }
}

function deleteHold(id){
  let holds = JSON.parse(localStorage.getItem('pos_hold') || '[]');
  holds = holds.filter(x => x.id !== id);
  localStorage.setItem('pos_hold', JSON.stringify(holds));
  renderHoldList();
}

/* =========================
   FINISH / SIMPAN & CETAK
   ========================= */
async function onFinish(){
  const items = [...state.cart.values()];
  if (!items.length) return alert('Keranjang kosong.');

  const subtotal = calcSubtotal();
  const diskon   = calcDiscount(subtotal);
  const total    = Math.max(0, subtotal - diskon);

  // Hanya wajib isi tunai jika metode = Cash
  const method = state.paymentMethod || 'Cash';
  if (method === 'Cash' && (state.cash || 0) < total) {
    return alert('Uang tunai kurang.');
  }

  const now = new Date();
  const trx = {
    transactionId: `TRX-${uid()}`,
    tanggal: now.toLocaleDateString('id-ID'),
    waktu: now.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' }),
    transaksi: items.map(it => ({
      id: it.id ?? null,
      name: it.name,
      harga: Number(it.harga||0),
      qty: Number(it.qty||0)
    })),
    subtotal,
    diskon,
    diskonType: state.discountType,
    total,
    cash: state.cash,
    change: Math.max(0, (state.cash||0)-total),
    paymentMethod: paymentMethodEl?.value || 'Cash',          // <— ditambahkan
  };

  // histori lokal (buat dashboard)
  const history = JSON.parse(localStorage.getItem('pos_history') || '[]');
  history.unshift(trx);
  localStorage.setItem('pos_history', JSON.stringify(history));

  // kirim ke backend
  let res = null;
  try { res = await saveTransaction(trx); }
  catch(e){ console.warn('saveTransaction error:', e?.message || e); }

  // tampilkan struk
  showReceipt(trx);

  // update stok (dari backend jika ada; kalau tidak, optimistic)
  if (res && Array.isArray(res.updatedRows)) {
    for (const u of res.updatedRows) {
      const idx = state.products.findIndex(p =>
        (p.id ? p.id === u.id
              : (p.name||'').trim().toLowerCase() === (u.name||'').trim().toLowerCase())
      );
      if (idx >= 0) state.products[idx].stok = Number(u.stok || 0);
    }
  } else {
    for (const it of items) {
      const idx = state.products.findIndex(p =>
        (p.id && p.id===it.id) ||
        (!p.id && p.name===it.name && Number(p.harga)===Number(it.harga))
      );
      if (idx>=0) state.products[idx].stok =
        Math.max(0, Number(state.products[idx].stok||0) - it.qty);
    }
  }

  // reset keranjang
  state.filtered = state.products.filter(p =>
    (p.name||'').toLowerCase().includes((searchInput?.value || '').toLowerCase())
  );
  state.cart.clear(); state.cash = 0; state.discount = 0;
  if (cashInput) cashInput.value = '';
  if (discountInput) discountInput.value = '';
  renderProducts(); renderCart();
}

/* =========================
   STRUK CETAK
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
  const slot = modal.querySelector('.receipt');
  if (slot) slot.innerHTML = html;

  if (typeof modal.showModal === 'function') modal.showModal();
  else modal.classList.add('open');
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
    populateSuggestions(); // refresh datalist kalau ada
    closeAddModal();
    addForm.reset();
  }catch(err){
    alert('Gagal simpan ke Google Sheet: ' + (err?.message || err));
  }
}

/* =========================
   MODAL HELPERS (Add Product)
   ========================= */
// helper: paksa CAPSLOCK (tanpa mindahin caret)
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

  // reset field qty restok + placeholder info stok
  const stokInput = document.getElementById('stokInput');
  if (stokInput) {
    stokInput.value = '';
    stokInput.placeholder = 'Qty Restok (tambah)';
  }

  if (!addModal) return;
  if (typeof addModal.showModal === 'function') addModal.showModal();
  else addModal.classList.add('open');
}

function closeAddModal(){
  if (!addModal) return;
  if (typeof addModal.close === 'function') addModal.close();
  else addModal.classList.remove('open');
}

/* Isi datalist & auto-fill (ID/Nama) + auto CAPS */
function populateSuggestions() {
  // Datalist produk (opsional)
  const productList = document.getElementById('productList');
  if (productList) {
    productList.innerHTML = '';
    for (const p of state.products) {
      const opt = document.createElement('option');
      opt.value = p.name;
      productList.appendChild(opt);
    }
  }

  // Datalist kategori (opsional)
  const kategoriList = document.getElementById('kategoriList');
  if (kategoriList) {
    kategoriList.innerHTML = '';
    const unik = [...new Set(state.products.map(p => p.kategori || 'Lainnya'))];
    for (const c of unik) {
      const opt = document.createElement('option');
      opt.value = c;
      kategoriList.appendChild(opt);
    }
  }

  // refs input
  const idInput       = document.getElementById('idInput');
  const nameInput     = document.getElementById('nameInput');
  const kategoriInput = document.getElementById('kategoriInput');
  const hargaModalInp = document.getElementById('hargaModalInput');
  const hargaInp      = document.getElementById('hargaInput');
  const stokInput     = document.getElementById('stokInput');

  // auto CAPS untuk 3 field
  enforceUppercase(idInput);
  enforceUppercase(nameInput);
  enforceUppercase(kategoriInput);

  // helper isi form penuh dari produk
  function fillFromProduct(p){
    if (!p) return;
    if (idInput)       idInput.value       = (p.id || '').toUpperCase();
    if (nameInput)     nameInput.value     = (p.name || '').toUpperCase();
    if (kategoriInput) kategoriInput.value = (p.kategori || 'Lainnya').toUpperCase();
    if (hargaModalInp) hargaModalInp.value = p.hargaModal || '';
    if (hargaInp)      hargaInp.value      = p.harga || '';
    if (stokInput) {
      // TAMPILKAN sisa stok saat ini + tetap kosongkan kolom qty restok
      stokInput.value = '';
      stokInput.placeholder = `Qty Restok (sisa stok: ${Number(p.stok || 0)})`;
      // Kalau lo MAU diisi otomatis dengan sisa stok saat ini, un-comment baris di bawah:
      // stokInput.value = String(Number(p.stok || 0));
    }
  }

  // Ketik/ubah ID → autofill full
  if (idInput) {
    idInput.onchange = () => {
      const id = (idInput.value || '').trim().toUpperCase();
      const p = state.products.find(x => String(x.id || '').trim().toUpperCase() === id);
      fillFromProduct(p);
    };
  }

  // Pilih/ubah Nama → autofill full (termasuk ID)
  if (nameInput) {
    nameInput.onchange = () => {
      const key = (nameInput.value || '').trim().toLowerCase();
      const p = state.productsByName.get(key);
      fillFromProduct(p);
    };
  }
}

/* =========================
   PRODUCTS
   ========================= */
async function loadProducts(){
  try{
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
    for (const p of state.products) {
      state.productsByName.set((p.name||'').toLowerCase(), p);
    }
    if (itemCount) itemCount.textContent = `${state.products.length} item`;
  }catch(e){
    console.error(e);
    alert('Gagal memuat produk: ' + (e?.message || e));
  }
}

function renderProducts(){
  if (!grid) return;
  grid.innerHTML = '';
  for (const p of state.filtered) grid.appendChild(productCard(p));
}

function productCard(p){
  const stok = Number(p.stok||0);

  const pill = document.createElement('div');
  pill.className = 'pill ' + (stok <= 5 ? (stok<=0?'danger':'warn') : 'ok');
  pill.textContent = `Stok ${stok}`;

  const idpill = document.createElement('div');
  idpill.className = 'pill';
  idpill.textContent = p.id || '-';

  const header = divFlex();
  header.append(idpill, pill);

  const name = document.createElement('div');
  name.className = 'prod-name';
  name.textContent = p.name;

  const price = document.createElement('div');
  price.className = 'prod-price';
  price.textContent = money(p.harga);

  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-add';
  btn.textContent = 'Tambah';
  btn.onclick = () => addToCart(p);

  const card = document.createElement('div');
  card.className = 'card-prod';
  card.append(header, name, price, btn);
  return card;
}

function divFlex(){
  const d = document.createElement('div');
  d.style.display = 'flex';
  d.style.alignItems = 'center';
  d.style.justifyContent = 'space-between';
  return d;
}

/* =========================
   CART
   ========================= */
function addToCart(p){
  const key = keyOf(p);
  const cur = state.cart.get(key) || { ...p, qty: 0 };
  const max = Number(p.stok||Infinity);
  if (cur.qty + 1 > max) return alert('Stok tidak cukup.');
  cur.qty += 1;
  state.cart.set(key, cur);
  renderCart();
}

function inc(key){
  const it = state.cart.get(key); if(!it) return;
  const max = Number(it.stok||Infinity);
  if (it.qty + 1 > max) return;
  it.qty += 1; renderCart();
}

function dec(key){
  const it = state.cart.get(key); if(!it) return;
  it.qty -= 1;
  if (it.qty <= 0) state.cart.delete(key);
  renderCart();
}

function removeItem(key){
  state.cart.delete(key);
  renderCart();
}

function renderCart(){
  if (!cartList) return;
  cartList.innerHTML = '';
  const list = [...state.cart.values()];
  for (const it of list) {
    const key = keyOf(it);
    const row = document.createElement('div');
    row.className = 'cart-row';

    const left = document.createElement('div');
    left.innerHTML = `
      <div style="font-weight:600;">${it.name}</div>
      <div class="muted" style="font-size:12px;">${money(it.harga)}</div>`;

    const lineTotal = document.createElement('div');
    lineTotal.className = 'money strong';
    lineTotal.textContent = money(it.harga * it.qty);

    const qty = document.createElement('div'); qty.className = 'qty';
    const bDec = document.createElement('button');
    bDec.className='btn'; bDec.textContent='–';
    bDec.onclick = () => dec(key);

    const qv = document.createElement('div');
    qv.style.minWidth='24px';
    qv.style.textAlign='center';
    qv.textContent = it.qty;

    const bInc = document.createElement('button');
    bInc.className='btn'; bInc.textContent='+';
    bInc.onclick = () => inc(key);

    qty.append(bDec, qv, bInc);

    const del = document.createElement('button');
    del.className = 'btn btn-trash';
    del.innerHTML = '🗑️';
    del.title = 'Hapus';
    del.onclick = () => removeItem(key);

    row.append(left, qty, lineTotal, del);
    cartList.appendChild(row);
  }
  updateSummary();
}

/* =========================
   DASHBOARD (server-first)
   ========================= */
async function loadDashboard(){
  // 1) Coba ambil KPI akurat dari backend (Transaksi!A:P + FIFO)
  try {
    const s = await getStats30d(); // { ok, profitToday, omzetToday, hppToday, countToday, profit30, omzet30, hpp30, trend }
    if (s && (s.ok || typeof s.profitToday === 'number')) {
      if (elProfitToday) elProfitToday.textContent = money(s.profitToday || 0);
      if (elOmzetToday)  elOmzetToday.textContent  = money(s.omzetToday  || 0);
      if (elHppToday)    elHppToday.textContent    = money(s.hppToday    || 0);
      if (elCountToday)  elCountToday.textContent  = String(s.countToday || 0);

      if (elProfit30) elProfit30.textContent = money(s.profit30 || 0);
      if (elOmzet30)  elOmzet30.textContent  = money(s.omzet30  || 0);
      if (elHpp30)    elHpp30.textContent    = money(s.hpp30    || 0);

      drawProfitChart(Array.isArray(s.trend) ? s.trend : []);
    } else {
      console.warn('getStats30d payload tidak sesuai, pakai fallback lokal');
      await loadDashboardLocalFallback();
    }
  } catch (e) {
    console.warn('getStats30d gagal, pakai fallback lokal:', e?.message || e);
    await loadDashboardLocalFallback();
  }

  // 2) Bagian ini tetap dari data lokal (ringan & cukup)
  updateTopCategoryAndLowStock();
  updateRecentList();
}

// === Fallback lama (offline / bila backend error)
async function loadDashboardLocalFallback(){
  const hist = JSON.parse(localStorage.getItem('pos_history')||'[]');

  const modalOf = name => (state.productsByName.get(String(name||'').toLowerCase())?.hargaModal) || 0;

  const now = new Date();
  const start = new Date(now); start.setDate(now.getDate()-29); start.setHours(0,0,0,0);
  const byDay = new Map();
  let profit30=0, omzet30=0, hpp30=0, countToday=0, omzetToday=0, hppToday=0, profitToday=0;
  const today = todayStr();

  for (const trx of hist) {
    const d = trx.tanggal;
    if (!byDay.has(d)) byDay.set(d, { omzet:0, hpp:0, profit:0, count:0 });
    const rec = byDay.get(d);
    let tOmzet=0, tHpp=0;
    for (const it of (trx.transaksi||[])) {
      const omz = Number(it.harga||0)*Number(it.qty||0);
      const hpp = Number(modalOf(it.name)||0) * Number(it.qty||0);
      tOmzet += omz; tHpp += hpp;
    }
    rec.omzet += tOmzet; rec.hpp += tHpp;
    rec.profit += (tOmzet - tHpp - (trx.diskon||0));
    rec.count += 1;

    const dt = parseIdDate(d);
    if (dt >= start && dt <= now) {
      omzet30 += tOmzet; hpp30 += tHpp; profit30 += (tOmzet - tHpp - (trx.diskon||0));
    }
    if (d === today) {
      countToday += 1; omzetToday += tOmzet; hppToday += tHpp; profitToday += (tOmzet - tHpp - (trx.diskon||0));
    }
  }

  if (elProfitToday) elProfitToday.textContent = money(profitToday);
  if (elOmzetToday)  elOmzetToday.textContent  = money(omzetToday);
  if (elHppToday)    elHppToday.textContent    = money(hppToday);
  if (elCountToday)  elCountToday.textContent  = String(countToday);

  if (elProfit30) elProfit30.textContent = money(profit30);
  if (elOmzet30)  elOmzet30.textContent  = money(omzet30);
  if (elHpp30)    elHpp30.textContent    = money(hpp30);

  const trend = [];
  for (let i=29;i>=0;i--){
    const d = new Date(now); d.setDate(now.getDate()-i);
    const key = d.toLocaleDateString('id-ID');
    const rec = byDay.get(key) || {profit:0};
    trend.push({ date:key, profit: rec.profit||0 });
  }
  drawProfitChart(trend);
}

// ——— Bagian pendukung (kategori & stok tipis & transaksi terbaru) tetap dari lokal
function updateTopCategoryAndLowStock(){
  const catAgg = new Map();
  const hist = JSON.parse(localStorage.getItem('pos_history')||'[]');
  const modalOf = name => (state.productsByName.get(String(name||'').toLowerCase())?.hargaModal) || 0;
  const catOf   = name => (state.productsByName.get(String(name||'').toLowerCase())?.kategori)   || 'Lainnya';

  for (const trx of hist) {
    for (const it of (trx.transaksi||[])) {
      const cat = catOf(it.name);
      const omz = Number(it.harga||0) * Number(it.qty||0);
      const hpp = Number(modalOf(it.name)||0) * Number(it.qty||0);
      catAgg.set(cat, (catAgg.get(cat)||0) + (omz - hpp));
    }
  }

  if (catList){
    catList.innerHTML = '';
    const cats = [...catAgg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
    if (!cats.length) catList.innerHTML = `<div class="muted">Belum ada data kategori.</div>`;
    else for (const [name,val] of cats) {
      const row = document.createElement('div'); row.className='row';
      row.innerHTML = `<div>${name}</div><div class="money strong">${money(val)}</div>`;
      catList.appendChild(row);
    }
  }

  const lowStock = state.products.filter(p => Number(p.stok||0) <= 5);
  if (lowStockList){
    lowStockList.innerHTML = '';
    if (!lowStock.length) lowStockList.innerHTML = `<div class="muted">Semua stok aman.</div>`;
    else for (const p of lowStock) {
      const row = document.createElement('div'); row.className='row';
      row.innerHTML = `<div>${p.name}</div><div class="badge">Sisa: ${p.stok}</div>`;
      lowStockList.appendChild(row);
    }
  }
}

function updateRecentList(){
  const hist = JSON.parse(localStorage.getItem('pos_history')||'[]');
  if (!recentList) return;
  recentList.innerHTML = '';
  for (const h of hist.slice(0,6)) {
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `
      <div>
        <div class="strong">${h.transactionId}</div>
        <div class="muted">${h.tanggal} ${h.waktu} • ${h.transaksi?.length||0} item</div>
      </div>
      <div class="strong money">${money(h.total || (h.subtotal - (h.diskon||0)))}</div>`;
    recentList.appendChild(it);
  }
}

// ——— Tetap pakai util ini (tanpa perubahan)
function parseIdDate(str){
  const [d,m,y] = String(str||'').split('/').map(n=>parseInt(n,10));
  const dt = new Date(y || 1970, (m||1)-1, d||1); dt.setHours(0,0,0,0); return dt;
}

function drawProfitChart(points){
  if (!profitChart) return;
  if (!chartCtx) chartCtx = profitChart.getContext('2d');
  const W = profitChart.width = profitChart.clientWidth;
  const H = profitChart.height;
  chartCtx.clearRect(0,0,W,H);

  const values = points.map(p=>p.profit);
  const max = Math.max(1, ...values);
  const pad = 10;
  const stepX = (W - pad*2) / Math.max(1, points.length-1);

  chartCtx.beginPath();
  points.forEach((p,i)=>{
    const x = pad + i*stepX;
    const y = H - pad - (p.profit/max)*(H-pad*2);
    if (i===0) chartCtx.moveTo(x,y);
    else chartCtx.lineTo(x,y);
  });
  chartCtx.lineTo(W-pad, H-pad);
  chartCtx.lineTo(pad, H-pad);
  chartCtx.closePath();
  chartCtx.fillStyle = 'rgba(37, 99, 235, .12)';
  chartCtx.fill();

  chartCtx.beginPath();
  points.forEach((p,i)=>{
    const x = pad + i*stepX;
    const y = H - pad - (p.profit/max)*(H-pad*2);
    if (i===0) chartCtx.moveTo(x,y);
    else chartCtx.lineTo(x,y);
  });
  chartCtx.strokeStyle = '#2563EB';
  chartCtx.lineWidth = 2;
  chartCtx.stroke();
}

