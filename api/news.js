import { readFileSync } from 'fs';
import { join } from 'path';

// 종목명 → corp_code 매핑 (stocks.csv)
function loadCorpMap() {
  try {
    const csv = readFileSync(join(process.cwd(), 'data/stocks.csv'), 'utf-8');
    const lines = csv.trim().split('\n').slice(1);
    const map = {};
    for (const line of lines) {
      const [corp_name, stock_code, corp_code] = line.split(',');
      if (corp_name && corp_code) {
        map[corp_name.trim()] = { stock_code: stock_code?.trim(), corp_code: corp_code?.trim() };
      }
    }
    return map;
  } catch(e) { return {}; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const dartKey = process.env.DART_API_KEY;
  const { stocks = [] } = req.body || {};
  const corpMap = loadCorpMap();
  const results = [];

  // 오늘부터 30일 전
  const today = new Date();
  const bgn = new Date(today - 7 * 24 * 60 * 60 * 1000);
  const fmt = d => d.toISOString().slice(0,10).replace(/-/g,'');
  const bgnDe = fmt(bgn);

  for (const stock of stocks.slice(0, 4)) {
    const info = corpMap[stock.name];

    // 1. DART 공시 (corp_code 있을 때)
    if (dartKey && info?.corp_code) {
      try {
        const url = `https://opendart.fss.or.kr/api/list.json?crtfc_key=${dartKey}&corp_code=${info.corp_code}&bgn_de=${bgnDe}&page_count=3`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        const data = await r.json();
        if (data.list?.length > 0) {
          data.list.forEach(item => {
            results.push({
              type: 'dart',
              corp_name: stock.name,
              title: item.report_nm,
              date: item.rcept_dt,
              rcept_no: item.rcept_no,
              url: `https://dart.fss.or.kr/dsaf001/main.do?rcept_no=${item.rcept_no}`
            });
          });
        }
      } catch(e) {}
    }

    // 2. 구글 뉴스 RSS - 종목명 포함 기사만
    try {
      const query = encodeURIComponent(`"${stock.name}" 주가`);
      const rssUrl = `https://news.google.com/rss/search?q=${query}&hl=ko&gl=KR&ceid=KR:ko`;
      const r = await fetch(rssUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
      const txt = await r.text();

      const itemMatches = txt.match(/<item>([\s\S]*?)<\/item>/g) || [];
      let added = 0;
      for (const item of itemMatches) {
        if (added >= 2) break;
        const titleMatch = item.match(/<title>([\s\S]*?)<\/title>/);
        const dateMatch  = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
        const linkMatch  = item.match(/<link>([\s\S]*?)<\/link>/);
        if (titleMatch) {
          const title = titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
          const date  = dateMatch?.[1]?.trim() || '';
          const link  = linkMatch?.[1]?.trim() || '';
          // 종목명이 제목에 포함된 것만
          if (title && title.includes(stock.name) && !title.includes('Google 뉴스')) {
            results.push({ type:'news', corp_name:stock.name, title, date, url:link });
            added++;
          }
        }
      }
    } catch(e) {}
  }

  // 날짜순 정렬 (최신 먼저)
  results.sort((a, b) => new Date(b.date) - new Date(a.date));

  return res.status(200).json(results.slice(0, 20));
}
