// functions/saveTransaction.js
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
const toCol = (idx) => { 
  let n = idx + 1, s = ''; 
  while (n) { 
    const r = (n - 1) % 26; 
    s = String.fromCharCode(65 + r) + s; 
    n = Math.floor((n - 1) / 26); 
  } 
  return s; 
};

function getEnv() {
  const SERVICE_EMAIL =
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT ||
    process.env.GOOGLE_SERVICE_EMAIL;

  const PRIVATE_KEY = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const SPREADSHEET_ID =
    process.env.GOOGLE_SHEETS_ID || process.env.GOOGLE_SHEET_ID || process.env.SHEET_ID;

  const SHEET_PRODUK    = process.env.GOOGLE_SHEET_PRODUK    || 'Produk';
  const SHEET_TRANSAKSI = process.env.GOOGLE_SHEET_TRANSAKSI || 'Transaksi';
  const SHEET_RINGKASAN = process.env.GOOGLE_SHEET_RINGKASAN || 'Ringkasan';

  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error('Missing env GOOGLE_SERVICE_ACCOUNT_EMAIL/GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, GOOGLE_SHEETS_ID');
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_TRANSAKSI, SHEET_RINGKASAN };
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
  if (event.httpMethod !== 'POST')   return err(new Error('Method Not Allowed'), 405);

  try {
    const trx = JSON.parse(event.body || '{}');
    const items = Array.isArray(trx.transaksi) ? trx.transaksi : [];
    if (!items.length) return err(new Error('transaksi kosong'), 400);

    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_TRANSAKSI, SHEET_RINGKASAN } = getEnv();
    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // === Produk sheet
    const prodRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
    });
    const rows = prodRes.data.values || [];
    const [header = [], ...body] = rows;

    const cId    = colIndex(header, ['id','kode','sku'], -1);
    const cName  = colIndex(header, ['produk','product','name','nama'], 0);
    const cKat   = colIndex(header, ['kategori','category'], 1);
    const cModal = colIndex(header, ['harga modal','hargamodal','modal','hpp','cost'], 2);
    const cStok  = colIndex(header, ['stok','stock'], 4);
    const stokCol = toCol(cStok);

    // Maps
    const mapModal = new Map();
    const mapKat   = new Map();
    const rowById  = new Map();
    const rowByName= new Map();

    for (let i = 0; i < body.length; i++) {
      const r = body[i] || [];
      const nm = r[cName];
      if (!nm) continue;
      mapModal.set(norm(nm), parseNum(r[cModal]));
      mapKat.set(norm(nm), r[cKat] || 'Lainnya');
      if (cId >= 0 && r[cId]) rowById.set(String(r[cId]).trim(), i);
      rowByName.set(norm(nm), i);
    }

    // === Simpan transaksi (detail per item)
    const values = [];
    let totalOmzet = 0, totalHpp = 0;

    for (const it of items) {
      const nm = String(it.name || '');
      const harga = parseNum(it.harga);
      const qty   = parseNum(it.qty);

      const modal = mapModal.get(norm(nm)) || 0;
      const kat   = mapKat.get(norm(nm)) || 'Lainnya';
      const omzet = harga * qty;
      const hpp   = modal * qty;

      totalOmzet += omzet;
      totalHpp   += hpp;

      values.push([
        trx.transactionId || '',
        trx.tanggal || '',
        trx.waktu || '',
        nm, kat, harga, modal, qty, omzet, hpp, omzet - hpp,
        trx.cash || '', trx.change || ''
      ]);
    }

    // append detail ke Transaksi
    const appendRes = await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TRANSAKSI}!A:M`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });

    // === Simpan ringkasan per transaksi (1 baris aja)
    try {
      const ringkasanRow = [[
        trx.transactionId || '',
        trx.tanggal || '',
        trx.waktu || '',
        items.length,              // Jumlah Item
        totalOmzet,
        totalHpp,
        totalOmzet - totalHpp,
        trx.cash || '',
        trx.change || ''
      ]];

      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_RINGKASAN}!A2:I`,   // 9 kolom sesuai header
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: ringkasanRow },
      });
    } catch (e) {
      console.error('Gagal append ke Ringkasan:', e.message);
    }

    // === Clear formatting Transaksi
try {
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = sheetMeta.data.sheets.find(s => s.properties.title === SHEET_TRANSAKSI);
  if (sheet) {
    const sheetId = sheet.properties.sheetId;
    const lastRow = appendRes.data.updates.updatedRange.match(/\d+$/);
    const endRowIndex = lastRow ? parseInt(lastRow[0], 10) : null;
    if (endRowIndex) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
          requests: [{
            repeatCell: {
              range: {
                sheetId,
                startRowIndex: endRowIndex - values.length,
                endRowIndex: endRowIndex,
              },
              cell: { userEnteredFormat: {} },
              fields: "userEnteredFormat",
            },
          }],
        },
      });
    }
  }
} catch (e) {
  console.error('Gagal clear formatting Transaksi:', e.message);
}

// === Clear formatting Ringkasan
try {
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = sheetMeta.data.sheets.find(s => s.properties.title === SHEET_RINGKASAN);
  if (sheet) {
    const sheetId = sheet.properties.sheetId;
    const lastRow = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RINGKASAN}!A:A`,
    });
    const rowCount = lastRow.data.values?.length || 1;
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: [{
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowCount - 1,
              endRowIndex: rowCount,
            },
            cell: { userEnteredFormat: {} },
            fields: "userEnteredFormat",
          },
        }],
      },
    });
  }
} catch (e) {
  console.error('Gagal clear formatting Ringkasan:', e.message);
}


    // === Kurangi stok
    const needByRow = new Map();
    for (const it of items) {
      const id = String(it.id ?? '').trim();
      const nm = norm(String(it.name || ''));
      const qty = parseNum(it.qty);
      if (!qty) continue;
      let rowIdx;
      if (cId >= 0 && id && rowById.has(id)) rowIdx = rowById.get(id);
      else if (rowByName.has(nm)) rowIdx = rowByName.get(nm);
      if (rowIdx == null) continue;
      needByRow.set(rowIdx, (needByRow.get(rowIdx) || 0) + qty);
    }

    const updates = [];
    const updatedRows = [];
    for (const [rowIdx, qty] of needByRow.entries()) {
      const r = body[rowIdx] || [];
      const cur = parseNum(r[cStok]);
      const after = Math.max(0, cur - qty);
      const rowNum = rowIdx + 2;
      updates.push({
        range: `${SHEET_PRODUK}!${stokCol}${rowNum}:${stokCol}${rowNum}`,
        values: [[ after ]]
      });
      updatedRows.push({
        row: rowNum,
        id: (cId >= 0 ? (r[cId] || null) : null),
        name: r[cName] || '',
        stok: after
      });
    }

    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updates }
      });
    }

    return ok({
      ok: true,
      count: values.length,
      totalOmzet,
      totalHpp,
      totalProfit: totalOmzet - totalHpp,
      updatedRows,
    });
  } catch (e) {
    console.error('SaveTransaction ERROR:', e.message);
    return err(e);
  }
};
