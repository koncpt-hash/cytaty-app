export default function handler(req, res) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const token  = process.env.AIRTABLE_TOKEN;

  if (!baseId || !token) {
    return res.status(503).json({ error: 'App not configured — set env vars in Vercel' });
  }

  res.setHeader('Cache-Control', 'no-store');
  res.json({ baseId, token });
}
