export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { original, transcript } = req.body || {};
  if (!original || !transcript) {
    return res.status(400).json({ error: 'Missing original or transcript' });
  }

  const claudeKey = process.env.CLAUDE_KEY;
  if (!claudeKey) {
    return res.status(503).json({ error: 'Claude API key not configured' });
  }

  const prompt = `Oceniasz odpowiedź ucznia który miał zapamiętać cytat.

ORYGINAŁ:
"${original}"

ODPOWIEDŹ UCZNIA (transkrypcja głosowa):
"${transcript}"

Zasady oceny:
- DOKLADNIE: sens i większość słów zachowane, dopuszczalne drobne różnice w sformułowaniu
- PARAFRAZA: sens główny zachowany, ale inne słowa lub uproszczenie
- NIEZGODNE: sens zmieniony, niekompletny lub wypowiedź nie na temat

Odpowiedz JEDNYM słowem: DOKLADNIE lub PARAFRAZA lub NIEZGODNE`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': claudeKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 10,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    return res.status(response.status).json({ error: err.error?.message || 'Claude API error' });
  }

  const data = await response.json();
  const answer = data.content[0].text.trim().toUpperCase();

  let verdict = 'NIEZGODNE';
  if (answer.includes('DOKLADNIE')) verdict = 'DOKLADNIE';
  else if (answer.includes('PARAFRAZA')) verdict = 'PARAFRAZA';

  res.json({ verdict });
}
