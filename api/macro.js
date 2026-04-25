export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const symbols = [
    { sym: '%5EKS11', label: '코스피',   unit: '' },
    { sym: '%5EKQ11', label: '코스닥',   unit: '' },
    { sym: '%5EGSPC', label: 'S&P500',  unit: '' },
    { sym: '%5EIXIC', label: '나스닥',   unit: '' },
    { sym: '%5EDJI',  label: '다우',     unit: '' },
    { sym: '%5ESOX',  label: '반도체SOX',unit: '' },
    { sym: 'KRW=X',   label: '달러/원',  unit: '원' },
    { sym: 'BZ=F',    label: '유가(브렌트)', unit: '$' },
    { sym: '%5ETNX',  label: '금리10Y',  unit: '%' },
  ];

  const results = [];

  for (const s of symbols) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${s.sym}?interval=1d&range=2d`;
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept': 'application/json',
        }
      });
      const d = await r.json();
      const meta = d?.chart?.result?.[0]?.meta;
      if (!meta) continue;

      const price = meta.regularMarketPrice;
      const prev  = meta.chartPreviousClose || meta.previousClose || price;
      const chg   = price - prev;
      const pct   = prev !== 0 ? (chg / prev) * 100 : 0;

      results.push({
        sym:   s.sym,
        label: s.label,
        unit:  s.unit,
        price,
        chg,
        pct,
        error: false
      });
    } catch (e) {
      results.push({ sym: s.sym, label: s.label, unit: s.unit, error: true });
    }
  }

  return res.status(200).json(results);
}
