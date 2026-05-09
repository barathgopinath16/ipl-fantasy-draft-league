// Vercel Serverless Function — CORS Proxy for IPL Fantasy API
// Bypasses browser CORS restrictions so the FE can fetch live data.

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint } = req.query;
  const API_BASE = 'https://fantasy.iplt20.com/classic/api';
  const API_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
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
    return res.status(400).json({ error: 'Invalid endpoint. Use: mixapi, fixtures, players' });
  }

  let url = `${API_BASE}${endpoints[endpoint]}`;

  // Forward query params for the players endpoint
  if (endpoint === 'players') {
    const { tourgamedayId, teamgamedayId, announcedVersion } = req.query;
    if (tourgamedayId) url += `&tourgamedayId=${tourgamedayId}`;
    if (teamgamedayId) url += `&teamgamedayId=${teamgamedayId}`;
    if (announcedVersion) url += `&announcedVersion=${announcedVersion}`;
  }

  try {
    const apiRes = await fetch(url, { headers: API_HEADERS });
    const data = await apiRes.json();
    res.status(200).json(data);
  } catch (err) {
    res.status(500).json({ error: 'API fetch failed', details: err.message });
  }
}
