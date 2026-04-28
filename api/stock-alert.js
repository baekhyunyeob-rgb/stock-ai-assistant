import { readFileSync } from 'fs';
import { join } from 'path';

function loadStockMap() {
  try {
    const csv = readFileSync(join(process.cwd(), 'data/stocks.csv'), 'utf-8');
    const lines = csv.trim().split('\n').slice(1);
    const map = {};
    for (const line of lines) {
      const [corp_name, stock_code, corp_code] = line.split(',');
      if (corp_name && stock_code) map[corp_name.trim()] = { stock_code: stock_code?.trim(), corp_code: corp_code?.trim() };
    }
    return map;
  } catch(e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dartKey = process.env.DART_API_KEY;
  const { stocks, threshold } = req.body || {};
  const pct = parseFloat(threshold) || 5;
  const corpMap = loadStockMap();
  const results = [];

  const today = new Date();
  const bgn = new Date(today - 7 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0,10).replace(/-/g,'');
  const bgnDe = fmt(bgn);

  for (const stock of stocks) {
    try {
      const info = corpMap[stock.name];
      const stockCode = stock.stockCode || info?.stock_code;
      if (!stockCode) {
        results.push({ name: stock.name, error: '종목코드 없음' });
        continue;
      }

      // 3개월 데이터 요청 (60일 고점/저점 계산용)
      const tryFetch = async (symbol) => {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return await r.json();
      };

      let data = await tryFetch(`${stockCode}.KS`);
      if (!data?.chart?.result?.[0]) data = await tryFetch(`${stockCode}.KQ`);
      if (!data?.chart?.result?.[0]) {
        results.push({ name: stock.name, stockCode, error: '시세 없음' });
        continue;
      }

      const result = data.chart.result[0];
      const meta = result.meta;
      const allCloses = result.indicators?.quote?.[0]?.close || [];
      const allVolumes = result.indicators?.quote?.[0]?.volume || [];
      const closes = allCloses.filter(c => c !== null);
      const volumes = allVolumes.filter(v => v !== null);

      if (closes.length < 5) {
        results.push({ name: stock.name, stockCode, error: '데이터 부족' });
        continue;
      }

      const lastClose = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];

      // 전일대비 등락률
      const change = ((lastClose - prevClose) / prevClose) * 100;

      // 평단가 대비 수익률
      const profitRate = stock.avg ? ((lastClose - stock.avg) / stock.avg) * 100 : null;

      // 20일 추세
      const trend20 = closes.slice(-20);
      let trend = '횡보';
      if (trend20.length >= 5) {
        const half = Math.floor(trend20.length / 2);
        const firstHalf = trend20.slice(0, half).reduce((a,b)=>a+b,0) / half;
        const secondHalf = trend20.slice(half).reduce((a,b)=>a+b,0) / (trend20.length - half);
        const diff = (secondHalf - firstHalf) / firstHalf * 100;
        if (diff > 3) trend = '상승';
        else if (diff < -3) trend = '하락';
      }

      // 급등락 (3개월 중 ±5% 이상 단일 일봉)
      let hasSpike = false;
      for (let i = 1; i < closes.length; i++) {
        if (Math.abs((closes[i] - closes[i-1]) / closes[i-1] * 100) >= 5) {
          hasSpike = true; break;
        }
      }

      // 60일 고점/저점
      const closes60 = closes.slice(-60);
      const high60 = Math.max(...closes60);
      const low60 = Math.min(...closes60);
      const fromHigh60 = ((lastClose - high60) / high60) * 100;
      const fromLow60 = ((lastClose - low60) / low60) * 100;

      // 어깨/무릎 신호
      // 어깨: 60일 고점 대비 -10% 이내 + 20일 하락 추세
      // 무릎: 60일 저점 대비 +10% 이내 + 20일 상승 추세
      let position = null;
      if (fromHigh60 >= -10 && trend === '하락') position = 'shoulder'; // 어깨
      else if (fromLow60 <= 10 && trend === '상승') position = 'knee';   // 무릎
      else if (fromHigh60 >= -15) position = 'high';   // 고점 근처
      else if (fromLow60 <= 20) position = 'low';      // 저점 근처

      // 거래량 급증 (최근 거래량 vs 평균 2배 이상)
      let volumeSpike = false;
      if (volumes.length >= 5) {
        const avgVol = volumes.slice(0, -1).reduce((a,b)=>a+b,0) / (volumes.length - 1);
        if (volumes[volumes.length - 1] > avgVol * 2) volumeSpike = true;
      }

      // 최근 공시 (DART 7일)
      let hasDart = false;
      if (dartKey && info?.corp_code) {
        try {
          const dr = await fetch(`https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&corp_code=${info.corp_code}&bgn_de=${bgnDe}&page_count=1`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          const dd = await dr.json();
          if (dd.list?.length > 0) hasDart = true;
        } catch(e) {}
      }

      // 손익 알림
      let alertType = null;
      if (profitRate !== null) {
        if (stock.profitTarget && profitRate >= stock.profitTarget) alertType = 'profit';
        else if (stock.lossLimit && profitRate <= -Math.abs(stock.lossLimit)) alertType = 'loss';
      }

      results.push({
        name: stock.name,
        stockCode,
        lastClose: Math.round(lastClose),
        change: parseFloat(change.toFixed(2)),
        profitRate: profitRate !== null ? parseFloat(profitRate.toFixed(2)) : null,
        trend,
        hasSpike,
        fromHigh60: parseFloat(fromHigh60.toFixed(1)),
        fromLow60: parseFloat(fromLow60.toFixed(1)),
        position,  // shoulder/knee/high/low/null
        volumeSpike,
        hasDart,
        alertType,
        alert: Math.abs(change) >= pct
      });

    } catch(e) {
      results.push({ name: stock.name, error: e.message });
    }
  }

  return res.status(200).json(results);
}
