import { fetchProducts, saveTransaction, upsertProduct, getStats30d } from './assets/api.js'

/* =========================
   STATE & HELPERS
   ========================= */
const state = {
  products: [],
  productsByName: new Map(), // name -> product (utk kategori/hargaModal)
  filtered: [],
  cart: new Map(), // key -> {id,name,harga,qty,stok}
  cash: 0,
};

const money   = n => `Rp ${Number(n||0).toLocaleString('id-ID')}`;
const parseNum = s => Number(String(s||'').replace(/[^\d]/g,'')||0);
const uid      = () => Math.random().toString(36).slice(2,8).toUpperCase();
const keyOf    = p => p.id || `${p.name}|${p.harga}`;
const todayStr = () => new Date().toLocaleDateString('id-ID');

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

const addModal   = document.getElementById('addModal');
const addForm    = document.getElementById('addForm');
document.getElementById('btn-open-add').onclick = () => { populateSuggestions(); addModal.showModal(); }
document.getElementById('btnCloseAdd').onclick   = () => addModal.close();

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
init();

async function init(){
  router('pos');
  attachEvents();
  await loadProducts();
  renderProducts();
  renderCart();
  await loadDashboard(); // biar saat buka tab dashboard langsung siap
}

/* =========================
   EVENTS
   ========================= */
function attachEvents(){
  // tabs
  tabPos.onclick  = () => router('pos');
  tabDash.onclick = () => router('dashboard');

  // search
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase();
    state.filtered = state.products.filter(p => (p.name||'').toLowerCase().includes(q));
    renderProducts();
  });

  // cash
  cashInput.addEventListener('input', () => {
    state.cash = parseNum(cashInput.value);
    updateSummary();
  });

  // add product form
  addForm.addEventListener('submit', onSaveProduct);

  // finish
  btnFinish.addEventListener('click', onFinish);

  // reset local history
  btnResetLocal.addEventListener('click', () => {
    if (!confirm('Hapus histori lokal? Data di Google Sheet tetap aman.')) return;
    localStorage.removeItem('pos_history');
    loadDashboard();
  });
}

/* =========================
   ROUTER
   ========================= */
function router(view){
  const isDash = view === 'dashboard';
  (isDash ? tabDash : tabPos).classList.add('tab-active');
  (isDash ? tabPos  : tabDash).classList.remove('tab-active');

  if (isDash){
    viewDashboard.classList.remove('hidden');
    viewPos.classList.add('hidden');
    loadDashboard(); // refresh setiap kali masuk dashboard
  } else {
    viewPos.classList.remove('hidden');
    viewDashboard.classList.add('hidden');
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
    }));
    state.filtered = state.products.slice();
    state.productsByName.clear();
    for (const p of state.products) state.productsByName.set(p.name.toLowerCase(), p);
    itemCount.textContent = `${state.products.length} item`;
  }catch(e){
    console.error(e);
    alert('Gagal memuat produk: ' + e.message);
  }
}

function renderProducts(){
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
  name.className = 'prod-name'; name.textContent = p.name;

  const price = document.createElement('div');
  price.className = 'prod-price'; price.textContent = money(p.harga);

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
  it.qty -= 1; if (it.qty <= 0) state.cart.delete(key);
  renderCart();
}
function removeItem(key){
  state.cart.delete(key); renderCart();
}

function renderCart(){
  cartList.innerHTML = '';
  const list = [...state.cart.values()];
  for (const it of list) {
    const key = keyOf(it);
    const row = document.createElement('div');
    row.className = 'cart-row';

    const left = document.createElement('div');
    left.innerHTML = `<div style="font-weight:600;">${it.name}</div>
                      <div class="muted" style="font-size:12px;">${money(it.harga)}</div>`;

    const lineTotal = document.createElement('div');
    lineTotal.className = 'money strong';
    lineTotal.textContent = money(it.harga * it.qty);

    const qty = document.createElement('div'); qty.className = 'qty';
    const bDec = document.createElement('button'); bDec.className='btn'; bDec.textContent='–'; bDec.onclick = () => dec(key);
    const qv = document.createElement('div'); qv.style.minWidth='24px'; qv.style.textAlign='center'; qv.textContent = it.qty;
    const bInc = document.createElement('button'); bInc.className='btn'; bInc.textContent='+'; bInc.onclick = () => inc(key);
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

function calcSubtotal(){
  let s = 0;
  for (const it of state.cart.values()) s += Number(it.harga||0) * Number(it.qty||0);
  return s;
}

function updateSummary(){
  const subtotal = calcSubtotal();
  const total = subtotal;
  const change = Math.max(0, (state.cash||0) - total);
  subtotalEl.textContent = money(subtotal);
  totalEl.textContent = money(total);
  changeEl.textContent = money(change);
  btnFinish.disabled = !(total>0 && (state.cash||0) >= total);
}

/* =========================
   FINISH/CETAK
   ========================= */
async function onFinish(){
  const items = [...state.cart.values()];
  if (!items.length) return alert('Keranjang kosong.');
  const total = calcSubtotal();
  if ((state.cash||0) < total) return alert('Uang tunai kurang.');

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
    total,
    cash: state.cash,
    change: Math.max(0, (state.cash||0)-total),
  };

  // histori lokal
  const history = JSON.parse(localStorage.getItem('pos_history')||'[]');
  history.unshift(trx);
  localStorage.setItem('pos_history', JSON.stringify(history));

  // kirim ke backend
  let res = null;
  try { res = await saveTransaction(trx); }
  catch(e){ console.warn('saveTransaction error:', e.message); }

  // cetak struk
  const str = buildReceipt(trx);
  const w = window.open('', '_blank', 'width=400,height=600');
  w.document.write(`<pre style="font:14px/1.25 monospace;white-space:pre-wrap">${str}</pre>`);
  w.document.close(); w.focus(); w.print();

  // sync stok dari server
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

  state.filtered = state.products.filter(p =>
    (p.name||'').toLowerCase().includes(searchInput.value.toLowerCase())
  );
  state.cart.clear(); state.cash = 0; cashInput.value = '';
  renderProducts(); renderCart();
}

function buildReceipt(trx){
  const W=40, line='-'.repeat(W), money2 = n => `Rp ${Number(n||0).toLocaleString('id-ID')}`;
  let body = '';
  for (const it of trx.transaksi){
    const sub = money2(it.harga*it.qty), left = `${it.qty} x ${money2(it.harga)}`;
    const pad = Math.max(1, W - left.length - sub.length);
    body += `${it.name}\n${left}${' '.repeat(pad)}${sub}\n`;
  }
  const padR = (label,val)=>`${label}${' '.repeat(Math.max(1,W-label.length-val.length))}${val}`;
  return [
    'TOKO BG ATUY','Jl. Jalanin Aja Dulu', line,
    `Tanggal : ${trx.tanggal}`,
    `Waktu   : ${trx.waktu}`,
    `ID      : ${trx.transactionId}`,
    line, body.trim(), line,
    padR('Total',   money2(trx.total)),
    padR('Tunai',   money2(trx.cash)),
    padR('Kembali', money2(trx.change)),
    line, 'Terima kasih :)',
  ].join('\n');
}

/* =========================
   ADD/UPSERT PRODUK
   ========================= */
async function onSaveProduct(e){
  e.preventDefault();
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
    const idx = state.products.findIndex(p => p.name.toLowerCase()===payload.name.toLowerCase());
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
    for (const p of state.products) state.productsByName.set(p.name.toLowerCase(), p);

    state.filtered = state.products.filter(p => (p.name||'').toLowerCase().includes(searchInput.value.toLowerCase()));
    renderProducts();
    populateSuggestions();
    addModal.close(); addForm.reset();
  }catch(err){
    alert('Gagal simpan ke Google Sheet: ' + err.message);
  }
}

/* =========================
   SUGGESTIONS (Produk & Kategori)
   ========================= */
function populateSuggestions() {
  const productList   = document.getElementById('productList');
  const kategoriList  = document.getElementById('kategoriList');
  const nameInput     = document.getElementById('nameInput');
  const kategoriInput = document.getElementById('kategoriInput');
  const hargaModalInp = document.getElementById('hargaModalInput');
  const hargaInp      = document.getElementById('hargaInput');

  productList.innerHTML = '';
  for (const p of state.products) {
    const opt = document.createElement('option');
    opt.value = p.name;
    productList.appendChild(opt);
  }

  const unik = [...new Set(state.products.map(p => p.kategori || 'Lainnya'))];
  kategoriList.innerHTML = '';
  for (const c of unik) {
    const opt = document.createElement('option');
    opt.value = c;
    kategoriList.appendChild(opt);
  }

  nameInput.addEventListener('change', () => {
    const nama = nameInput.value.trim().toLowerCase();
    const p = state.productsByName.get(nama);
    if (p) {
      kategoriInput.value  = p.kategori || '';
      hargaModalInp.value  = p.hargaModal || '';
      hargaInp.value       = p.harga || '';
    }
  });
}

/* =========================
   DASHBOARD
   ========================= */
async function loadDashboard(){
  const hist = JSON.parse(localStorage.getItem('pos_history')||'[]');

  const modalOf = name => (state.productsByName.get(String(name||'').toLowerCase())?.hargaModal) || 0;
  const catOf   = name => (state.productsByName.get(String(name||'').toLowerCase())?.kategori)   || 'Lainnya';

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
    rec.omzet += tOmzet; rec.hpp += tHpp; rec.profit += (tOmzet - tHpp); rec.count += 1;

    const dt = parseIdDate(d);
    if (dt >= start && dt <= now) {
      omzet30 += tOmzet; hpp30 += tHpp; profit30 += (tOmzet - tHpp);
    }
    if (d === today) {
      countToday += 1; omzetToday += tOmzet; hppToday += tHpp; profitToday += (tOmzet - tHpp);
    }
  }

  const catAgg = new Map();
  for (const trx of hist) {
    for (const it of (trx.transaksi||[])) {
      const cat = catOf(it.name);
      const omz = Number(it.harga||0) * Number(it.qty||0);
      const hpp = Number(modalOf(it.name)||0) * Number(it.qty||0);
      const profit = omz - hpp;
      catAgg.set(cat, (catAgg.get(cat)||0) + profit);
    }
  }

  const lowStock = state.products.filter(p => Number(p.stok||0) <= 5);

  elProfitToday.textContent = money(profitToday);
  elOmzetToday.textContent  = money(omzetToday);
  elHppToday.textContent    = money(hppToday);
  elCountToday.textContent  = String(countToday);

  elProfit30.textContent = money(profit30);
  elOmzet30.textContent  = money(omzet30);
  elHpp30.textContent    = money(hpp30);

  const trend = [];
  for (let i=29;i>=0;i--){
    const d = new Date(now); d.setDate(now.getDate()-i);
    const key = d.toLocaleDateString('id-ID');
    const rec = byDay.get(key) || {profit:0};
    trend.push({ date:key, profit: rec.profit||0 });
  }
  drawProfitChart(trend);

  catList.innerHTML = '';
  const cats = [...catAgg.entries()].sort((a,b)=>b[1]-a[1]).slice(0,6);
  if (!cats.length) catList.innerHTML = `<div class="muted">Belum ada data kategori.</div>`;
  else for (const [name,val] of cats) {
    const row = document.createElement('div'); row.className='row';
    row.innerHTML = `<div>${name}</div><div class="money strong">${money(val)}</div>`;
    catList.appendChild(row);
  }

  lowStockList.innerHTML = '';
  if (!lowStock.length) lowStockList.innerHTML = `<div class="muted">Semua stok aman.</div>`;
  else for (const p of lowStock) {
    const row = document.createElement('div'); row.className='row';
    row.innerHTML = `<div>${p.name}</div><div class="badge">Sisa: ${p.stok}</div>`;
    lowStockList.appendChild(row);
  }

  recentList.innerHTML = '';
  for (const h of hist.slice(0,6)) {
    const it = document.createElement('div'); it.className='item';
    it.innerHTML = `
      <div>
        <div class="strong">${h.transactionId}</div>
        <div class="muted">${h.tanggal} ${h.waktu} • ${h.transaksi?.length||0} item</div>
      </div>
      <div class="strong money">${money(h.total)}</div>`;
    recentList.appendChild(it);
  }
}

function parseIdDate(str){
  const [d,m,y] = str.split('/').map(n=>parseInt(n,10));
  const dt = new Date(y, (m-1), d); dt.setHours(0,0,0,0); return dt;
}

function drawProfitChart(points){
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
