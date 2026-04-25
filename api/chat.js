// Node.js runtime — 외부 API 호출 가능
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: { message: 'Method not allowed' } });

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: { message: 'GEMINI_API_KEY가 설정되지 않았습니다.' } });
  }

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

    const geminiBody = {
      contents: geminiContents,
      generationConfig: { maxOutputTokens: max_tokens || 1000, temperature: 0.7 }
    };

    const model = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiBody)
    });

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: { message: data.error.message } });

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const inputTokens = data.usageMetadata?.promptTokenCount || 0;
    const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;

    return res.status(200).json({
      content: [{ type: 'text', text }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens }
    });

  } catch (e) {
    return res.status(500).json({ error: { message: e.message } });
  }
}
