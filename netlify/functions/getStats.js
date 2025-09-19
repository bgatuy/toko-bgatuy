// netlify/functions/getStats.js
const { google } = require('googleapis');

/* ---------- helpers ---------- */
const ok = (data) => ({
  statusCode: 200,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(data),
});
const err = (e, code = 500) => ({
  statusCode: code,
  headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify({ ok: false, error: e?.message || String(e) }),
});
const n = (v) => Number(v || 0);
const def = (i, d) => (i >= 0 ? i : d);
const parseIdDate = (s) => {
  const [d, m, y] = String(s || '').split('/').map((x) => parseInt(x, 10));
  const dt = new Date(y || 1970, (m || 1) - 1, d || 1);
  dt.setHours(0, 0, 0, 0);
  return dt;
};
function getEnvs() {
  const SERVICE_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_CLIENT_EMAIL;
  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const SPREADSHEET_ID =
    process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID;
  const SHEET_PRODUK = process.env.GOOGLE_SHEET_PRODUK || 'Produk';
  const SHEET_TRANSAKSI = process.env.GOOGLE_SHEET_TRANSAKSI || 'Transaksi';
  const SHEET_RINGKASAN = process.env.GOOGLE_SHEET_RINGKASAN || 'Ringkasan';
  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error('Missing Google Sheets envs');
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_TRANSAKSI, SHEET_RINGKASAN };
}

/* ---------- main ---------- */
exports.handler = async () => {
  try {
    const {
      SERVICE_EMAIL,
      PRIVATE_KEY,
      SPREADSHEET_ID,
      SHEET_PRODUK,
      SHEET_TRANSAKSI,
      SHEET_RINGKASAN,
    } = getEnvs();

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start30 = new Date(today);
    start30.setDate(today.getDate() - 29);

    /* ===== RINGKASAN: KPI, trend, recent ===== */
    const resR = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RINGKASAN}!A:L`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rowsR = resR.data.values || [];
    const [hdrR = [], ...bodyR] = rowsR;

    // Cari kolom secara dinamis + fallback index sesuai layout umum di sheet kamu:
    // A:ID(0) B:Tanggal(1) C:Waktu(2) D:Jumlah Produk(3) E:Total Omzet(4)
    // F:Total HPP(5) G:Total Laba(6) H:Diskon Transaksi(7) I:Total Bayar(8)
    let cId = hdrR.findIndex((h) => String(h).toLowerCase().includes('transaction id'));
    let cT = hdrR.findIndex((h) => String(h).toLowerCase().includes('tanggal'));
    let cW = hdrR.findIndex((h) => String(h).toLowerCase().includes('waktu'));
    let cJml = hdrR.findIndex((h) => String(h).toLowerCase().includes('jumlah produk'));
    let cOmz = hdrR.findIndex((h) => String(h).toLowerCase().includes('total omzet'));
    let cHpp = hdrR.findIndex((h) => String(h).toLowerCase().includes('total hpp'));
    let cLab = hdrR.findIndex((h) => String(h).toLowerCase().includes('total laba'));
    let cDis = hdrR.findIndex((h) => String(h).toLowerCase().includes('diskon'));
    let cBay = hdrR.findIndex((h) => String(h).toLowerCase().includes('total bayar'));

    // fallback
    const cTgl = def(cT, 1);
    const cWkt = def(cW, 2);
    const cJmlProd = def(cJml, 3);
    const cOmz2 = def(cOmz, 4);
    const cHpp2 = def(cHpp, 5);
    const cLab2 = def(cLab, 6);
    const cDis2 = def(cDis, 7);
    const cBay2 = def(cBay, 8);

    let profitToday = 0,
      omzetToday = 0,
      hppToday = 0,
      countToday = 0;
    let profit30 = 0,
      omzet30 = 0,
      hpp30 = 0;

    const profitByDay = new Map();
    const recent = [];

    // recent: ambil 5 terakhir dari bawah
    for (let i = bodyR.length - 1; i >= 0 && recent.length < 5; i--) {
      const r = bodyR[i] || [];
      if (!r[def(cId, 0)]) continue;
      recent.push({
        id: r[def(cId, 0)],
        tanggal: r[cTgl],
        waktu: r[cWkt],
        totalBayar: n(r[cBay2]),
        itemCount: n(r[cJmlProd]),
      });
    }

    for (const r of bodyR) {
      const dt = parseIdDate(r[cTgl]);
      if (isNaN(+dt)) continue;

      const omz = n(r[cOmz2]);
      const hpp = n(r[cHpp2]);
      const laba = cLab2 >= 0 ? n(r[cLab2]) : omz - hpp;
      const dis = cDis2 >= 0 ? n(r[cDis2]) : 0;
      const profit = laba - dis;

      if (dt >= start30 && dt <= today) {
        omzet30 += omz;
        hpp30 += hpp;
        profit30 += profit;
        const key = dt.toLocaleDateString('id-ID');
        profitByDay.set(key, (profitByDay.get(key) || 0) + profit);
      }
      if (+dt === +today) {
        omzetToday += omz;
        hppToday += hpp;
        profitToday += profit;
        countToday += 1;
      }
    }

    const trend = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toLocaleDateString('id-ID');
      trend.push({ date: key, profit: profitByDay.get(key) || 0 });
    }

    /* ===== TRANSAKSI: Top Kategori 30 hari (diskon dialokasikan proporsional) ===== */
    const resT = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TRANSAKSI}!A:P`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rowsT = resT.data.values || [];
    const [hdrT = [], ...bodyT] = rowsT;

    // Struktur detailValues:
    // 0:id,1:tgl,2:waktu,3:nama,4:batchId,5:batchDate,6:kategori,
    // 7:jual,8:modal,9:qty,10:omzet,11:hpp,12:laba,13:diskon, 14:cash, 15:change
    const tId = 0,
      tTgl = 1,
      tKat = 6,
      tOmz = 10,
      tLab = 12;

    // total omzet per transaksi untuk alokasi diskon
    const omzByTrx = new Map();
    for (const r of bodyT) {
      const dt = parseIdDate(r[tTgl]);
      if (isNaN(+dt) || dt < start30 || dt > today) continue;
      const id = r[tId];
      if (!id) continue;
      omzByTrx.set(id, (omzByTrx.get(id) || 0) + n(r[tOmz]));
    }

    // Map diskon per trx dari Ringkasan (agar konsisten)
    const discByTrx = new Map();
    for (const r of bodyR) {
      const id = r[def(cId, 0)];
      if (id) discByTrx.set(id, n(r[cDis2]));
    }

    const catProfit = new Map();
    for (const r of bodyT) {
      const dt = parseIdDate(r[tTgl]);
      if (isNaN(+dt) || dt < start30 || dt > today) continue;
      const id = r[tId];
      if (!id) continue;

      const cat = r[tKat] || 'LAINNYA';
      const labaLine = n(r[tLab]); // laba per-baris (omzet - hpp)
      const omzLine = n(r[tOmz]);
      const trxOmz = omzByTrx.get(id) || 0;
      const trxDisc = discByTrx.get(id) || 0;

      const discAlloc = trxOmz ? (trxDisc * (omzLine / trxOmz)) : 0;
      const profitLine = labaLine - discAlloc;

      catProfit.set(cat, (catProfit.get(cat) || 0) + profitLine);
    }

    const topCategories = [...catProfit.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, profit]) => ({ name, profit: Math.round(profit) }));

    /* ===== PRODUK: low stock ===== */
    const resP = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rowsP = resP.data.values || [];
    const [hdrP = [], ...bodyP] = rowsP;

    const pName = hdrP.findIndex((h) => String(h).toLowerCase().includes('produk'));
    const pStok = hdrP.findIndex((h) => String(h).toLowerCase().includes('stok'));

    const lowStock = bodyP
      .filter((r) => n(r[pStok]) <= 5)
      .map((r) => ({ name: r[pName], stok: n(r[pStok]) }))
      .sort((a, b) => a.stok - b.stok)
      .slice(0, 6);

    /* ----- return ----- */
    return ok({
      ok: true,
      profitToday,
      omzetToday,
      hppToday,
      countToday,
      profit30,
      omzet30,
      hpp30,
      trend,
      topCategories,
      lowStock,
      recent,
    });
  } catch (e) {
    console.error('getStats ERROR:', e);
    return err(e);
  }
};
