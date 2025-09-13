// functions/getProducts.js
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
  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error('Missing env');
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK };
}

function colIndex(header, aliases, dflt) {
  const low = header.map(h => norm(h));
  for (const a of aliases){ const i = low.indexOf(a); if (i !== -1) return i; }
  return dflt;
}

exports.handler = async () => {
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
    const [header = [], ...body] = rows;

    const cId    = colIndex(header, ['id','kode','sku'], -1);
    const cName  = colIndex(header, ['produk','product','name','nama'], 0);
    const cKat   = colIndex(header, ['kategori','category'], 1);
    const cModal = colIndex(header, ['harga modal','hargamodal','modal','hpp','cost'], 2);
    const cJual  = colIndex(header, ['harga jual','hargajual','jual','price','harga'], 3);
    const cStok  = colIndex(header, ['stok','stock'], 4);

    const products = body
      .filter(r => (r && r[cName]))
      .map(r => ({
        id: cId >= 0 ? (r[cId] || null) : null,
        name: r[cName],
        kategori: r[cKat] || 'Lainnya',
        hargaModal: parseNum(r[cModal]),
        harga: parseNum(r[cJual]),
        stok: parseNum(r[cStok]),
      }));

    return ok(products);
  } catch (e) {
    return err(e);
  }
};
