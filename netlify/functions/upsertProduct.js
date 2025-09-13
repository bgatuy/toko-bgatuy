// functions/upsertProduct.js
const { google } = require('googleapis');

const ok = (data) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(data),
});
const err = (e, code = 500) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ ok: false, error: e.message || String(e) }),
});

const parseNum = (v) => Number(String(v ?? '').replace(/[^\d.-]/g, '')) || 0;
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
const toCol = (idx) => { let n = idx + 1, s = ''; while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; };

function guessCategory(name) {
  const s = String(name || '').toLowerCase();
  if (/(beras)/.test(s)) return 'Beras';
  return 'Lainnya';
}

function getEnv() {
  const SERVICE_EMAIL =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_SERVICE_EMAIL;

  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const SPREADSHEET_ID =
    process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID;

  const SHEET_PRODUK = process.env.GOOGLE_SHEET_PRODUK || 'Produk';
  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error('Missing env GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID');
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK };
}

function colIndex(header, aliases, dflt) {
  const low = (header || []).map((h) => norm(h));

  // 1) exact match dulu
  for (const a of aliases) {
    const i = low.indexOf(a);
    if (i !== -1) return i;
  }
  // 2) fallback: fuzzy "mengandung"
  for (let k = 0; k < low.length; k++) {
    const h = low[k]; if (!h) continue;
    if (aliases.some(a => h.includes(a))) return k;
  }
  return dflt;
}


// Weighted average modal; kalau modal/stock lama 0 → pakai modal baru
function computeNewModal(curModal, curStok, addModal, addStok) {
  curModal = parseNum(curModal);
  curStok  = parseNum(curStok);
  addModal = parseNum(addModal);
  addStok  = parseNum(addStok);
  if (addStok <= 0) return curModal;
  if (addModal > 0 && curStok > 0 && curModal > 0) {
    return Math.round(((curStok * curModal) + (addStok * addModal)) / (curStok + addStok));
  }
  return addModal > 0 ? addModal : curModal;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST')   return err(new Error('Method Not Allowed'), 405);

  try {
    const body = JSON.parse(event.body || '{}');
    let { id, name, harga, hargaModal, stok, kategori } = body;
    if (!name) return err(new Error('name wajib'), 400);

    harga      = parseNum(harga);
    hargaModal = parseNum(hargaModal);
    stok       = parseNum(stok);

    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK } = getEnv();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Ambil sheet Produk
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
    });
    const rows = data.values || [];
    const [header = [], ...bodyRows] = rows;

    // Map kolom — A:Produk B:Kategori C:Harga Modal D:Harga Jual E:Stok
    const cId    = colIndex(header, ['id','kode','sku'], -1);
    const cName  = colIndex(header, ['produk','product','name','nama'], 0);
    const cKat   = colIndex(header, ['kategori','category'], 1);
    const cModal = colIndex(header, ['harga modal','hargamodal','modal','hpp','cost'], 2);
    const cJual  = colIndex(header, ['harga jual','hargajual','jual','price','harga'], 3);
    const cStok  = colIndex(header, ['stok','stock'], 4);

    // Guard kalau header sheet beda
    if (cModal < 0) return err(new Error('Kolom "Harga Modal" tidak ditemukan di sheet Produk'), 400);
    if (cJual  < 0) return err(new Error('Kolom "Harga Jual" tidak ditemukan di sheet Produk'), 400);
    if (cStok  < 0) return err(new Error('Kolom "Stok" tidak ditemukan di sheet Produk'), 400);

    const katCol  = toCol(cKat);
    const modalCol= toCol(cModal);
    const jualCol = toCol(cJual);
    const stokCol = toCol(cStok);

    // Cari baris produk by name
    const idx = bodyRows.findIndex((r) => norm(r[cName]) === norm(name));

    if (idx >= 0) {
      // ===== RESTOCK / UPDATE =====
      const rowNum   = idx + 2;
      const row      = bodyRows[idx] || [];
      const curStok  = parseNum(row[cStok]);
      const curModal = parseNum(row[cModal]);

      const addStok  = stok || 0;
const newStok  = curStok + addStok;

// PRIORITAS: kalau user isi hargaModal > 0, PAKAI itu.
// Kalau kosong (0), dan addStok > 0 serta curModal > 0 → boleh average.
// Selain itu: biarin curModal (nggak pakai 0).
let newModal;
if (parseNum(hargaModal) > 0) {
  newModal = parseNum(hargaModal);
} else if (addStok > 0 && parseNum(curModal) > 0) {
  newModal = computeNewModal(curModal, curStok, curModal, addStok); // average trivially = curModal
} else {
  newModal = curModal;
}

const newJual  = (parseNum(harga) > 0) ? parseNum(harga) : parseNum(row[cJual]);

      const newKat   = kategori || row[cKat] || guessCategory(name);

      // Update PER-SEL
      const updates = [
        { range: `${SHEET_PRODUK}!${modalCol}${rowNum}:${modalCol}${rowNum}`, values: [[ newModal ]] },
        { range: `${SHEET_PRODUK}!${jualCol}${rowNum}:${jualCol}${rowNum}`,   values: [[ newJual  ]] },
        { range: `${SHEET_PRODUK}!${stokCol}${rowNum}:${stokCol}${rowNum}`,   values: [[ newStok  ]] },
      ];
      if (newKat !== (row[cKat] || '')) {
        updates.push({ range: `${SHEET_PRODUK}!${katCol}${rowNum}:${katCol}${rowNum}`, values: [[ newKat ]] });
      }

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updates }, // RAW = angka apa adanya
      });

      return ok({ ok:true, mode:'restock', name, kategori:newKat, after:newStok, harga:newJual, hargaModal:newModal, id: (cId>=0 ? (row[cId]||null) : null) });
    }

    // ===== APPEND BARU =====
    const newKat = kategori || guessCategory(name);
    const newRow = [];
    newRow[cName]  = name;
    newRow[cKat]   = newKat;
    newRow[cModal] = hargaModal;
    newRow[cJual]  = harga;
    newRow[cStok]  = stok;
    if (cId >= 0) newRow[cId] = id || `P${Math.random().toString(36).slice(2,8).toUpperCase()}`;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] },
    });

    return ok({ ok:true, mode:'append', name, kategori:newKat, after:newRow[cStok]||0, harga:newRow[cJual]||0, hargaModal:newRow[cModal]||0, id:(cId>=0?newRow[cId]:null) });
  } catch (e) {
    return err(e);
  }
};
