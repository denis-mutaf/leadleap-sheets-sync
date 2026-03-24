const GRAPH_VERSION = 'v21.0';

function parseNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {string} adAccountId
 * @param {string} accessToken
 * @param {string} date YYYY-MM-DD
 * @returns {Promise<Array<{ campaignName: string, impressions: number, clicks: number, spend: number, actions: Record<string, number> }>>}
 */
export async function fetchDailyInsights(adAccountId, accessToken, date) {
  const base = `https://graph.facebook.com/${GRAPH_VERSION}/act_${adAccountId}/insights`;
  const results = [];

  let url = `${base}?${new URLSearchParams({
    time_range: JSON.stringify({ since: date, until: date }),
    level: 'campaign',
    fields: 'campaign_name,impressions,clicks,inline_link_clicks,spend,actions',
    limit: '500',
    access_token: accessToken,
  })}`;

  try {
    console.log('[meta-fetcher] Fetching insights for account', adAccountId, 'date', date);
    while (url) {
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error(
          '[meta-fetcher] Meta API error:',
          res.status,
          data.error || data
        );
        return [];
      }

      const items = Array.isArray(data.data) ? data.data : [];
      for (const row of items) {
        const actionsMap = {};
        if (Array.isArray(row.actions)) {
          for (const a of row.actions) {
            if (a && a.action_type) {
              actionsMap[a.action_type] =
                (actionsMap[a.action_type] || 0) + parseNumber(a.value);
            }
          }
        }
        results.push({
          campaignName: String(row.campaign_name ?? ''),
          impressions: parseNumber(row.impressions),
          clicks: parseNumber(row.inline_link_clicks ?? row.clicks),
          spend: parseNumber(row.spend),
          actions: actionsMap,
        });
      }

      const next = data.paging?.next;
      url = typeof next === 'string' && next.length > 0 ? next : null;
    }
    console.log('[meta-fetcher] Results:', results.length, 'campaigns:', results.map(r => ({ name: r.campaignName, spend: r.spend, actionTypes: Object.keys(r.actions) })));
  } catch (err) {
    console.error('[meta-fetcher] Request failed:', err);
    return [];
  }

  return results;
}
