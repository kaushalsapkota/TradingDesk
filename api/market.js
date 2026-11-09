export default async function handler(req, res) {
  const raw = String(req.query?.symbols || 'SPY,QQQ').split(',').slice(0, 40)
  const symbols = raw.map(symbol => symbol.replace(/[^A-Za-z0-9.=^_-]/g, '')).filter(Boolean)
  const result = await Promise.all(symbols.map(async symbol => {
    const target = symbol.endsWith('-USD')
      ? `https://api.coinbase.com/v2/exchange-rates?currency=${encodeURIComponent(symbol.replace('-USD', ''))}`
      : `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol.replace('^', ''))}/info?assetclass=${['SPY','QQQ','IWM','DIA','VTI','VOO'].includes(symbol) ? 'etf' : 'stocks'}`}
    try {
      const response = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, cache: 'no-store' })
      if (!response.ok) return null
      const payload = await response.json()
      const data = payload?.data?.primaryData
      if (!data || data.lastSalePrice === 'N/A') return null
      const price = Number(String(data.lastSalePrice).replace(/[$,]/g, ''))
      const change = Number(String(data.netChange || 0).replace(/[$,%,+]/g, ''))
      const changePercent = Number(String(data.percentageChange || 0).replace(/[%+]/g, ''))
      if (!Number.isFinite(price)) return null
      return { symbol, regularMarketPrice: { raw: price }, regularMarketChange: { raw: Number.isFinite(change) ? change : 0 }, regularMarketChangePercent: { raw: Number.isFinite(changePercent) ? changePercent : 0 }, regularMarketTime: Date.now() / 1000, source: data.isRealTime ? 'Nasdaq real-time' : 'Nasdaq delayed' }
    } catch { return null }
  }))
  res.setHeader('Cache-Control', 'no-store')
  const clean = result.filter(Boolean)
  res.status(200).json({ data: clean.map(q => ({ symbol: q.symbol, price: q.regularMarketPrice.raw, changePercent: q.regularMarketChangePercent.raw })), quoteResponse: { result: clean, error: null } })
}
