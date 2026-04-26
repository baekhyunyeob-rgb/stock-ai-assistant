import { readFileSync } from 'fs';
import { join } from 'path';

// 종목명 → 종목코드 매핑 (stocks.csv)
function loadStockMap() {
  try {
    const csv = readFileSync(join(process.cwd(), 'data/stocks.csv'), 'utf-8');
    const lines = csv.trim().split('\n').slice(1); // 헤더 제거
    const map = {};
    for (const line of lines) {
      const [corp_name, stock_code] = line.split(',');
      if (corp_name && stock_code) {
        map[corp_name.trim()] = stock_code.trim();
      }
    }
    return map;
  } catch(e) {
    return {};
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { stocks, threshold } = req.body;
    const pct = parseFloat(threshold) || 5;
    const stockMap = loadStockMap();
    const results = [];

    for (const stock of stocks) {
      try {
        // 종목코드 조회
        const stockCode = stockMap[stock.name];
        if (!stockCode) {
          results.push({ name: stock.name, error: '종목코드 없음' });
          continue;
        }

        // 야후파이낸스 전일/전전일 종가
        const symbol = `${stockCode}.KS`;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await r.json();

        const closes = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
        if (!closes || closes.length < 2) {
          // 코스닥 종목은 .KQ 시도
          const urlKQ = `https://query1.finance.yahoo.com/v8/finance/chart/${stockCode}.KQ?interval=1d&range=5d`;
          const rKQ = await fetch(urlKQ, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const dataKQ = await rKQ.json();
          const closesKQ = dataKQ?.chart?.result?.[0]?.indicators?.quote?.[0]?.close;
          if (!closesKQ || closesKQ.length < 2) {
            results.push({ name: stock.name, stockCode, error: '시세 없음' });
            continue;
          }
          const validKQ = closesKQ.filter(c => c !== null);
          const prevKQ = validKQ[validKQ.length - 2];
          const lastKQ = validKQ[validKQ.length - 1];
          const changeKQ = ((lastKQ - prevKQ) / prevKQ) * 100;
          // 평단가 대비 수익률
          const profitRate = ((lastKQ - stock.avg) / stock.avg) * 100;
          results.push({
            name: stock.name, stockCode,
            prevClose: Math.round(prevKQ), lastClose: Math.round(lastKQ),
            change: parseFloat(changeKQ.toFixed(2)),
            profitRate: parseFloat(profitRate.toFixed(2)),
            alert: Math.abs(changeKQ) >= pct
          });
          continue;
        }

        const valid = closes.filter(c => c !== null);
        const prev = valid[valid.length - 2];
        const last = valid[valid.length - 1];
        const change = ((last - prev) / prev) * 100;
        // 평단가 대비 수익률
        const profitRate = ((last - stock.avg) / stock.avg) * 100;

        results.push({
          name: stock.name, stockCode,
          prevClose: Math.round(prev), lastClose: Math.round(last),
          change: parseFloat(change.toFixed(2)),
          profitRate: parseFloat(profitRate.toFixed(2)),
          alert: Math.abs(change) >= pct
        });

      } catch(e) {
        results.push({ name: stock.name, error: e.message });
      }
    }

    return res.status(200).json(results);

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
