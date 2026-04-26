export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: { message: 'ANTHROPIC_API_KEY가 설정되지 않았습니다.' } });

  try {
    const body = req.body;

    // 스트리밍 응답 설정
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'messages-2023-06-01'
      },
      body: JSON.stringify({
        ...body,
        stream: true
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.json();
      return res.status(500).json({ error: { message: err.error?.message || 'Claude 오류' } });
    }

    const reader = claudeRes.body.getReader();
    const decoder = new TextDecoder();
    let inputTokens = 0, outputTokens = 0;
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
          if (parsed.type === 'content_block_delta') {
            const text = parsed.delta?.text || '';
            if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
          if (parsed.type === 'message_delta' && parsed.usage) {
            outputTokens = parsed.usage.output_tokens || 0;
          }
          if (parsed.type === 'message_start' && parsed.message?.usage) {
            inputTokens = parsed.message.usage.input_tokens || 0;
          }
        } catch(e) {}
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, inputTokens, outputTokens })}\n\n`);
    res.end();

  } catch(e) {
    if (!res.headersSent) res.status(500).json({ error: { message: e.message } });
    else { res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`); res.end(); }
  }
}
