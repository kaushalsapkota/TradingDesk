const ETF_SYMBOLS = new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TLT', 'VTI', 'VOO'])
const parseNumber = value => {
  if (value == null || value === '--' || value === 'N/A') return null
  const number = Number(String(value).replace(/[$,%]/g, '').replace(/,/g, '').trim())
  return Number.isFinite(number) ? number : null
}

function isoDateFromEpoch(value) {
  const seconds = Number(value)
  const date = new Date(seconds * 1000)
  return Number.isFinite(seconds) && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : ''
}

function epochFromDate(value) {
  const time = Date.parse(value + ' 00:00:00 UTC')
  return Number.isFinite(time) ? Math.floor(time / 1000) : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const symbol = String(req.query?.symbol || 'SPY').trim().toUpperCase()
  const date = String(req.query?.date || '').trim()
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || (date && !/^\d{9,12}$/.test(date))) {
    return res.status(400).json({ error: 'Invalid options request' })
  }

  const targetDate = date ? isoDateFromEpoch(date) : ''
  if (date && !targetDate) return res.status(400).json({ error: 'Invalid options expiry' })
  const query = new URLSearchParams({
    assetclass: ETF_SYMBOLS.has(symbol) ? 'etf' : 'stocks',
    limit: '400',
    money: 'all',
    type: 'all',
    callput: 'callput',
    excode: 'oprac'
  })
  if (targetDate) {
    query.set('fromdate', targetDate)
    query.set('todate', targetDate)
  }

  try {
    const url = 'https://api.nasdaq.com/api/quote/' + encodeURIComponent(symbol) + '/option-chain?' + query.toString()
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        Origin: 'https://www.nasdaq.com',
        Referer: 'https://www.nasdaq.com/',
        'User-Agent': 'Mozilla/5.0 TradingDesk/1.0'
      },
      signal: AbortSignal.timeout(7000)
    })
    if (!response.ok) throw new Error('Nasdaq options returned ' + response.status)

    const payload = await response.json()
    const data = payload?.data || {}
    const sourceRows = data?.table?.rows
    if (!Array.isArray(sourceRows)) throw new Error('Nasdaq returned no options table')

    const expirations = []
    let currentExpiry = ''
    const rows = []
    for (const row of sourceRows) {
      if (row?.expirygroup) {
        currentExpiry = row.expirygroup
        const timestamp = epochFromDate(currentExpiry)
        if (timestamp != null && !expirations.includes(timestamp)) expirations.push(timestamp)
        continue
      }
      if (!row?.strike || !currentExpiry || (targetDate && new Date(currentExpiry + ' 00:00:00 UTC').toISOString().slice(0, 10) !== targetDate)) continue
      const strike = parseNumber(row.strike)
      if (strike == null) continue
      rows.push({ source: row, strike, expiry: currentExpiry })
    }

    const selectedExpiry = rows[0]?.expiry || ''
    const selectedRows = rows.filter(item => item.expiry === selectedExpiry)
    const underlyingMatch = String(data.lastTrade || '').match(/\$\s*([\d,]+(?:\.\d+)?)/)
    const underlyingPrice = underlyingMatch ? parseNumber(underlyingMatch[1]) : null
    if (!selectedRows.length) throw new Error('Nasdaq has no listed contracts for ' + symbol + (targetDate ? ' on the selected expiry' : ''))

    const nearby = selectedRows.filter(item => underlyingPrice == null || Math.abs(item.strike / underlyingPrice - 1) <= 0.25)
    const contracts = nearby.sort((a, b) => a.strike - b.strike)
    const contract = (row, side) => ({
      contractSymbol: row.drillDownURL || '',
      strike: parseNumber(row.strike),
      bid: parseNumber(row[side + '_Bid']),
      ask: parseNumber(row[side + '_Ask']),
      lastPrice: parseNumber(row[side + '_Last']),
      volume: parseNumber(row[side + '_Volume']),
      openInterest: parseNumber(row[side + '_Openinterest']),
      impliedVolatility: null,
      inTheMoney: null
    })
    const expirationDate = epochFromDate(selectedExpiry)
    const fetchedAt = Date.now()

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120')
    return res.status(200).json({
      symbol,
      underlyingPrice,
      expirationDates: expirations,
      options: [{
        expirationDate,
        calls: contracts.map(({ source }) => contract(source, 'c')),
        puts: contracts.map(({ source }) => contract(source, 'p'))
      }],
      source: 'Nasdaq OPRA composite',
      delayed: true,
      fetchedAt,
      sourceTimestamp: null
    })
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store')
    console.error('Nasdaq options unavailable:', error instanceof Error ? error.message : 'unknown error')
    return res.status(502).json({
      error: 'Nasdaq options data is currently unavailable',
      detail: error instanceof Error ? error.message : 'Unknown error'
    })
  }
}
