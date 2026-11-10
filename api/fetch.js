const ALLOWED_HOSTS = new Set([
  'query1.finance.yahoo.com',
  'query2.finance.yahoo.com',
  'gamma-api.polymarket.com',
  'api.nasdaq.com',
  'publicreporting.cftc.gov',
  'www.okx.com'
])
const MAX_BYTES = 3_000_000
const rateWindows = new Map()

function allowedUrl(value) {
  let url
  try { url = new URL(value) } catch { return null }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) return null
  return url
}

function readClientIp(req) {
  const forwarded = req.headers?.['x-forwarded-for'] || req.headers?.['x-real-ip'] || 'unknown'
  return String(Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0].trim() || 'unknown'
}

function checkRateLimit(req) {
  const now = Date.now(), ip = readClientIp(req), bucket = Math.floor(now / 60_000)
  const current = rateWindows.get(ip)
  const count = current?.bucket === bucket ? current.count : 0
  if (count >= 90) return false
  rateWindows.set(ip, { bucket, count: count + 1 })
  if (rateWindows.size > 5000) {
    for (const [key, value] of rateWindows) if (value.bucket < bucket) rateWindows.delete(key)
  }
  return true
}

async function readCapped(response) {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BYTES) throw new Error('Provider response exceeded the 3 MB limit')
  if (!response.body?.getReader) {
    const text = await response.text()
    if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('Provider response exceeded the 3 MB limit')
    return text
  }
  const reader = response.body.getReader(), chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new Error('Provider response exceeded the 3 MB limit')
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return new TextDecoder().decode(bytes)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }
  if (!checkRateLimit(req)) {
    res.setHeader('Retry-After', '60')
    res.setHeader('Cache-Control', 'no-store')
    return res.status(429).json({ error: 'Market data request limit reached', retryable: true, retryAfterMs: 60_000 })
  }

  const source = req.query?.url
  const target = typeof source === 'string' ? allowedUrl(source) : null
  if (!target) return res.status(400).json({ error: 'Missing or disallowed data source URL' })

  for (const [key, value] of Object.entries(req.query || {})) {
    if (key === 'url') continue
    for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(key, String(item))
  }

  try {
    let url = target, response
    for (let redirects = 0; redirects <= 3; redirects++) {
      response = await fetch(url, {
        headers: {
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          'User-Agent': 'Mozilla/5.0 TradingDesk/1.0',
          ...(url.hostname === 'api.nasdaq.com' ? { Origin: 'https://www.nasdaq.com', Referer: 'https://www.nasdaq.com/' } : {})
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(15_000)
      })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location')
      const next = location ? allowedUrl(new URL(location, url).toString()) : null
      if (!next || redirects === 3) throw new Error('Data provider redirected to a disallowed URL')
      url = next
    }
    if (response.status === 429) {
      res.setHeader('Retry-After', response.headers.get('retry-after') || '5')
      res.setHeader('Cache-Control', 'no-store')
      return res.status(429).json({ error: 'The market data source is rate limiting requests', retryable: true, retryAfterMs: 5000 })
    }
    const text = await readCapped(response)
    if (!response.ok) {
      res.setHeader('Cache-Control', 'no-store')
      return res.status(502).json({ error: 'The market data source returned HTTP ' + response.status, detail: text.slice(0, 300) })
    }
    let data
    try { data = JSON.parse(text) } catch { throw new Error('The market data source did not return JSON') }
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40')
    return res.status(200).json({ results: [data], fetchedAt: Date.now() })
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store')
    console.error('Market data proxy unavailable:', error instanceof Error ? error.message : 'unknown error')
    return res.status(502).json({ error: 'The market data source did not answer', detail: error instanceof Error ? error.message : 'Unknown error', retryable: true })
  }
}
