import { calculateMetrics } from './metrics.js';

export function columnIndexToA1Letter(colIndex0) {
  let n = colIndex0 + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function escapeSheetTitle(sheetName) {
  const s = String(sheetName);
  if (/[\s'!]/.test(s)) {
    return `'${s.replace(/'/g, "''")}'`;
  }
  return s;
}

function sheetRangeRow(sheetName, colStart0, colEnd0, row0) {
  const esc = escapeSheetTitle(sheetName);
  const r = row0 + 1;
  const c1 = columnIndexToA1Letter(colStart0);
  const c2 = columnIndexToA1Letter(colEnd0);
  return `${esc}!${c1}${r}:${c2}${r}`;
}

function sheetRangeRect(sheetName, colStart0, colEnd0, rowStart0, rowEnd0) {
  const esc = escapeSheetTitle(sheetName);
  const r1 = rowStart0 + 1;
  const r2 = rowEnd0 + 1;
  const c1 = columnIndexToA1Letter(colStart0);
  const c2 = columnIndexToA1Letter(colEnd0);
  return `${esc}!${c1}${r1}:${c2}${r2}`;
}

function parseNumericCell(v) {
  if (v === null || v === undefined || v === '') return 0;
  const s = String(v).trim().replace(/,/g, '').replace(/\s/g, '');
  if (s === '') return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function metricsToRow(metrics) {
  return [
    metrics.impressions,
    metrics.clicks,
    metrics.leads,
    metrics.spend,
    metrics.cpl ?? '',
    metrics.cpm ?? '',
    metrics.cpc ?? '',
    metrics.ctr ?? '',
  ];
}

/**
 * @param {import('googleapis').sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {object} block
 * @param {number} dayOfMonth 1-31
 * @param {ReturnType<typeof calculateMetrics>} metrics
 */
export async function writeBlockData(
  sheets,
  spreadsheetId,
  sheetName,
  block,
  dayOfMonth,
  metrics
) {
  const row0 = block.dataStartRowIndex + (dayOfMonth - 1);
  if (row0 >= block.totalRowIndex) {
    console.log(`[sheets-writer] SKIP: day ${dayOfMonth} → row0=${row0} >= totalRowIndex=${block.totalRowIndex} for block "${block.blockName}" (dataStartRowIndex=${block.dataStartRowIndex})`);
    return;
  }

  const row1 = row0 + 1;
  const esc = escapeSheetTitle(sheetName);

  const writes = [
    { col: block.columns.impressions, val: metrics.impressions },
    { col: block.columns.clicks, val: metrics.clicks },
    { col: block.columns.leads, val: metrics.leads },
    { col: block.columns.spend, val: metrics.spend },
  ];

  if (block.columns.addToCart >= 0 && metrics.addToCart !== undefined) {
    writes.push({ col: block.columns.addToCart, val: metrics.addToCart });
  }

  if (block.columns.cpl >= 0) {
    writes.push({ col: block.columns.cpl, val: metrics.cpl ?? '' });
  }
  if (block.columns.cpm >= 0) {
    writes.push({ col: block.columns.cpm, val: metrics.cpm ?? '' });
  }
  if (block.columns.cpc >= 0) {
    writes.push({ col: block.columns.cpc, val: metrics.cpc ?? '' });
  }
  if (block.columns.ctr >= 0) {
    writes.push({ col: block.columns.ctr, val: metrics.ctr ?? '' });
  }

  const data = writes.map((w) => ({
    range: `${esc}!${columnIndexToA1Letter(w.col)}${row1}`,
    values: [[w.val]],
  }));

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data,
    },
  });
  console.log(
    `[sheets-writer] Wrote day ${dayOfMonth} to block "${block.blockName}" row ${row1}`
  );
}

function columnKeysForRead() {
  return ['impressions', 'clicks', 'leads', 'spend'];
}

/**
 * @param {import('googleapis').sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {object} block
 */
export async function updateTotals(sheets, spreadsheetId, sheetName, block) {
  const keys = columnKeysForRead();
  const cols = keys.map((k) => block.columns[k]);
  const minC = Math.min(...cols);
  const maxC = Math.max(...cols);

  const readRange = sheetRangeRect(
    sheetName,
    minC,
    maxC,
    block.dataStartRowIndex,
    block.totalRowIndex - 1
  );

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: readRange,
  });

  const valueRows = res.data.values || [];

  let sumImp = 0;
  let sumClk = 0;
  let sumLeads = 0;
  let sumSpend = 0;

  for (const row of valueRows) {
    sumImp += parseNumericCell(row[block.columns.impressions - minC]);
    sumClk += parseNumericCell(row[block.columns.clicks - minC]);
    sumLeads += parseNumericCell(row[block.columns.leads - minC]);
    sumSpend += parseNumericCell(row[block.columns.spend - minC]);
  }

  const agg = calculateMetrics(sumImp, sumClk, sumLeads, sumSpend);

  const totalRow0 = block.totalRowIndex;
  const startCol = block.columns.impressions;
  const endCol = startCol + 7;
  const writeRange = sheetRangeRow(sheetName, startCol, endCol, totalRow0);

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: writeRange,
    valueInputOption: 'RAW',
    requestBody: { values: [metricsToRow(agg)] },
  });
  console.log(`[sheets-writer] Updated totals for block "${block.blockName}"`);
}
