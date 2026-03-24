function round6(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.round(n * 1e6) / 1e6;
}

/**
 * @param {number} impressions
 * @param {number} clicks
 * @param {number} leads
 * @param {number} spend
 */
export function calculateMetrics(impressions, clicks, leads, spend) {
  const imp = Number(impressions) || 0;
  const clk = Number(clicks) || 0;
  const ld = Number(leads) || 0;
  const sp = Number(spend) || 0;

  const cpl = ld === 0 ? null : sp / ld;
  const cpm = imp === 0 ? null : (sp / imp) * 1000;
  const cpc = clk === 0 ? null : sp / clk;
  const ctr = imp === 0 ? null : clk / imp;

  return {
    impressions: round6(imp),
    clicks: round6(clk),
    leads: round6(ld),
    spend: round6(sp),
    cpl: round6(cpl),
    cpm: round6(cpm),
    cpc: round6(cpc),
    ctr: round6(ctr),
  };
}
