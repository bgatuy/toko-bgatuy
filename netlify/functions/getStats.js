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

function getEnv() {
  const SERVICE_EMAIL =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_SERVICE_EMAIL;

  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const SPREADSHEET_ID =
    process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID;

  const SHEET_TRANSAKSI = process.env.GOOGLE_SHEET_TRANSAKSI || 'Transaksi';
  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error(
      'Missing env GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEET_ID'
    );
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_TRANSAKSI };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'GET') return err(new Error('Method Not Allowed'), 405);

  try {
    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_TRANSAKSI } = getEnv();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TRANSAKSI}!A:N`,
    });

    const rows = data.values || [];
    const [header = [], ...body] = rows;
    // Asumsi kolom: A:ID, B:Tanggal, C:Waktu, D:Produk, E:Kategori, F:HargaJual, G:HargaModal,
    // H:Qty, I:Omzet, J:HPP, K:Laba, L:Tunai, M:Kembalian

    const today = new Date();
    const start = new Date(today); start.setDate(today.getDate() - 29);
    start.setHours(0,0,0,0);

    const toDate = (idDate) => {
      const [d, m, y] = String(idDate || '').split('/').map((n) => parseInt(n, 10));
      const dt = new Date(y, (m || 1) - 1, d || 1);
      dt.setHours(0,0,0,0);
      return dt;
    };

    let profitToday = 0, omzetToday = 0, hppToday = 0, countToday = 0;
    let profit30 = 0, omzet30 = 0, hpp30 = 0;

    const byDate = new Map(); // "id-ID" -> profit
    for (const r of body) {
      const tgl = r[1]; const dt = toDate(tgl);
      const omzet = parseNum(r[8]);
      const hpp = parseNum(r[9]);
      const laba = parseNum(r[10]);

      if (dt >= start && dt <= today) {
        omzet30 += omzet; hpp30 += hpp; profit30 += laba;
      }
      const id = dt.toLocaleDateString('id-ID');
      byDate.set(id, (byDate.get(id) || 0) + laba);

      const todayId = today.toLocaleDateString('id-ID');
      if (id === todayId) {
        omzetToday += omzet; hppToday += hpp; profitToday += laba;
        countToday += 1; // per row item; kalau mau per transaksi unik, bisa pakai Set ID
      }
    }

    // trend 30 hari
    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const key = d.toLocaleDateString('id-ID');
      trend.push({ date: key, profit: byDate.get(key) || 0 });
    }

    return ok({
      ok: true,
      profitToday, omzetToday, hppToday, countToday,
      profit30, omzet30, hpp30,
      trend,
    });
  } catch (e) {
    return err(e);
  }
};
