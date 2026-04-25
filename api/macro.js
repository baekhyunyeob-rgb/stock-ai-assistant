export const config = { runtime: 'edge' };

export default async function handler(req) {
  const symbols = ['^GSPC', '^IXIC', '^DJI', 'KRW=X', 'CL=F', '^TNX'];
  const results = [];

  for (const sym of symbols) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=2d`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      const meta = d.result?.[0]?.meta;
      if (!meta) continue;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose || meta.previousClose;
      const chg = price - prev;
      const pct = (chg / prev) * 100;
      results.push({ sym, price, chg, pct });
    } catch (e) {
      results.push({ sym, error: true });
    }
  }

  return new Response(JSON.stringify(results), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
