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

function parseSheetDate(x){
  if (x instanceof Date) return x;
  if (typeof x === 'number') { const ms = Math.round((x - 25569) * 86400 * 1000); const d = new Date(ms); return isNaN(d) ? new Date() : d; }
  const s = String(x || '').trim();
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  const d = new Date(s); return isNaN(d) ? new Date() : d;
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
  const SHEET_TRANSAKSI = process.env.GOOGLE_SHEET_TRANSAKSI || 'Transaksi';
  const SHEET_RINGKASAN = process.env.GOOGLE_SHEET_RINGKASAN || 'Ringkasan';
  const SHEET_RESTOKHIST = process.env.GOOGLE_SHEET_RESTOK || 'Restok Histori';

  if (!SERVICE_EMAIL || !PRIVATE_KEY || !SPREADSHEET_ID) {
    throw new Error('Missing Google Sheets env');
  }
  return { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID, SHEET_PRODUK, SHEET_TRANSAKSI, SHEET_RINGKASAN, SHEET_RESTOKHIST };
}

const colIndex = (header, aliases, dflt) => {
  const low = (header || []).map((h) => norm(h));
  for (const a of aliases) {
    const i = low.indexOf(a);
    if (i !== -1) return i;
  }
  for (let i = 0; i < low.length; i++) {
    if (aliases.some((a) => low[i]?.includes(a))) return i;
  }
  return dflt;
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return ok({});
  if (event.httpMethod !== 'POST') return err(new Error('Method Not Allowed'), 405);

  try {
    const trx = JSON.parse(event.body || '{}');
    const items = Array.isArray(trx.transaksi) ? trx.transaksi : [];
    if (!items.length) return err(new Error('transaksi kosong'), 400);

    const paymentMethod = String(trx.paymentMethod || trx.method || 'Cash');

    const { SERVICE_EMAIL, PRIVATE_KEY, SPREADSHEET_ID,
            SHEET_PRODUK, SHEET_TRANSAKSI, SHEET_RINGKASAN, SHEET_RESTOKHIST } = getEnv();

    const auth = new google.auth.GoogleAuth({
      credentials: { client_email: SERVICE_EMAIL, private_key: PRIVATE_KEY },
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    /* === Load Produk === */
    const prodRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_PRODUK}!A:Z`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const prodRows = prodRes.data.values || [];
    const [prodHeader = [], ...prodBody] = prodRows;

    const pId    = colIndex(prodHeader, ['id', 'kode', 'sku'], -1);
    const pName  = colIndex(prodHeader, ['produk', 'product', 'name', 'nama'], 0);
    const pKat   = colIndex(prodHeader, ['kategori', 'category'], 1);
    const pModal = colIndex(prodHeader, ['harga modal', 'hargamodal', 'modal', 'hpp', 'cost'], 2);
    const pJual  = colIndex(prodHeader, ['harga jual','hargajual','jual','price','harga'], 3);
    const pStok  = colIndex(prodHeader, ['stok', 'stock'], 4);

    const stokCol  = toCol(pStok);
    const jualCol  = toCol(pJual);
    const modalCol = toCol(pModal);

    const mapModal = new Map();
    const mapKat = new Map();
    const rowById = new Map();
    const rowByName = new Map();

    for (let i = 0; i < prodBody.length; i++) {
      const r = prodBody[i] || [];
      const nm = r[pName];
      if (!nm) continue;
      mapModal.set(norm(nm), parseNum(r[pModal]));
      mapKat.set(norm(nm), r[pKat] || 'Lainnya');
      if (pId >= 0 && r[pId]) rowById.set(String(r[pId]).trim(), i);
      rowByName.set(norm(nm), i);
    }

    /* === Load Restok Histori (Qty Terpakai) === */
    const rhRes = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RESTOKHIST}!A:I`,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'FORMATTED_STRING',
    });
    const rhRows = rhRes.data.values || [];
    const [rhHeader = [], ...rhBody] = rhRows;

    const rRestokId = colIndex(rhHeader, ['restok id', 'restokid', 'batch id', 'id'], 0);
    const rProdId = colIndex(rhHeader, ['produk id', 'produkid', 'sku'], 1);
    const rProd = colIndex(rhHeader, ['produk', 'product', 'nama'], 2);
    const rKat = colIndex(rhHeader, ['kategori', 'category'], 3);
    const rModal = colIndex(rhHeader, ['harga modal', 'modal', 'hpp'], 4);
    const rJual = colIndex(rhHeader, ['harga jual', 'jual', 'price', 'harga'], 5);
    const rQty = colIndex(rhHeader, ['qty restok', 'qty', 'jumlah'], 6);
    const rTgl = colIndex(rhHeader, ['tanggal restok', 'tgl', 'tanggal'], 7);
    const rTerpakai = colIndex(rhHeader, ['qty terpakai', 'terpakai', 'qty dipakai'], 8);

    const batchesByProdId = new Map();
    const batchesByName = new Map();
    const terpakaiByRow = new Map();

    for (let i = 0; i < rhBody.length; i++) {
      const r = rhBody[i] || [];
      const rowNum = i + 2;
      const pid = String(r[rProdId] || '').trim();
      const pname = norm(r[rProd] || '');
      const qtyMasuk = parseNum(r[rQty]);
      const qtyTerpakai = parseNum(r[rTerpakai]);
      const remain = Math.max(0, qtyMasuk - qtyTerpakai);

      const obj = {
        row: rowNum,
        id: String(r[rRestokId] || '').trim() || '-',
        prodId: pid,
        nameKey: pname,
        date: String(r[rTgl] || '').trim(),
        modal: parseNum(r[rModal]),
        jual: parseNum(r[rJual]),
        remain,
        terpakaiNow: qtyTerpakai,
      };

      if (pid) { if (!batchesByProdId.has(pid)) batchesByProdId.set(pid, []); batchesByProdId.get(pid).push(obj); }
      if (pname) { if (!batchesByName.has(pname)) batchesByName.set(pname, []); batchesByName.get(pname).push(obj); }
      terpakaiByRow.set(rowNum, qtyTerpakai);
    }
    for (const arr of [...batchesByProdId.values(), ...batchesByName.values()]) {
      arr.sort((a, b) => parseSheetDate(a.date) - parseSheetDate(b.date));
    }

    /* === Detail transaksi (alokasi FIFO) === */
    const detailValues = [];
    let totalOmzet = 0, totalHpp = 0;
    const incTerpakaiByRow = new Map();
    const priceSyncByRow = new Map();

    for (const it of items) {
      const nm = String(it.name || '');
      const nmKey = norm(nm);
      const prodIdKey = String(it.id || '').trim();

      let qtyLeft = parseNum(it.qty);
      const jual = parseNum(it.harga);
      const kat = mapKat.get(nmKey) || 'Lainnya';

      const arr =
        (prodIdKey && batchesByProdId.get(prodIdKey)) ||
        batchesByName.get(nmKey) || [];

      let prodRowIdx = null;
      if (pId >= 0 && prodIdKey && rowById.has(prodIdKey)) prodRowIdx = rowById.get(prodIdKey);
      else if (rowByName.has(nmKey)) prodRowIdx = rowByName.get(nmKey);

      while (qtyLeft > 0) {
        const chosen = arr.find((b) => b.remain > 0);
        let take, modal, batchId, batchDate, rowRH;

        if (chosen) {
          take = Math.min(qtyLeft, chosen.remain);
          chosen.remain -= take;
          modal = parseNum(chosen.modal);
          batchId = chosen.id || '-';
          batchDate = chosen.date || '-';
          rowRH = chosen.row;
          incTerpakaiByRow.set(rowRH, (incTerpakaiByRow.get(rowRH) || 0) + take);
        } else {
          take = qtyLeft;
          modal = mapModal.get(nmKey) || 0;
          batchId = '-';
          batchDate = '-';
          rowRH = null;
        }

        const omzet = jual * take;
        const hpp = modal * take;
        const laba = omzet - hpp;

        detailValues.push([
          trx.transactionId || '',
          trx.tanggal || '',
          trx.waktu || '',
          nm,
          batchId, batchDate, kat,
          jual, modal, take,
          omzet, hpp, laba,
          parseNum(trx.diskon || 0),
          parseNum(trx.cash || 0),
          parseNum(trx.change || 0),
        ]);

        totalOmzet += omzet;
        totalHpp += hpp;
        qtyLeft -= take;
      }

      const active = (arr || []).find(b => b.remain > 0);
      if (active && prodRowIdx != null) {
        priceSyncByRow.set(prodRowIdx, { jual: parseNum(active.jual), modal: parseNum(active.modal) });
      }
    }

    // === Snapshot biaya per NAMA (weighted avg dari detailValues) ===
const byName = new Map(); // name -> { qty, hpp }
for (const row of detailValues) {
  const name  = row[3];            // D: Nama
  const modal = Number(row[8]||0); // I: Harga Modal / unit
  const qty   = Number(row[9]||0); // J: Qty
  const cur = byName.get(name) || { qty: 0, hpp: 0 };
  cur.qty += qty;
  cur.hpp += modal * qty;          // total biaya
  byName.set(name, cur);
}
const costSnapshot = [...byName.entries()].map(([name, { qty, hpp }]) => ({
  name,
  qty,
  modalAtSale: qty ? Math.round(hpp / qty) : 0
}));


    // Update Qty Terpakai di RH
    if (incTerpakaiByRow.size) {
      const writes = [];
      for (const [rowNum, inc] of incTerpakaiByRow.entries()) {
        const current = terpakaiByRow.get(rowNum) || 0;
        writes.push({ range: `${SHEET_RESTOKHIST}!I${rowNum}`, values: [[ current + inc ]] });
      }
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data: writes },
      });
    }

    // Append Transaksi
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_TRANSAKSI}!A:P`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: detailValues },
    });

    // Append Ringkasan
    const totalBayar = Math.max(0, totalOmzet - parseNum(trx.diskon || 0));
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_RINGKASAN}!A2:L`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [[
        trx.transactionId || '',
        trx.tanggal || '',
        trx.waktu || '',
        items.length,
        totalOmzet,
        totalHpp,
        totalOmzet - totalHpp,
        parseNum(trx.diskon || 0),
        totalBayar,
        paymentMethod,
        parseNum(trx.cash || 0),
        parseNum(trx.change || 0),
      ]]},
    });

    /* === Kurangi stok + (opsional) sinkron harga === */
    const needByRow = new Map();
    for (const it of items) {
      const id = String(it.id ?? '').trim();
      const nm = norm(String(it.name || ''));
      const qty = parseNum(it.qty);
      if (!qty) continue;
      let rowIdx;
      if (pId >= 0 && id && rowById.has(id)) rowIdx = rowById.get(id);
      else if (rowByName.has(nm)) rowIdx = rowByName.get(nm);
      if (rowIdx == null) continue;
      needByRow.set(rowIdx, (needByRow.get(rowIdx) || 0) + qty);
    }

    const updates = [];
    const updatedRowsMap = new Map(); // rowNum -> {row,id,name,stok, harga?, hargaModal?}

    for (const [rowIdx, qty] of needByRow.entries()) {
      const r = prodBody[rowIdx] || [];
      const cur = parseNum(r[pStok]);
      const after = Math.max(0, cur - qty);
      const rowNum = rowIdx + 2;
      updates.push({ range: `${SHEET_PRODUK}!${stokCol}${rowNum}:${stokCol}${rowNum}`, values: [[after]] });
      updatedRowsMap.set(rowNum, {
        row: rowNum,
        id: pId >= 0 ? (r[pId] || null) : null,
        name: r[pName] || '',
        stok: after,
      });
    }

    for (const [rowIdx, tgt] of priceSyncByRow.entries()) {
      const r = prodBody[rowIdx] || [];
      const rowNum = rowIdx + 2;
      if (pJual >= 0) {
        const curJ = parseNum(r[pJual]);
        if (tgt.jual != null && tgt.jual !== curJ) {
          updates.push({ range: `${SHEET_PRODUK}!${jualCol}${rowNum}:${jualCol}${rowNum}`, values: [[tgt.jual]] });
          const e = updatedRowsMap.get(rowNum) || { row: rowNum, id: pId >= 0 ? (r[pId] || null) : null, name: r[pName] || '' };
          e.harga = tgt.jual; updatedRowsMap.set(rowNum, e);
        }
      }
      if (pModal >= 0) {
        const curM = parseNum(r[pModal]);
        if (tgt.modal != null && tgt.modal !== curM) {
          updates.push({ range: `${SHEET_PRODUK}!${modalCol}${rowNum}:${modalCol}${rowNum}`, values: [[tgt.modal]] });
          const e = updatedRowsMap.get(rowNum) || { row: rowNum, id: pId >= 0 ? (r[pId] || null) : null, name: r[pName] || '' };
          e.hargaModal = tgt.modal; updatedRowsMap.set(rowNum, e);
        }
      }
    }

    if (updates.length) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'RAW', data: updates },
      });
    }

    return ok({
      ok: true,
      count: detailValues.length,
      totalOmzet,
      totalHpp,
      totalProfit: totalOmzet - totalHpp,
      updatedRows: Array.from(updatedRowsMap.values()),
      costSnapshot,
    });
  } catch (e) {
    console.error('SaveTransaction ERROR:', e.message);
    return err(e);
  }
};
