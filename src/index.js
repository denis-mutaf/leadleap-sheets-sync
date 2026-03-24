import 'dotenv/config';
import cron from 'node-cron';
import { google } from 'googleapis';
import { projects, getGoogleAuth } from './config.js';
import { fetchDailyInsights } from './meta-fetcher.js';
import { calculateMetrics } from './metrics.js';
import { scanSheet } from './sheet-scanner.js';
import { writeBlockData, updateTotals } from './sheets-writer.js';

const MONTHS_EN = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];

function sheetNameForDateStr(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  return `${MONTHS_EN[m - 1]} ${y}`;
}

function dayOfMonthFromDateStr(dateStr) {
  return Number(dateStr.slice(8, 10));
}

function yesterdayUtcDateStr() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function aggregateCampaigns(insights, matchSubstring, resultAction, addToCartAction) {
  const needle = matchSubstring.toLowerCase();
  let impressions = 0;
  let clicks = 0;
  let leads = 0;
  let spend = 0;
  let addToCart = 0;
  for (const row of insights) {
    if (!row.campaignName.toLowerCase().includes(needle)) continue;
    console.log(`[agg-match] needle="${needle}" matched: ${row.campaignName}`);
    impressions += row.impressions;
    clicks += row.clicks;
    leads += row.actions[resultAction] || 0;
    if (addToCartAction) {
      addToCart += row.actions[addToCartAction] || 0;
    }
    spend += row.spend;
  }
  return { impressions, clicks, leads, spend, addToCart };
}

function blocksMatch(sheetBlockName, mappingBlockName) {
  return (
    sheetBlockName.trim().toLowerCase() ===
    mappingBlockName.trim().toLowerCase()
  );
}

async function syncDay(dateStr) {
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.error('META_ACCESS_TOKEN is not set');
    return;
  }

  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const sheetTabName = sheetNameForDateStr(dateStr);
  const dayOfMonth = dayOfMonthFromDateStr(dateStr);

  for (const project of projects) {
    try {
      if (!project.spreadsheetId || !project.adAccountId) {
        console.error(
          `[${project.name}] Missing spreadsheetId or adAccountId in environment`
        );
        continue;
      }

      const insights = await fetchDailyInsights(
        project.adAccountId,
        token,
        dateStr
      );

      let scanned;
      try {
        scanned = await scanSheet(
          sheets,
          project.spreadsheetId,
          sheetTabName
        );
      } catch (scanErr) {
        console.error(`[${project.name}] Sheet scan failed:`, scanErr);
        continue;
      }

      for (const mapping of project.campaignMapping) {
        const agg = aggregateCampaigns(
          insights,
          mapping.match,
          mapping.resultAction,
          mapping.addToCartAction
        );
        const metrics = calculateMetrics(
          agg.impressions,
          agg.clicks,
          agg.leads,
          agg.spend
        );
        metrics.addToCart = agg.addToCart;
        console.log(`[metrics-debug] ${project.name} / ${mapping.block}: spend=${agg.spend} leads=${agg.leads} impressions=${agg.impressions}`);
        console.log(`[block-match] looking for "${mapping.block}" in`, scanned.map(b => b.blockName));
        const block = scanned.find((b) =>
          blocksMatch(b.blockName, mapping.block)
        );
        if (!block) {
          console.warn(
            `[${project.name}] Block not found for mapping "${mapping.block}"`
          );
          continue;
        }
        console.log(`[spend-check] ${project.name} / ${mapping.block}: metrics.spend=${metrics.spend} type=${typeof metrics.spend}`);
        if (!(metrics.spend > 0)) {
          console.log(
            `[${project.name}] Skip write for "${mapping.block}": spend is 0`
          );
          continue;
        }

        try {
          await writeBlockData(
            sheets,
            project.spreadsheetId,
            sheetTabName,
            block,
            dayOfMonth,
            metrics
          );
        } catch (writeErr) {
          console.error(`[${project.name}] writeBlockData failed for "${mapping.block}":`, writeErr.message, writeErr);
        }
      }

      console.log(`[${project.name}] Sync finished for ${dateStr}`);
    } catch (err) {
      console.error(`[${project.name}] Sync failed:`, err);
    }
  }
}

const dateArg = process.argv[2];
if (dateArg && /^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  syncDay(dateArg)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
} else {
  console.log('Sheets sync service started, runs daily at 06:00 Europe/Chisinau');

  cron.schedule(
    '0 6 * * *',
    async () => {
      const y = yesterdayUtcDateStr();
      await syncDay(y);
    },
    { timezone: 'Europe/Chisinau' }
  );
}
