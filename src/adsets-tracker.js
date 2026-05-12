import { google } from 'googleapis';
import { getGoogleAuth } from './config.js';

const GRAPH_VERSION = 'v21.0';
const TAB_NAME = 'AD STATUS';

function sheetRange(tabName, a1) {
  const escaped = tabName.replace(/'/g, "''");
  return `'${escaped}'!${a1}`;
}

function toDisplayStatus(effectiveStatus) {
  return String(effectiveStatus ?? '').toUpperCase() === 'ACTIVE'
    ? 'Активная'
    : 'Неактивная';
}

/**
 * @param {string} adAccountId
 * @param {string} accessToken
 * @returns {Promise<Array<{ name: string, effective_status: string }> | null>}
 */
async function fetchAllAdsets(adAccountId, accessToken) {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/adsets`;
  const results = [];

  let url = `${base}?${new URLSearchParams({
    fields: 'name,effective_status',
    limit: '500',
    access_token: accessToken,
  })}`;

  try {
    while (url) {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error(
          '[adsets-tracker] Meta API error:',
          res.status,
          data.error || data
        );
        return null;
      }

      const items = Array.isArray(data.data) ? data.data : [];
      for (const row of items) {
        results.push({
          name: String(row.name ?? ''),
          effective_status: String(row.effective_status ?? ''),
        });
      }

      const next = data.paging?.next;
      url = typeof next === 'string' && next.length > 0 ? next : null;
    }
  } catch (err) {
    console.error('[adsets-tracker] Request failed:', err);
    return null;
  }

  return results;
}

/**
 * @param {string[][]} rows [name, displayStatus][]
 */
function sortAdsetRows(rows) {
  return [...rows].sort((a, b) => {
    const ordA = a[1] === 'Активная' ? 0 : 1;
    const ordB = b[1] === 'Активная' ? 0 : 1;
    if (ordA !== ordB) return ordA - ordB;
    return a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });
  });
}

export async function syncAdsets() {
  const accessToken = process.env.META_ACCESS_TOKEN;
  const adAccountId = process.env.META_AD_ACCOUNT_ID_TOPMAG;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID_TOPMAG_ADSETS;

  if (!accessToken) {
    console.error('[adsets-tracker] META_ACCESS_TOKEN is not set');
    return;
  }
  if (!adAccountId) {
    console.error('[adsets-tracker] META_AD_ACCOUNT_ID_TOPMAG is not set');
    return;
  }
  if (!spreadsheetId) {
    console.error('[adsets-tracker] GOOGLE_SPREADSHEET_ID_TOPMAG_ADSETS is not set');
    return;
  }

  const raw = await fetchAllAdsets(adAccountId, accessToken);
  if (raw === null) {
    return;
  }

  console.log(
    '[adsets-debug] raw:',
    raw.map((a) => ({ name: a.name, status: a.effective_status }))
  );

  const nameFilter = /^\d{1,6}\s*(\/|\|)/;
  const byKey = new Map();
  for (const a of raw) {
    if (!nameFilter.test(a.name)) continue;
    const m = a.name.match(/^(\d{1,6})/);
    if (!m) continue;
    const key = m[1];
    const isActive = String(a.effective_status ?? '').toUpperCase() === 'ACTIVE';
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, {
        firstName: a.name,
        firstActiveName: isActive ? a.name : null,
        hasActive: isActive,
      });
    } else if (isActive) {
      prev.hasActive = true;
      if (prev.firstActiveName == null) prev.firstActiveName = a.name;
    }
  }
  const rows = [...byKey.values()].map((g) => [
    g.hasActive ? g.firstActiveName : g.firstName,
    toDisplayStatus(g.hasActive ? 'ACTIVE' : 'PAUSED'),
  ]);
  const sorted = sortAdsetRows(rows);
  const activeCount = sorted.filter((r) => r[1] === 'Активная').length;
  const inactiveCount = sorted.length - activeCount;

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { data: meta } = await sheets.spreadsheets.get({ spreadsheetId });
  const tabSheet = meta.sheets?.find((s) => s.properties?.title === TAB_NAME);
  const hasTab = Boolean(tabSheet);
  let sheetId = tabSheet?.properties?.sheetId;

  if (!hasTab) {
    const addRes = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: TAB_NAME } } }],
      },
    });
    sheetId = addRes.data.replies?.[0]?.addSheet?.properties?.sheetId;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: sheetRange(TAB_NAME, 'A1:B1'),
    valueInputOption: 'RAW',
    requestBody: { values: [['Название адсета', 'Статус']] },
  });

  await sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: sheetRange(TAB_NAME, 'A2:B'),
  });

  if (sorted.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: sheetRange(TAB_NAME, 'A2'),
      valueInputOption: 'RAW',
      requestBody: { values: sorted },
    });
  }

  if (sorted.length > 0 && sheetId != null) {
    const bgActive = { red: 0.714, green: 0.843, blue: 0.659 };
    const bgInactive = { red: 0.918, green: 0.600, blue: 0.600 };
    const formatRequests = sorted.map((row, i) => ({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: i + 1,
          endRowIndex: i + 2,
          startColumnIndex: 0,
          endColumnIndex: 2,
        },
        cell: {
          userEnteredFormat: {
            backgroundColor:
              row[1] === 'Активная' ? bgActive : bgInactive,
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    }));

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: formatRequests },
    });
  }

  console.log(
    `[adsets-tracker] Adsets written: ${activeCount} active, ${inactiveCount} inactive (total ${sorted.length})`
  );
}
