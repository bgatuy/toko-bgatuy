const { google } = require('googleapis');

/* ===== Helpers ===== */
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

function colIndex(header, aliases, dflt) {
  const low = header.map((h) => norm(h));
  for (const a of aliases) {
    const i = low.indexOf(a);
    if (i !== -1) return i;
  }
  return dflt;
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

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'GET') return err(new Error('Method Not Allowed'), 405);

  try {
    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK } = getEnv();

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
    });

    const rows = data.values || [];
    if (!rows.length) return ok([]);

    const [header = [], ...body] = rows;

    const cId = colIndex(header, ['id', 'kode', 'sku'], -1);
    const cName = colIndex(header, ['produk', 'name', 'nama', 'product'], 0);
    const cKat = colIndex(header, ['kategori', 'category'], 1);
    const cModal = colIndex(header, ['hargamodal', 'modal', 'hpp', 'cost'], 2);
    const cJual = colIndex(header, ['hargajual', 'jual', 'price', 'harga'], 3);
    const cStok = colIndex(header, ['stok', 'stock'], 4);

    const out = body
      .filter((r) => (r[cName] ?? '').toString().trim() !== '')
      .map((r) => ({
        id: cId >= 0 ? (r[cId] || null) : null,
        name: r[cName],
        kategori: r[cKat] || 'Lainnya',
        hargaModal: parseNum(r[cModal]),
        harga: parseNum(r[cJual]),
        stok: parseNum(r[cStok]),
      }));

    return ok(out);
  } catch (e) {
    return err(e);
  }
};
