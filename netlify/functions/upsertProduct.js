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

function guessCategory(name) {
  const s = String(name || '').toLowerCase();
  if (/(beras|pandan|rojolele)/.test(s)) return 'Beras';
  if (/(gula)/.test(s)) return 'Gula';
  if (/(minyak|goreng)/.test(s)) return 'Minyak Goreng';
  if (/(mie|indomie|sarimi)/.test(s)) return 'Mie Instan';
  if (/(aqua|le minerale|air|teh|kopi|susu|minuman|teh botol)/.test(s)) return 'Minuman';
  if (/(biskuit|snack|roti|wafer|cokelat)/.test(s)) return 'Snack & Roti';
  if (/(kecap|saus|sambal|bumbu|masako|royco)/.test(s)) return 'Bumbu & Saus';
  if (/(makanan kaleng|sarden|kornet|sosis)/.test(s)) return 'Makanan Kemasan';
  if (/(sabun|shampoo|odol|pasta gigi|tissue)/.test(s)) return 'Perawatan Diri';
  if (/(detergen|rinso|pel|pembersih|baygon|sunlight)/.test(s)) return 'Kebersihan Rumah';
  if (/(pulpen|buku|atk|pensil)/.test(s)) return 'ATK';
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
    throw new Error(
      'Missing env GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID'
    );
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK };
}

function colIndex(header, aliases, dflt) {
  const low = header.map((h) => norm(h));
  for (const a of aliases) {
    const i = low.indexOf(a);
    if (i !== -1) return i;
  }
  return dflt;
}
const toCol = (idx) => {
  let n = idx + 1, s = '';
  while (n) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return err(new Error('Method Not Allowed'), 405);

  try {
    const body = JSON.parse(event.body || '{}');
    let { id, name, harga, hargaModal, stok, kategori } = body;
    if (!name) return err(new Error('name wajib'), 400);

    harga = parseNum(harga);
    hargaModal = parseNum(hargaModal);
    stok = parseNum(stok);

    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK } = getEnv();

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
    });

    const rows = data.values || [];
    const [header = [], ...bodyRows] = rows;

    const cId = colIndex(header, ['id', 'kode', 'sku'], 0);
    const cName = colIndex(header, ['produk', 'name', 'nama', 'product'], 1);
    const cKat = colIndex(header, ['kategori', 'category'], 2);
    const cModal = colIndex(header, ['hargamodal', 'modal', 'hpp', 'cost'], 3);
    const cJual = colIndex(header, ['hargajual', 'jual', 'price', 'harga'], 4);
    const cStok = colIndex(header, ['stok', 'stock'], 5);
    const lastIdx = Math.max(cId, cName, cKat, cModal, cJual, cStok);
    const lastL = toCol(lastIdx);

    const idx = bodyRows.findIndex((r) => norm(r[cName]) === norm(name));

    if (idx >= 0) {
      // Restock/update existing row
      const rowNum = idx + 2;
      const row = bodyRows[idx] || [];
      const curId = row[cId] || id || '';
      const curStok = parseNum(row[cStok]);
      const curModal = parseNum(row[cModal]);
      const addStok = stok || 0;

      const newStok = curStok + addStok;

      // Weighted average for modal (HPP)
      const newModal =
        newStok > 0
          ? Math.round(((curStok * curModal) + (addStok * (hargaModal || curModal))) / newStok)
          : (hargaModal || curModal);

      const newJual = harga || parseNum(row[cJual]);
      const newKat = kategori || row[cKat] || guessCategory(name);

      const arr = new Array(lastIdx + 1).fill('');
      arr[cId] = curId || id || `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      arr[cName] = name;
      arr[cKat] = newKat;
      arr[cModal] = isNaN(newModal) ? curModal : newModal;
      arr[cJual] = newJual;
      arr[cStok] = newStok;

      await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_PRODUK}!A${rowNum}:${lastL}${rowNum}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [arr] },
      });

      return ok({
        ok: true,
        mode: 'restock',
        id: arr[cId],
        name,
        kategori: newKat,
        after: newStok,
        harga: newJual,
        hargaModal: arr[cModal],
      });
    }

    // Append new product
    const newRow = new Array(lastIdx + 1).fill('');
    newRow[cId] = id || `P${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    newRow[cName] = name;
    newRow[cKat] = kategori || guessCategory(name);
    newRow[cModal] = hargaModal || 0;
    newRow[cJual] = harga || 0;
    newRow[cStok] = stok || 0;

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [newRow] },
    });

    return ok({
      ok: true,
      mode: 'append',
      id: newRow[cId],
      name,
      kategori: newRow[cKat],
      after: newRow[cStok],
      harga: newRow[cJual],
      hargaModal: newRow[cModal],
    });
  } catch (e) {
    return err(e);
  }
};
