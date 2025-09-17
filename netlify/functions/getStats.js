// functions/getStats.js
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

// dukung "16/9/2025" dan serial number dari Sheets
function parseSheetDate(cell) {
  if (cell == null || cell === '') return null;
  if (typeof cell === 'number') {
    const ms = Math.round((cell - 25569) * 86400 * 1000); // epoch offset
    const d = new Date(ms); d.setHours(0,0,0,0); return isNaN(d) ? null : d;
  }
  const s = String(cell).trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) { const d = new Date(+m[3], +m[2]-1, +m[1]); d.setHours(0,0,0,0); return d; }
  const d = new Date(s); if (isNaN(d)) return null; d.setHours(0,0,0,0); return d;
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

  const SHEET_RINGKASAN = process.env.GOOGLE_SHEET_RINGKASAN || 'Ringkasan';

  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error('Missing Google Sheets env');
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_RINGKASAN };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'GET') return err(new Error('Method Not Allowed'), 405);

  try {
    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_RINGKASAN } = getEnv();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Ringkasan!A:L
    // A TransactionID, B Tanggal, C Waktu, D Jumlah Item,
    // E Total Omzet, F Total HPP, G Total Laba, H Diskon, I Total Bayar, J Metode, K Tunai, L Kembali
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RINGKASAN}!A:L`,
    });

    const rows = data.values || [];
    const [header = [], ...body] = rows;

    const idx = { tgl:1, omzet:4, hpp:5, laba:6, diskon:7 };

    const today = new Date(); today.setHours(0,0,0,0);
    const start = new Date(today); start.setDate(start.getDate() - 29); // 30 hari rolling

    let profitToday = 0, omzetToday = 0, hppToday = 0, countToday = 0;
    let profit30 = 0, omzet30 = 0, hpp30 = 0;

    const byDate = new Map(); // 'id-ID' -> profit

    for (const r of body) {
      const d = parseSheetDate(r[idx.tgl]);
      if (!d) continue;

      const omzet = parseNum(r[idx.omzet]);
      const hpp   = parseNum(r[idx.hpp]);
      const laba  = parseNum(r[idx.laba]);
      const diskon= parseNum(r[idx.diskon]);
      const profitAfterDisc = laba - diskon;

      // agregat 30 hari
      if (d >= start && d <= today) {
        omzet30  += omzet;
        hpp30    += hpp;
        profit30 += profitAfterDisc;
      }

      const key = d.toLocaleDateString('id-ID');
      byDate.set(key, (byDate.get(key) || 0) + profitAfterDisc);

      // hari ini
      if (d.getTime() === today.getTime()) {
        omzetToday  += omzet;
        hppToday    += hpp;
        profitToday += profitAfterDisc;
        countToday  += 1; // 1 baris = 1 transaksi
      }
    }

    // bangun trend 30 hari (urut kronologis)
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
