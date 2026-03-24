function normCell(v) {
  return String(v ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function isMetaAdsLabel(cell) {
  const n = normCell(cell);
  return n === 'META ADS' || n === 'FACEBOOK ADS';
}

function resolveBlockName(rows, blockNameRowIndex, labelCol) {
  const row = rows[blockNameRowIndex] || [];
  const atLabel = String(row[labelCol] ?? '').trim();
  if (atLabel) return atLabel;
  for (let c = 0; c < row.length; c++) {
    const t = String(row[c] ?? '').trim();
    if (t) return t;
  }
  return '';
}

function matchHeader(cell, patterns) {
  const n = normCell(cell);
  for (const p of patterns) {
    if (typeof p === 'string') {
      if (n === p || n.startsWith(p)) return true;
    }
  }
  return false;
}

function findHeaderColumns(headerRow, startCol = 0) {
  const headers = headerRow || [];

  const idxDate = headers.findIndex((h, i) => i >= startCol && matchHeader(h, ['DATE']));

  const idxImp = headers.findIndex((h, i) => i >= startCol && matchHeader(h, ['IMPRESSIONS']));

  const idxClk = headers.findIndex((h, i) => i >= startCol && (() => {
    const n = normCell(h);
    return n === 'CLICKS' || n.startsWith('LINK CLICK') || n === 'LINK CLICKS';
  })());

  // "Leads" column: can be LEADS, PURCHASE, WEBSITE PURCHASE, MESSAGING CONVERSATIONS STARTED
  const idxLeads = headers.findIndex((h, i) => i >= startCol && (() => {
    const n = normCell(h);
    return (
      n === 'LEADS' ||
      n.startsWith('LEADS') ||
      n.startsWith('MESSAGING CONVERSATION') ||
      n.startsWith('WEBSITE LEADS') ||
      n.startsWith('WEBSITE') ||
      n === 'PURCHASE'
    );
  })());

  const idxAddToCart = headers.findIndex((h, i) => i >= startCol && (() => {
    const n = normCell(h);
    return (
      n === 'AD TO CART' ||
      n.startsWith('AD TO CART') ||
      n.startsWith('ADD TO CART')
    );
  })());

  // Spend column: SUMA, SPEND, AMOUNT SPENT
  const idxSpend = headers.findIndex((h, i) => i >= startCol && (() => {
    const n = normCell(h);
    return n === 'SUMA' || n === 'SPEND' || n.startsWith('AMOUNT SPENT');
  })());

  // These are OPTIONAL — set to -1 if not found
  const idxCpl = headers.findIndex((h, i) => i >= startCol && (() => {
    const n = normCell(h);
    return (
      n === 'CPL' ||
      n.startsWith('CPL') ||
      n.startsWith('COST PER LEAD') ||
      n.startsWith('COST PER PURCHASE')
    );
  })());
  const idxCpm = headers.findIndex((h, i) => i >= startCol && normCell(h).startsWith('CPM'));
  const idxCpc = headers.findIndex((h, i) => i >= startCol && normCell(h).startsWith('CPC'));
  const idxCtr = headers.findIndex((h, i) => i >= startCol && normCell(h).startsWith('CTR'));

  if (
    idxDate < 0 ||
    idxImp < 0 ||
    idxClk < 0 ||
    idxLeads < 0 ||
    idxSpend < 0
  ) {
    return null;
  }

  return {
    date: idxDate,
    impressions: idxImp,
    clicks: idxClk,
    leads: idxLeads,
    addToCart: idxAddToCart,
    spend: idxSpend,
    cpl: idxCpl,
    cpm: idxCpm,
    cpc: idxCpc,
    ctr: idxCtr,
  };
}

function rowHasTotalLabel(row, startCol, endCol) {
  const r = row || [];
  for (let c = startCol; c <= endCol && c < r.length; c++) {
    if (normCell(r[c]) === 'TOTAL') return true;
  }
  return false;
}

/**
 * @param {import('googleapis').sheets_v4.Sheets} sheets
 * @param {string} spreadsheetId
 * @param {string} sheetName
 */
export async function scanSheet(sheets, spreadsheetId, sheetName) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: sheetName,
  });

  const rows = res.data.values || [];
  const blocks = [];

  scanRows: for (let r = 0; r < rows.length; r++) {
    const row = rows[r] || [];
    const labelCols = [];
    for (let c = 0; c < row.length; c++) {
      if (isMetaAdsLabel(row[c])) labelCols.push(c);
    }
    if (labelCols.length === 0) continue;

    let maxTotalRowIndex = -1;

    for (const c of labelCols) {
      const blockNameRowIndex = r + 1;
      const headerRowIndex = r + 2;

      if (blockNameRowIndex >= rows.length || headerRowIndex >= rows.length) {
        continue;
      }

      const blockName = resolveBlockName(rows, blockNameRowIndex, c);
      if (!blockName) continue;

      const headerRow = rows[headerRowIndex] || [];
      const columns = findHeaderColumns(headerRow, c);
      if (!columns) continue;

      const dataStartRowIndex = headerRowIndex + 1;
      const colValues = Object.values(columns).filter((v) => v >= 0);
      const minCol = Math.min(...colValues);
      const maxCol = Math.max(...colValues);

      let totalRowIndex = -1;
      for (let dr = dataStartRowIndex; dr < rows.length; dr++) {
        if (rowHasTotalLabel(rows[dr], minCol, maxCol)) {
          totalRowIndex = dr;
          break;
        }
      }

      if (totalRowIndex < 0 || dataStartRowIndex >= totalRowIndex) {
        continue;
      }

      blocks.push({
        blockName: blockName.trim(),
        headerRowIndex,
        dataStartRowIndex,
        totalRowIndex,
        columns,
      });
      console.log('[sheet-scanner] Found block:', blockName.trim(), columns);

      maxTotalRowIndex = Math.max(maxTotalRowIndex, totalRowIndex);
    }

    if (maxTotalRowIndex >= 0) {
      r = maxTotalRowIndex;
      continue scanRows;
    }
  }

  return blocks;
}
