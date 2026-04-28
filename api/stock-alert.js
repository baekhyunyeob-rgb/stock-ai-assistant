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

function trendDir(slope, basePrice) {
  const pct = (slope / basePrice) * 100;
  if (pct > 0.15) return 'up';
  if (pct < -0.15) return 'down';
  return 'flat';
}

// 추세 변화 스토리 생성
function buildStory(t60, t20, t5, position, spikeInfo, fromHigh60, fromLow60) {
  const isRecentSpike = spikeInfo !== null;
  const isRecentUp = spikeInfo && spikeInfo.includes('급등');
  const isRecentDown = spikeInfo && spikeInfo.includes('급락');

  // 급등/급락 후 패턴
  if (isRecentUp && (position === 'high' || position === 'shoulder')) {
    return { story: '급등 후 고점 정체 → 어깨 주의', signal: 'shoulder' };
  }
  if (isRecentDown && (position === 'low' || position === 'knee')) {
    return { story: '급락 후 저점 정체 → 무릎 주의', signal: 'knee' };
  }
  if (isRecentUp && t5 === 'flat') {
    return { story: '급등 후 숨고르기 중', signal: 'caution' };
  }
  if (isRecentDown && t5 === 'flat') {
    return { story: '급락 후 반발 매수 관망', signal: 'watch' };
  }

  // 어깨 신호: 장기/중기 상승 → 단기 하락 + 고점 근처
  if (t60 === 'up' && t20 === 'up' && t5 === 'down' && (position === 'high' || position === 'shoulder')) {
    return { story: '상승 후 고점 근처 하락 시작 → 어깨 신호', signal: 'shoulder' };
  }
  if (t60 === 'up' && t20 === 'down' && t5 === 'down' && position === 'shoulder') {
    return { story: '고점 이후 하락 전환 → 어깨 확인', signal: 'shoulder' };
  }

  // 무릎 신호: 장기/중기 하락 → 단기 상승 + 저점 근처
  if (t60 === 'down' && t20 === 'down' && t5 === 'up' && (position === 'low' || position === 'knee')) {
    return { story: '하락 후 저점 근처 반등 시작 → 무릎 신호', signal: 'knee' };
  }
  if (t60 === 'down' && t20 === 'up' && t5 === 'up' && position === 'knee') {
    return { story: '저점 이후 상승 전환 → 무릎 확인', signal: 'knee' };
  }

  // 일반 추세 변화 패턴
  if (t60 === 'up' && t20 === 'up' && t5 === 'up') {
    return { story: '60일 꾸준한 상승 지속 중', signal: 'up' };
  }
  if (t60 === 'up' && t20 === 'up' && t5 === 'down') {
    return { story: '상승 추세 중 단기 조정', signal: 'caution' };
  }
  if (t60 === 'up' && t20 === 'up' && t5 === 'flat') {
    return { story: '상승 추세 중 단기 숨고르기', signal: 'neutral' };
  }
  if (t60 === 'up' && t20 === 'down' && t5 === 'down') {
    return { story: '상승 후 중기 하락 전환', signal: 'shoulder' };
  }
  if (t60 === 'up' && t20 === 'down' && t5 === 'up') {
    return { story: '상승 후 조정 중 단기 반등', signal: 'watch' };
  }
  if (t60 === 'up' && t20 === 'flat' && t5 === 'down') {
    return { story: '상승 후 횡보, 단기 하락 조짐', signal: 'caution' };
  }
  if (t60 === 'down' && t20 === 'down' && t5 === 'down') {
    return { story: '60일 지속 하락 중', signal: 'down' };
  }
  if (t60 === 'down' && t20 === 'down' && t5 === 'up') {
    return { story: '하락 중 단기 반등 시도', signal: 'watch' };
  }
  if (t60 === 'down' && t20 === 'up' && t5 === 'up') {
    return { story: '하락 후 반등 전환 시도 중', signal: 'knee' };
  }
  if (t60 === 'down' && t20 === 'up' && t5 === 'down') {
    return { story: '하락 후 단기 반등 꺾임', signal: 'caution' };
  }
  if (t60 === 'flat' && t20 === 'up' && t5 === 'up') {
    return { story: '횡보 중 상승 시도', signal: 'watch' };
  }
  if (t60 === 'flat' && t20 === 'down' && t5 === 'down') {
    return { story: '횡보 중 하락 시도', signal: 'caution' };
  }

  return { story: '방향성 없는 횡보', signal: 'neutral' };
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

      // 선형 회귀 추세
      const baseP = closes[Math.max(0, closes.length - 10)];
      const t60 = trendDir(linearSlope(closes), baseP);
      const t20 = trendDir(linearSlope(closes.slice(-20)), baseP);
      const t5  = trendDir(linearSlope(closes.slice(-5)),  baseP);

      // 60일 고점/저점
      const closes60 = closes.slice(-60);
      const high60 = Math.max(...closes60);
      const low60  = Math.min(...closes60);
      const fromHigh60 = ((lastClose - high60) / high60) * 100;
      const fromLow60  = ((lastClose - low60)  / low60)  * 100;

      // 위치
      let position = null;
      if      (fromHigh60 >= -15 && t20 === 'down' && t5 === 'down') position = 'shoulder';
      else if (fromLow60  <=  15 && t20 === 'up'   && t5 === 'up')   position = 'knee';
      else if (fromHigh60 >= -15) position = 'high';
      else if (fromLow60  <=  20) position = 'low';

      // 급등락 (최근 10일 내 ±5% 이상 — 더 넓게)
      let spikeInfo = null;
      const recent10 = closes.slice(-11);
      for (let i = recent10.length - 1; i >= 1; i--) {
        const dayChg = (recent10[i] - recent10[i-1]) / recent10[i-1] * 100;
        if (Math.abs(dayChg) >= 5) {
          const daysAgo = recent10.length - 1 - i;
          const label = daysAgo === 0 ? '오늘' : daysAgo === 1 ? '어제' : daysAgo + '일전';
          const dir = dayChg > 0 ? '▲' : '▼';
          spikeInfo = label + ' ' + dir + Math.abs(dayChg).toFixed(1) + '% ' + (dayChg > 0 ? '급등' : '급락');
          break;
        }
      }

      // 추세 변화 스토리
      const { story, signal } = buildStory(t60, t20, t5, position, spikeInfo, fromHigh60, fromLow60);

      // 거래량
      let volumeInfo = null;
      if (volumes.length >= 10) {
        const avgVol = volumes.slice(0, -1).reduce((a,b) => a+b, 0) / (volumes.length - 1);
        const ratio = volumes[volumes.length - 1] / avgVol;
        if (ratio >= 2) volumeInfo = '60일 평균 ' + ratio.toFixed(1) + '배';
      }

      // DART 최근 공시
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
        story,
        signal,
        fromHigh60: parseFloat(fromHigh60.toFixed(1)),
        fromLow60:  parseFloat(fromLow60.toFixed(1)),
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
