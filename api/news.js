export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { stocks } = await req.json().catch(() => ({ stocks: [] }));
  const queries = [...(stocks || []).slice(0, 2), '코스피', '미국증시'];
  const allNews = [];

  for (const q of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + ' 주식')}&hl=ko&gl=KR&ceid=KR:ko`;
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const txt = await r.text();
      const matches = [...txt.matchAll(/<title><!\[CDATA\[(.*?)\]\]><\/title>/g)];
      matches.slice(1, 4).forEach(m => {
        const title = m[1].trim();
        if (title && !allNews.find(n => n.title === title)) {
          allNews.push({ title, query: q });
        }
      });
    } catch (e) {}
  }

  return new Response(JSON.stringify(allNews.slice(0, 20)), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
