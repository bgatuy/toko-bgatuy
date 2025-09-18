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
const todayId = () => new Date().toLocaleDateString('id-ID');
const uid = () => Math.random().toString(36).slice(2,8).toUpperCase();

/* ====== tanggal & BatchID ====== */
function parseSheetDate(x){ if (x instanceof Date) return x; const s = String(x||'').trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/); if (m) return new Date(+m[3], +m[2]-1, +m[1]);
  const d = new Date(s); return isNaN(d) ? new Date() : d; }
function ddmmyyyy(d){ const dt = parseSheetDate(d); const dd = String(dt.getDate()).padStart(2,'0'); const mm = String(dt.getMonth()+1).padStart(2,'0'); const yy = dt.getFullYear(); return `${dd}${mm}${yy}`; }
async function makeBatchId(sheets, spreadsheetId, sheetName, produkId, tglStr){
  const base = `${String(produkId||'').trim()}-${ddmmyyyy(tglStr)}`;
  const { data } = await sheets.spreadsheets.values.get({ spreadsheetId, range: `'${sheetName}'!A2:A` });
  const used = new Set(((data.values)||[]).map(v => String(v[0]||'')));
  if (!used.has(base)) return base;
  let n = 2; while (used.has(`${base}-${String(n).padStart(2,'0')}`)) n++;
  return `${base}-${String(n).padStart(2,'0')}`;
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

  const SHEET_PRODUK     = process.env.GOOGLE_SHEET_PRODUK     || 'Produk';
  const SHEET_RESTOKHIST = process.env.GOOGLE_SHEET_RESTOK     || 'Restok Histori';

  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) throw new Error('Missing env');
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_RESTOKHIST };
}

const colIndex = (header, aliases, dflt) => {
  const low = (header || []).map(h => norm(h));
  for (const a of aliases) { const i = low.indexOf(a); if (i !== -1) return i; }
  for (let i=0;i<low.length;i++){ if (aliases.some(a => low[i]?.includes(a))) return i; }
  return dflt;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST')   return err(new Error('Method Not Allowed'), 405);

  try {
    const body = JSON.parse(event.body || '{}');
    let { id, name, harga, hargaModal, stok, kategori, tanggalRestok } = body;
    if (!name) return err(new Error('name wajib'), 400);

    id        = id ? String(id).trim().toUpperCase() : undefined;
    name      = String(name).trim().toUpperCase();
    kategori  = String(kategori || 'Lainnya').trim().toUpperCase();

    harga      = parseNum(harga);
    hargaModal = parseNum(hargaModal);
    stok       = parseNum(stok);

    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_RESTOKHIST } = getEnv();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Read Produk
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
    });
    const rows = data.values || [];
    const [header = [], ...bodyRows] = rows;

    const cId    = colIndex(header, ['id','kode','sku'], -1);
    const cName  = colIndex(header, ['produk','product','name','nama'], 0);
    const cKat   = colIndex(header, ['kategori','category'], 1);
    const cModal = colIndex(header, ['harga modal','hargamodal','modal','hpp','cost'], 2);
    const cJual  = colIndex(header, ['harga jual','hargajual','jual','price','harga'], 3);
    const cStok  = colIndex(header, ['stok','stock'], 4);
    const cDate  = colIndex(header, ['tanggal masuk produk','tanggal masuk','tgl masuk','tanggal restok'], 6);

    const stokCol = toCol(cStok);
    const modalCol= toCol(cModal);
    const jualCol = toCol(cJual);
    const katCol  = toCol(cKat);
    const dateCol = cDate >= 0 ? toCol(cDate) : null;

    const idx = bodyRows.findIndex((r) => norm(r[cName]) === norm(name));

    let mode = 'append';
    let after = stok;
    let newId = id;
    let newKat = kategori || (bodyRows[idx]?.[cKat]) || 'LAINNYA';
    let newJual = harga;
    let newModal = hargaModal;

    if (idx >= 0) {
      // RESTOCK
      mode = 'restock';
      const rowNum   = idx + 2;
      const row      = bodyRows[idx] || [];
      const curStok  = parseNum(row[cStok]);
      const curModal = parseNum(row[cModal]);
      const curJual  = parseNum(row[cJual]);

      after = curStok + stok;

      const hasOldStock = curStok > 0;
      newJual  = hasOldStock ? curJual  : (harga      > 0 ? harga      : curJual);
      newModal = hasOldStock ? curModal : (hargaModal > 0 ? hargaModal : curModal);

      newKat   = kategori || row[cKat] || 'LAINNYA';

      const updates = [
        { range: `${SHEET_PRODUK}!${stokCol}${rowNum}:${stokCol}${rowNum}`,   values: [[ after ]] },
        { range: `${SHEET_PRODUK}!${jualCol}${rowNum}:${jualCol}${rowNum}`,   values: [[ newJual ]] },
        { range: `${SHEET_PRODUK}!${modalCol}${rowNum}:${modalCol}${rowNum}`, values: [[ newModal ]] },
        { range: `${SHEET_PRODUK}!${katCol}${rowNum}:${katCol}${rowNum}`,     values: [[ newKat ]] },
      ];
      if (dateCol) updates.push({ range: `${SHEET_PRODUK}!${dateCol}${rowNum}:${dateCol}${rowNum}`, values: [[ todayId() ]] });

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });

      newId = cId >= 0 ? (String(row[cId] || '').toUpperCase() || null) : null;

    } else {
      // BARU
      const newRow = [];
      newRow[cName]  = name.toUpperCase();
      newRow[cKat]   = newKat.toUpperCase();
      newRow[cModal] = newModal;
      newRow[cJual]  = newJual;
      newRow[cStok]  = after;
      if (cId >= 0) { newId = newId || ('P'+uid()); newRow[cId] = newId.toUpperCase(); }
      if (cDate >= 0) newRow[cDate] = todayId();

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_PRODUK}!A:Z`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [newRow] },
      });
    }

    // APPEND Restok Histori (Batch)
    if (stok > 0) {
      const tglStr = String(tanggalRestok || todayId());
      const batchId = await makeBatchId(sheets, SPREADSHEET_ID, SHEET_RESTOKHIST, newId || '', tglStr);

      const inputModal = parseNum(body.hargaModal);
      const inputJual  = parseNum(body.harga);
      const batchModal = inputModal > 0 ? inputModal : newModal;
      const batchJual  = inputJual  > 0 ? inputJual  : newJual;

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_RESTOKHIST}!A:I`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [[
          batchId,
          (newId || '').toUpperCase(),
          name.toUpperCase(),
          newKat.toUpperCase(),
          batchModal,
          batchJual,
          stok,
          tglStr,
          0
        ]]},
      });
    }

    return ok({ ok:true, mode, name, kategori:newKat, after, harga:newJual, hargaModal:newModal, id:newId });
  } catch (e) {
    console.error('upsertProduct ERROR:', e);
    return err(e);
  }
};
