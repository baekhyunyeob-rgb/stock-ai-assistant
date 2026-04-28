import { readFileSync } from 'fs';
import { join } from 'path';

function loadStockMap() {
  try {
    const csv = readFileSync(join(process.cwd(), 'data/stocks.csv'), 'utf-8');
    const lines = csv.trim().split('\n').slice(1);
    const map = {};
    for (const line of lines) {
      const [corp_name, stock_code, corp_code] = line.split(',');
      if (corp_name && stock_code) {
        map[corp_name.trim()] = { stock_code: stock_code?.trim(), corp_code: corp_code?.trim() };
      }
    }
    return map;
  } catch(e) { return {}; }
}

// 선형 회귀 기울기
function linearSlope(arr) {
  const n = arr.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = arr.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (arr[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// 추세 방향
function trendDir(slope, basePrice) {
  const pct = (slope / basePrice) * 100;
  if (pct > 0.15) return 'up';
  if (pct < -0.15) return 'down';
  return 'flat';
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

      // 3개월 데이터
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
      const closes  = (result.indicators?.quote?.[0]?.close  || []).filter(c => c != null);
      const volumes = (result.indicators?.quote?.[0]?.volume || []).filter(v => v != null);

      if (closes.length < 10) {
        results.push({ name: stock.name, stockCode, error: '데이터 부족' });
        continue;
      }

      const lastClose = closes[closes.length - 1];
      const prevClose = closes[closes.length - 2];
      const change = ((lastClose - prevClose) / prevClose) * 100;
      const profitRate = stock.avg ? ((lastClose - stock.avg) / stock.avg) * 100 : null;

      // ── 선형 회귀 추세 ──
      const baseP = closes[Math.max(0, closes.length - 10)];
      const t60 = trendDir(linearSlope(closes),           baseP);
      const t20 = trendDir(linearSlope(closes.slice(-20)), baseP);
      const t5  = trendDir(linearSlope(closes.slice(-5)),  baseP);

      let trendSummary;
      if      (t60==='up'   && t20==='up'   && t5==='up')   trendSummary = '지속 상승';
      else if (t60==='up'   && t20==='up'   && t5==='down') trendSummary = '상승 중 단기 조정';
      else if (t60==='up'   && t20==='down' && t5==='down') trendSummary = '상승 후 하락 전환';
      else if (t60==='up'   && t20==='down' && t5==='up')   trendSummary = '하락 중 단기 반등';
      else if (t60==='down' && t20==='down' && t5==='down') trendSummary = '지속 하락';
      else if (t60==='down' && t20==='down' && t5==='up')   trendSummary = '하락 중 단기 반등';
      else if (t60==='down' && t20==='up'   && t5==='up')   trendSummary = '하락 후 상승 전환';
      else if (t60==='down' && t20==='up'   && t5==='down') trendSummary = '하락 후 단기 상승';
      else trendSummary = '횡보';

      // ── 60일 고점/저점 ──
      const closes60 = closes.slice(-60);
      const high60 = Math.max(...closes60);
      const low60  = Math.min(...closes60);
      const fromHigh60 = ((lastClose - high60) / high60) * 100;
      const fromLow60  = ((lastClose - low60)  / low60)  * 100;

      // ── 어깨/무릎 신호 ──
      let position = null;
      if      (fromHigh60 >= -15 && t20 === 'down' && t5 === 'down') position = 'shoulder';
      else if (fromLow60  <=  15 && t20 === 'up'   && t5 === 'up')   position = 'knee';
      else if (fromHigh60 >= -15) position = 'high';
      else if (fromLow60  <=  20) position = 'low';

      // ── 급등락 — 최근 5일 내 ±5% 이상 ──
      let spikeInfo = null;
      const recent5 = closes.slice(-6); // 최근 6개로 5일간 변동 계산
      for (let i = recent5.length - 1; i >= 1; i--) {
        const dayChg = (recent5[i] - recent5[i-1]) / recent5[i-1] * 100;
        if (Math.abs(dayChg) >= 5) {
          const daysAgo = recent5.length - 1 - i;
          const label = daysAgo === 0 ? '오늘' : daysAgo === 1 ? '어제' : `${daysAgo}일전`;
          const dir = dayChg > 0 ? '▲' : '▼';
          spikeInfo = `${label} ${dir}${Math.abs(dayChg).toFixed(1)}% ${dayChg > 0 ? '급등' : '급락'}`;
          break;
        }
      }

      // ── 거래량 급증 ──
      let volumeInfo = null;
      if (volumes.length >= 10) {
        const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / (volumes.length - 1);
        const lastVol = volumes[volumes.length - 1];
        const ratio = lastVol / avgVol;
        if (ratio >= 2) {
          volumeInfo = `60일 평균 ${ratio.toFixed(1)}배`;
        }
      }

      // ── DART 최근 공시 ──
      let dartTitle = null;
      let dartUrl = null;
      if (dartKey && info?.corp_code) {
        try {
          const dr = await fetch(
            `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&corp_code=${info.corp_code}&bgn_de=${bgnDe}&page_count=1`,
            { headers: { 'User-Agent': 'Mozilla/5.0' } }
          );
          const dd = await dr.json();
          if (dd.list?.length > 0) {
            dartTitle = dd.list[0].report_nm.trim();
            dartUrl = `https://dart.fss.or.kr/dsaf001/main.do?rcept_no=${dd.list[0].rcept_no}`;
          }
        } catch(e) {}
      }

      // ── 손익 알림 ──
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
        trendSummary,
        t60, t20, t5,
        fromHigh60: parseFloat(fromHigh60.toFixed(1)),
        fromLow60:  parseFloat(fromLow60.toFixed(1)),
        position,
        spikeInfo,
        volumeInfo,
        dartTitle,
        dartUrl,
        alertType,
        alert: Math.abs(change) >= pct
      });

    } catch(e) {
      results.push({ name: stock.name, error: e.message });
    }
  }

  return res.status(200).json(results);
}
