// api/proxy.js — Vercel Serverless Proxy for IPL Fantasy API
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, ...extraParams } = req.query;
  const API_BASE = 'https://fantasy.iplt20.com/classic/api';
  const API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'application/json, text/plain, */*',
    'entity': 'd3tR0!t5m@sh',
    'Referer': 'https://fantasy.iplt20.com/classic/stats',
  };

  const endpoints = {
    'mixapi': '/live/mixapi?lang=en',
    'fixtures': '/feed/tour-fixtures?lang=en',
    'players': '/feed/gamedayplayers?lang=en',
  };

  if (!endpoint || !endpoints[endpoint]) {
    return res.status(400).json({ error: 'Missing or invalid endpoint' });
  }

  // Build URL and forward ALL extra query params from the browser request
  let url = `${API_BASE}${endpoints[endpoint]}`;
  for (const [key, value] of Object.entries(extraParams)) {
    url += `&${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }

  try {
    console.log(`Proxy -> ${url}`);
    const apiRes = await fetch(url, { headers: API_HEADERS, signal: AbortSignal.timeout(12000) });

    if (!apiRes.ok) {
      const text = await apiRes.text();
      return res.status(apiRes.status).json({ error: `IPL API returned ${apiRes.status}`, details: text });
    }

    const data = await apiRes.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('Proxy Error:', err);
    res.status(500).json({
      error: 'Proxy Fetch Failed',
      message: err.message,
      url: url
    });
  }
}
