export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  const symbol = String(req.query?.symbol || '').trim().toUpperCase()
  const interval = String(req.query?.interval || '5m')
  const range = String(req.query?.range || '5d')
  if (!/^[A-Z0-9][A-Z0-9.\-^=]{0,14}$/.test(symbol) || !/^(1m|2m|5m|15m|30m|60m|90m|1h|1d|1wk)$/.test(interval) || !/^(1d|5d|1mo|3mo|6mo|1y|2y|5y|max)$/.test(range)) {
    return res.status(400).json({ error: 'Invalid chart request' })
  }
  try {
    const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?interval=' + interval + '&range=' + range
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(7000) })
    if (!response.ok) throw new Error('Chart provider returned ' + response.status)
    const payload = await response.json()
    res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30')
    return res.status(200).json(payload)
  } catch (error) {
    return res.status(502).json({ error: 'Chart data unavailable', detail: error instanceof Error ? error.message : 'Unknown error' })
  }
}
