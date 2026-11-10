const MAX_SYMBOLS = 40
const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value)
const parseProviderNumber = value => {
  if (value == null || value === '' || value === '--' || value === 'N/A') return null
  const number = Number(String(value).replace(/[$,%+]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? number : null
}

function parseSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9.=^_-]/g, '')
  return /^[A-Z0-9][A-Z0-9.=^_-]{0,19}$/.test(symbol) ? symbol : ''
}

function makeQuote(symbol, price, change, changePercent, options = {}) {
  if (!isFiniteNumber(price)) return null
  return {
    symbol,
    regularMarketPrice: { raw: price },
    regularMarketChange: { raw: isFiniteNumber(change) ? change : null },
    regularMarketChangePercent: { raw: isFiniteNumber(changePercent) ? changePercent : null },
    regularMarketTime: isFiniteNumber(options.timestamp) ? options.timestamp : null,
    source: options.source || 'Market data provider',
    isRealTime: options.realtime === true,
    currency: options.currency || 'USD'
  }
}

async function fetchJson(url, options, timeoutMs) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`Provider returned ${response.status}`)
  return response.json()
}

async function alpacaSnapshots(symbols, key, secret) {
  if (!key || !secret || !symbols.length) return {}
  try {
    const url = 'https://data.alpaca.markets/v2/stocks/snapshots?symbols=' + encodeURIComponent(symbols.join(',')) + '&feed=iex'
    const payload = await fetchJson(url, { headers: { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret, Accept: 'application/json' } }, 1800)
    return payload?.snapshots || {}
  } catch (error) {
    console.warn('Alpaca market snapshot unavailable:', error instanceof Error ? error.message : 'unknown error')
    return {}
  }
}

function quoteFromAlpaca(symbol, snap) {
  if (!snap) return null
  const trade = snap.latestTrade || {}, minute = snap.minuteBar || {}, day = snap.dailyBar || {}, previous = snap.prevDailyBar || {}
  const price = isFiniteNumber(trade.p) ? trade.p : isFiniteNumber(minute.c) ? minute.c : day.c
  const previousClose = isFiniteNumber(previous.c) ? previous.c : null
  const timestamp = trade.t || minute.t || day.t || null
  const seconds = timestamp ? Date.parse(timestamp) / 1000 : null
  return makeQuote(symbol, price, previousClose == null ? null : price - previousClose,
    previousClose && previousClose !== 0 ? (price - previousClose) / previousClose * 100 : null,
    { timestamp: Number.isFinite(seconds) ? seconds : null, source: 'Alpaca IEX', realtime: seconds != null && Date.now() - seconds * 1000 < 120000 })
}

async function coinbaseQuote(symbol) {
  if (!symbol.endsWith('-USD')) return null
  const url = 'https://api.exchange.coinbase.com/products/' + encodeURIComponent(symbol) + '/stats'
  const payload = await fetchJson(url, { headers: { Accept: 'application/json', 'User-Agent': 'TradingDesk/1.0' } }, 1200)
  const price = parseProviderNumber(payload?.last), open = parseProviderNumber(payload?.open)
  if (price == null) return null
  const change = open != null && open !== 0 ? price - open : null
  return makeQuote(symbol, price, change, change == null ? null : change / open * 100,
    { source: 'Coinbase Exchange snapshot', realtime: false })
}

async function yahooQuote(symbol) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + encodeURIComponent(symbol) + '?range=1d&interval=1m&includePrePost=true'
  const payload = await fetchJson(url, { headers: { 'User-Agent': 'Mozilla/5.0 TradingDesk/1.0', Accept: 'application/json' } }, 1900)
  const result = payload?.chart?.result?.[0], meta = result?.meta || {}, quote = result?.indicators?.quote?.[0] || {}
  const closes = (quote.close || []).filter(Number.isFinite)
  const price = isFiniteNumber(meta.regularMarketPrice) ? meta.regularMarketPrice : closes.at(-1)
  const previous = isFiniteNumber(meta.chartPreviousClose) ? meta.chartPreviousClose : meta.previousClose
  const timestamps = result?.timestamp || []
  return makeQuote(symbol, price, isFiniteNumber(previous) ? price - previous : null,
    isFiniteNumber(previous) && previous !== 0 ? (price - previous) / previous * 100 : null,
    { timestamp: isFiniteNumber(meta.regularMarketTime) ? meta.regularMarketTime : timestamps.at(-1), source: 'Yahoo Finance snapshot', realtime: false, currency: meta.currency || 'USD' })
}

async function nasdaqQuote(symbol) {
  const etfs = ['SPY', 'QQQ', 'IWM', 'DIA', 'VTI', 'VOO']
  const target = 'https://api.nasdaq.com/api/quote/' + encodeURIComponent(symbol.replace('^', '')) + '/info?assetclass=' + (etfs.includes(symbol) ? 'etf' : 'stocks')
  const payload = await fetchJson(target, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, 1600)
  const data = payload?.data?.primaryData
  if (!data || data.lastSalePrice === 'N/A') return null
  const price = parseProviderNumber(data.lastSalePrice)
  const change = parseProviderNumber(data.netChange)
  const changePercent = parseProviderNumber(data.percentageChange)
  return makeQuote(symbol, price, change, changePercent,
    { source: data.isRealTime ? 'Nasdaq real-time' : 'Nasdaq delayed', realtime: !!data.isRealTime })
}

async function quote(symbol, snapshots) {
  const fromAlpaca = quoteFromAlpaca(symbol, snapshots[symbol])
  if (fromAlpaca) return fromAlpaca

  if (symbol.endsWith('-USD')) {
    try {
      const fromCoinbase = await coinbaseQuote(symbol)
      if (fromCoinbase) return fromCoinbase
    } catch {}
  }

  try {
    const fromYahoo = await yahooQuote(symbol)
    if (fromYahoo) return fromYahoo
  } catch {}

  try { return await nasdaqQuote(symbol) } catch { return null }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const requested = String(req.query?.symbols || 'SPY,QQQ').split(',').map(parseSymbol).filter(Boolean)
  const symbols = [...new Set(requested)].slice(0, MAX_SYMBOLS)
  if (!symbols.length) return res.status(400).json({ error: 'At least one valid symbol is required' })

  const stocks = symbols.filter(symbol => /^[A-Z]{1,6}$/.test(symbol))
  const key = process.env.APCA_API_KEY_ID, secret = process.env.APCA_API_SECRET_KEY
  const snapshots = await alpacaSnapshots(stocks, key, secret)
  const result = await Promise.all(symbols.map(symbol => quote(symbol, snapshots).catch(() => null)))
  const clean = result.filter(Boolean)
  const fetchedAt = Date.now()
  const providers = [...new Set(clean.map(item => item.source.split(' ')[0] === 'Yahoo' ? 'Yahoo Finance' : item.source.split(' ')[0] === 'Coinbase' ? 'Coinbase' : item.source.split(' ')[0] === 'Alpaca' ? 'Alpaca IEX' : 'Nasdaq'))]
  const data = clean.map(item => ({
    symbol: item.symbol,
    price: item.regularMarketPrice.raw,
    previousClose: isFiniteNumber(item.regularMarketChange.raw) ? item.regularMarketPrice.raw - item.regularMarketChange.raw : null,
    changePercent: item.regularMarketChangePercent.raw,
    change: item.regularMarketChange.raw,
    updatedAt: item.regularMarketTime == null ? null : item.regularMarketTime * 1000,
    source: item.source,
    realtime: item.isRealTime
  }))
  const realtime = clean.length > 0 && clean.every(item => item.isRealTime)

  res.setHeader('Cache-Control', clean.length ? 'public, s-maxage=10, stale-while-revalidate=20' : 'no-store')
  return res.status(200).json({
    fetchedAt,
    requestedSymbols: symbols,
    unavailableSymbols: symbols.filter(symbol => !clean.some(item => item.symbol === symbol)),
    data,
    quoteResponse: { result: clean, error: null },
    provider: providers.join(' + ') || 'No market data provider available',
    realtime,
    delayed: clean.some(item => !item.isRealTime)
  })
}
