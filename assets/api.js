// /assets/api.js

// ====== BASE detection (dev/prod) ======
// Urutan prioritas:
// 1) window.__API_BASE__ kalau diset manual
// 2) '/api' (pakai Netlify Redirect)
// 3) '/.netlify/functions' (direct ke Functions)
const BASE_CANDIDATES = [
  typeof window !== 'undefined' && window.__API_BASE__ ? window.__API_BASE__ : '/api',
  '/.netlify/functions',
];

// Helper timeout pakai AbortController
function withTimeout(ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(id) };
}

// Coba fetch ke beberapa BASE sampai sukses
async function fetchTryAll(path, opts) {
  let lastErr;
  for (const base of BASE_CANDIDATES) {
    const url = path.startsWith('http') ? path : `${base}${path}`;
    const to = withTimeout(15000);
    try {
      const res = await fetch(url, { ...opts, signal: to.signal });
      to.cancel();
      return { res, baseUsed: base };
    } catch (e) {
      to.cancel();
      lastErr = e;
      // lanjut coba base berikutnya
    }
  }
  throw lastErr || new Error('Network error');
}

// Parse JSON aman (kalau bukan JSON, balikin objek kosong biar gak meledak)
async function parseJSONSafe(res) {
  const text = await res.text();
  try { return text ? JSON.parse(text) : {}; }
  catch { return {}; }
}

// Wrapper utama
async function fetchJSON(path, opts) {
  const { res, baseUsed } = await fetchTryAll(path, opts);
  const json = await parseJSONSafe(res);

  if (!res.ok || json?.ok === false) {
    // Munculin pesan paling berguna
    const msg = json?.error || json?.message || res.statusText || `HTTP ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.baseUsed = baseUsed;
    throw err;
  }
  return json;
}

// ====== PUBLIC API ======
export async function fetchProducts() {
  // GET /getProducts
  return fetchJSON('/getProducts', { method: 'GET' });
}

export async function upsertProduct(payload) {
  // POST /upsertProduct
  return fetchJSON('/upsertProduct', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function saveTransaction(trx) {
  // POST /saveTransaction
  return fetchJSON('/saveTransaction', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trx),
  });
}

// Opsional statistik 30 hari (GET /getStats)
export async function getStats30d() {
  return fetchJSON('/getStats', { method: 'GET' });
}
