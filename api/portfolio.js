import { readFileSync } from 'fs';
import { join } from 'path';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { stocks } = req.body || {};

  const tryFetch = async (symbol) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const d = await r.json();
      return d?.chart?.result?.[0];
    } catch(e) { return null; }
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
    // 1. 코스피 기준 날짜 확보
    const ksResult = await tryFetch('^KS11');
    if (!ksResult) return res.status(500).json({ error: '코스피 데이터 없음' });

    const ksDates = (ksResult?.timestamp || []).map(t => {
      const d = new Date(t * 1000);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    });
    const ksCloses = (ksResult?.indicators?.quote?.[0]?.close || []);

    // 코스피 날짜-가격 맵
    const ksPriceMap = {};
    ksDates.forEach((date, i) => { if(ksCloses[i] != null) ksPriceMap[date] = ksCloses[i]; });

    // 최근 60 거래일 기준 날짜 목록
    const days = 60;
    const baseDates = ksDates.filter(d => ksPriceMap[d] != null).slice(-days);
    const N = baseDates.length;

    // 2. 코스닥 - baseDates 기준으로 맞추기
    const kqResult = await tryFetch('^KQ11');
    const kqDates = (kqResult?.timestamp || []).map(t => {
      const d = new Date(t * 1000);
      return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    });
    const kqCloses = (kqResult?.indicators?.quote?.[0]?.close || []);
    const kqPriceMap = {};
    kqDates.forEach((date, i) => { if(kqCloses[i] != null) kqPriceMap[date] = kqCloses[i]; });

    // baseDates 기준으로 배열 생성 (없는 날은 null)
    const alignTo = (priceMap) => baseDates.map(d => priceMap[d] ?? null);

    const kospi60  = alignTo(ksPriceMap);
    const kosdaq60 = alignTo(kqPriceMap);

    // 3. 보유종목 총액
    const portfolioMap = {};
    for (const stock of (stocks || [])) {
      const code = stock.stockCode || stockMap[stock.name];
      if (!stock.qty || !code) continue;
      try {
        let result = await tryFetch(`${code}.KS`);
        if (!result) result = await tryFetch(`${code}.KQ`);
        if (!result) continue;

        const stDates = (result?.timestamp || []).map(t => {
          const d = new Date(t * 1000);
          return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        });
        const stCloses = (result?.indicators?.quote?.[0]?.close || []);
        const stMap = {};
        stDates.forEach((date, i) => { if(stCloses[i] != null) stMap[date] = stCloses[i]; });

        baseDates.forEach((date, i) => {
          const price = stMap[date];
          if(price != null) portfolioMap[i] = (portfolioMap[i] || 0) + price * stock.qty;
        });
      } catch(e) {}
    }

    const portfolio60 = baseDates.map((_, i) => portfolioMap[i] ?? null);

    // 4. 개별 종목 데이터
    const individual = {};
    for (const stock of (stocks || [])) {
      const code = stock.stockCode || stockMap[stock.name];
      if (!code) continue;
      try {
        let r = await tryFetch(`${code}.KS`);
        if (!r) r = await tryFetch(`${code}.KQ`);
        if (!r) continue;

        const stDates = (r?.timestamp || []).map(t => {
          const d = new Date(t * 1000);
          return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
        });
        const stCloses = (r?.indicators?.quote?.[0]?.close || []);
        const stMap = {};
        stDates.forEach((date, i) => { if(stCloses[i] != null) stMap[date] = stCloses[i]; });

        individual[stock.name] = baseDates.map(d => stMap[d] ?? null);
      } catch(e) {}
    }

    // 5. 표시용 날짜 (MM/DD)
    const dates = baseDates.map(d => d.slice(5).replace('-', '/'));

    return res.status(200).json({
      dates,
      rawDates: baseDates,
      kospi:    kospi60,
      kosdaq:   kosdaq60,
      portfolio: portfolio60,
      individual
    });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
