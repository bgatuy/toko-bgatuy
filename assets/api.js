// /assets/api.js
// Ganti BASE sesuai hosting kamu. Untuk Netlify pakai redirect /api -> /.netlify/functions
const BASE = '/api';

async function fetchJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text || '{}'); } catch { json = {}; }
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || res.statusText || 'HTTP error');
  }
  return json;
}

export async function fetchProducts() {
  return fetchJSON(`${BASE}/getProducts`, { method: 'GET' });
}

export async function upsertProduct(payload) {
  return fetchJSON(`${BASE}/upsertProduct`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function saveTransaction(trx) {
  return fetchJSON(`${BASE}/saveTransaction`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(trx),
  });
}

// Optional (kalau kamu punya)
export async function getStats30d() {
  return fetchJSON(`${BASE}/getStats`, { method: 'GET' });
}
