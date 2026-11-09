export default async function handler(req, res) {
  const raw = String(req.query?.symbols || 'SPY,QQQ').split(',').slice(0, 40)
  const symbols = raw.map(symbol => symbol.replace(/[^A-Za-z0-9.=^_-]/g, '')).filter(Boolean)
  const stocks = symbols.filter(symbol => /^[A-Z]{1,6}$/.test(symbol))
  const snapshots = {}, key = process.env.APCA_API_KEY_ID, secret = process.env.APCA_API_SECRET_KEY
  if (key && secret && stocks.length) {
    try {
      const url = 'https://data.alpaca.markets/v2/stocks/snapshots?symbols=' + encodeURIComponent(stocks.join(',')) + '&feed=iex'
      const response = await fetch(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, Accept: 'application/json' }, signal: AbortSignal.timeout(6500) })
      if (!response.ok) throw new Error('Alpaca returned ' + response.status)
      Object.assign(snapshots, (await response.json()).snapshots || {})
    } catch (error) { console.error('Alpaca IEX snapshots unavailable:', error instanceof Error ? error.message : 'unknown error') }
  }
  async function quote(symbol) {
    const snap = snapshots[symbol]
    if (snap) {
      const trade = snap.latestTrade || {}, minute = snap.minuteBar || {}, day = snap.dailyBar || {}, previous = snap.prevDailyBar || {}
      const price = Number.isFinite(trade.p) ? trade.p : Number.isFinite(minute.c) ? minute.c : day.c
      const previousClose = Number.isFinite(previous.c) ? previous.c : null
      const timestamp = trade.t || minute.t || day.t || null
      const seconds = timestamp ? new Date(timestamp).getTime() / 1000 : Date.now() / 1000
      if (Number.isFinite(price)) return { symbol, regularMarketPrice: { raw: price }, regularMarketChange: { raw: Number.isFinite(previousClose) ? price - previousClose : null }, regularMarketChangePercent: { raw: Number.isFinite(previousClose) && previousClose !== 0 ? (price - previousClose) / previousClose * 100 : null }, regularMarketTime: seconds, source: 'Alpaca IEX', isRealTime: Date.now() - seconds * 1000 < 120000, currency: 'USD' }
    }
    if (symbol.endsWith('-USD')) {
      const base = symbol.slice(0, -4), response = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=' + encodeURIComponent(base), { signal: AbortSignal.timeout(5000) })
      if (response.ok) { const payload = await response.json(), price = Number(payload?.data?.rates?.USD); if (Number.isFinite(price)) return { symbol, regularMarketPrice: { raw: price }, regularMarketChange: { raw: null }, regularMarketChangePercent: { raw: null }, regularMarketTime: Date.now() / 1000, source: 'Coinbase spot rate', isRealTime: false } }
    }
    const chartUrl = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=1m&includePrePost=true'
    const chartResponse = await fetch(chartUrl, { headers: { 'User-Agent': 'Mozilla/5.0 TradingDesk/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(5500) })
    if (chartResponse.ok) {
      const payload = await chartResponse.json(), result = payload?.chart?.result?.[0], meta = result?.meta || {}, closes = (result?.indicators?.quote?.[0]?.close || []).filter(Number.isFinite)
      const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length - 1], previous = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : meta.previousClose
      if (Number.isFinite(price)) return { symbol, regularMarketPrice: { raw: price }, regularMarketChange: { raw: Number.isFinite(previous) ? price - previous : null }, regularMarketChangePercent: { raw: Number.isFinite(previous) && previous !== 0 ? (price - previous) / previous * 100 : null }, regularMarketTime: meta.regularMarketTime || Date.now() / 1000, source: 'Yahoo Finance snapshot', isRealTime: false, currency: meta.currency || 'USD' }
    }
    const target = 'https://api.nasdaq.com/api/quote/' + encodeURIComponent(symbol.replace('^', '')) + '/info?assetclass=' + (['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO'].includes(symbol) ? 'etf' : 'stocks')
    const response = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' }, signal: AbortSignal.timeout(5000) })
    if (!response.ok) return null
    const payload = await response.json(), data = payload?.data?.primaryData
    if (!data || data.lastSalePrice === 'N/A') return null
    const price = Number(String(data.lastSalePrice).replace(/[$,]/g, '')), change = Number(String(data.netChange || 0).replace(/[$,%,+]/g, '')), changePercent = Number(String(data.percentageChange || 0).replace(/[%+]/g, ''))
    if (!Number.isFinite(price)) return null
    return { symbol, regularMarketPrice: { raw: price }, regularMarketChange: { raw: Number.isFinite(change) ? change : null }, regularMarketChangePercent: { raw: Number.isFinite(changePercent) ? changePercent : null }, regularMarketTime: Date.now() / 1000, source: data.isRealTime ? 'Nasdaq real-time' : 'Nasdaq delayed', isRealTime: !!data.isRealTime }
  }
  const result = await Promise.all(symbols.map(async symbol => { try { return await quote(symbol) } catch (error) { console.error('Quote unavailable for', symbol, error instanceof Error ? error.message : 'unknown error'); return null } }))
  const clean = result.filter(Boolean), data = clean.map(q => ({ symbol: q.symbol, price: q.regularMarketPrice.raw, changePercent: q.regularMarketChangePercent.raw, change: q.regularMarketChange.raw, updatedAt: (q.regularMarketTime || Date.now() / 1000) * 1000, source: q.source, realtime: !!q.isRealTime }))
  res.setHeader('Cache-Control', key && secret ? 's-maxage=2, stale-while-revalidate=3' : 'no-store')
  res.status(200).json({ data, quoteResponse: { result: clean, error: null }, provider: key && secret ? 'Alpaca IEX + Yahoo Finance fallback' : 'Yahoo Finance + Nasdaq + Coinbase fallback', realtime: clean.some(q => q.source === 'Alpaca IEX' && q.isRealTime) })
}
