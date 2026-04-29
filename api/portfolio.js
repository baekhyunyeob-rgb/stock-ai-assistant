import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stocks } = req.body || {};

  const tryFetch = async (symbol) => {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const d = await r.json();
    return d?.chart?.result?.[0];
  };

  let stockMap = {};
  try {
    const csv = readFileSync(join(process.cwd(), 'data/stocks.csv'), 'utf-8');
    for (const line of csv.trim().split('\n').slice(1)) {
      const [name, code] = line.split(',');
      if (name && code) stockMap[name.trim()] = code.trim();
    }
  } catch(e) {}

  try {
    // 1. 코스피, 코스닥 지수
    const [ksResult, kqResult] = await Promise.all([
      tryFetch('^KS11'),
      tryFetch('^KQ11')
    ]);

    const ksCloses = (ksResult?.indicators?.quote?.[0]?.close || []).filter(c => c != null);
    const kqCloses = (kqResult?.indicators?.quote?.[0]?.close || []).filter(c => c != null);
    const ksDates = (ksResult?.timestamp || []).map(t => {
      const d = new Date(t * 1000);
      return (d.getMonth()+1) + '/' + d.getDate();
    });
    const ksRawDates = (ksResult?.timestamp || []).map(t => {
      const d = new Date(t * 1000);
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    });

    // 최근 60일만
    const days = 60;
    const ks60 = ksCloses.slice(-days);
    const kq60 = kqCloses.slice(-days);
    const dates = ksDates.slice(-days);

    // 2. 보유종목 총액 (종목별 주가 × 수량)
    const portfolioMap = {}; // date index → 총액

    for (const stock of (stocks || [])) {
      const code = stock.stockCode || stockMap[stock.name];
      if (!stock.qty || !code) continue;
      try {
        let result = await tryFetch(`${code}.KS`);
        if (!result) result = await tryFetch(`${code}.KQ`);
        if (!result) continue;

        const closes = (result?.indicators?.quote?.[0]?.close || []).filter(c => c != null);
        const sc60 = closes.slice(-days);

        sc60.forEach((price, i) => {
          if (!portfolioMap[i]) portfolioMap[i] = 0;
          portfolioMap[i] += price * stock.qty;
        });
      } catch(e) {}
    }

    // 총액 배열
    const portfolio60 = Array.from({ length: ks60.length }, (_, i) => portfolioMap[i] || null);

    // 3. 시작점 100으로 정규화
    const normalize = (arr) => {
      const first = arr.find(v => v != null);
      if (!first) return arr;
      return arr.map(v => v != null ? parseFloat((v / first * 100).toFixed(2)) : null);
    };

    // 개별 종목 데이터도 반환
    const individual = {};
    for (const stock of (stocks || [])) {
      const code = stock.stockCode || stockMap[stock.name];
      if (!code) continue;
      try {
        let r = await tryFetch(`${code}.KS`);
        if (!r) r = await tryFetch(`${code}.KQ`);
        if (!r) continue;
        const sc = (r?.indicators?.quote?.[0]?.close || []).filter(c => c != null).slice(-days);
        individual[stock.name] = normalize(sc);
      } catch(e) {}
    }

    const rawDates = ksRawDates.slice(-days);

    return res.status(200).json({
      dates,
      rawDates,
      kospi:     normalize(ks60),
      kosdaq:    normalize(kq60),
      portfolio: normalize(portfolio60),
      individual
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
