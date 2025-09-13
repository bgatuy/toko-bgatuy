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
  const SHEET_TRANSAKSI = process.env.GOOGLE_SHEET_TRANSAKSI || 'Transaksi';

  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error(
      'Missing env GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID'
    );
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_TRANSAKSI };
}

function colIndex(header, aliases, dflt) {
  const low = header.map((h) => norm(h));
  for (const a of aliases) {
    const i = low.indexOf(a);
    if (i !== -1) return i;
  }
  return dflt;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return err(new Error('Method Not Allowed'), 405);

  try {
    const trx = JSON.parse(event.body || '{}');
    const items = Array.isArray(trx.transaksi) ? trx.transaksi : [];
    if (!items.length) return err(new Error('transaksi kosong'), 400);

    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_TRANSAKSI } = getEnv();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Ambil Produk untuk map harga modal & kategori
    const prodRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
    });
    const rows = prodRes.data.values || [];
    const [header = [], ...body] = rows;

    const cName = colIndex(header, ['produk', 'name', 'nama', 'product'], 1);
    const cKat = colIndex(header, ['kategori', 'category'], 2);
    const cModal = colIndex(header, ['hargamodal', 'modal', 'hpp', 'cost'], 3);

    const mapModal = new Map();
    const mapKat = new Map();
    for (const r of body) {
      const nm = r[cName]; if (!nm) continue;
      mapModal.set(nm.toLowerCase(), parseNum(r[cModal]));
      mapKat.set(nm.toLowerCase(), r[cKat] || 'Lainnya');
    }

    // Siapkan baris transaksi
    // Format kolom (sesuai screenshot kamu):
    // TransactionID | Tanggal | Waktu | Produk | Kategori | Harga Jual | Harga Modal | Qty | Omzet | HPP | Laba | Tunai | Kembali
    const values = [];
    let totalOmzet = 0, totalHpp = 0;

    for (const it of items) {
      const nm = String(it.name || '');
      const harga = parseNum(it.harga);
      const qty = parseNum(it.qty);

      const modal = mapModal.get(nm.toLowerCase()) || 0;
      const kat = mapKat.get(nm.toLowerCase()) || 'Lainnya';
      const omzet = harga * qty;
      const hpp = modal * qty;
      const laba = omzet - hpp;

      totalOmzet += omzet;
      totalHpp += hpp;

      values.push([
        trx.transactionId || '',
        trx.tanggal || '',
        trx.waktu || '',
        nm,
        kat,
        harga,
        modal,
        qty,
        omzet,
        hpp,
        laba,
        trx.cash || '',
        trx.change || '',
      ]);
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TRANSAKSI}!A:N`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    return ok({
      ok: true,
      count: values.length,
      totalOmzet,
      totalHpp,
      totalProfit: totalOmzet - totalHpp,
    });
  } catch (e) {
    return err(e);
  }
};
