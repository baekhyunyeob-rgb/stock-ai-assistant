export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'GEMINI_API_KEY가 설정되지 않았습니다.' } });

  try {
    const { messages, system, max_tokens } = req.body;
    const systemText = system || '';
    const geminiContents = [];

    messages.forEach((msg, idx) => {
      let parts = [];
      if (typeof msg.content === 'string') {
        const text = idx === 0 && systemText ? `${systemText}\n\n${msg.content}` : msg.content;
        parts = [{ text }];
      } else if (Array.isArray(msg.content)) {
        msg.content.forEach(c => {
          if (c.type === 'text') {
            const text = idx === 0 && systemText ? `${systemText}\n\n${c.text}` : c.text;
            parts.push({ text });
          } else if (c.type === 'image') {
            parts.push({ inline_data: { mime_type: c.source.media_type, data: c.source.data } });
          }
        });
      }
      geminiContents.push({ role: msg.role === 'assistant' ? 'model' : 'user', parts });
    });

    // 종목발굴(discovery)에서는 Google 검색 연동
    const useSearch = req.body?.useSearch === true;
    const geminiBody = {
      contents: geminiContents,
      ...(useSearch ? { tools: [{ google_search: {} }] } : {}),
      generationConfig: { maxOutputTokens: max_tokens || 1000, temperature: 0.7 }
    };

    const model = 'gemini-2.5-flash-lite';
    // 스트리밍 엔드포인트
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;

    const geminiRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    if (!geminiRes.ok) {
      const err = await geminiRes.json();
      return res.status(500).json({ error: { message: err.error?.message || 'Gemini 오류' } });
    }

    // 스트리밍 응답 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = geminiRes.body.getReader();
    const decoder = new TextDecoder();
    let inputTokens = 0;
    let outputTokens = 0;
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) {
            res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
          // 토큰 수집
          if (parsed.usageMetadata) {
            inputTokens = parsed.usageMetadata.promptTokenCount || 0;
            outputTokens = parsed.usageMetadata.candidatesTokenCount || 0;
          }
        } catch (e) {}
      }
    }

    // 완료 신호 + 토큰 정보
    res.write(`data: ${JSON.stringify({ done: true, inputTokens, outputTokens })}\n\n`);
    res.end();

  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: { message: e.message } });
    } else {
      res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      res.end();
    }
  }
}
