const http = require('node:http')
const https = require('node:https')
const fs = require('node:fs')
const path = require('node:path')
const { URL } = require('node:url')

const root = __dirname
const port = Number(process.env.PORT || 4173)

function proxy(res, target, transform) {
  const request = https.get(target, { headers: { 'User-Agent': 'TradingDesk/1.0' } }, upstream => {
    let body = ''
    upstream.setEncoding('utf8')
    upstream.on('data', chunk => { body += chunk })
    upstream.on('end', () => {
      try {
        const output = transform ? transform(body) : body
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
        res.end(output)
      } catch {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'Public feed returned invalid data' }))
      }
    })
  })
  request.setTimeout(12000, () => request.destroy(new Error('upstream timeout')))
  request.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: 'Public feed is temporarily unavailable' }))
    }
  })
}

function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname)
  const file = pathname === '/' ? '/index.html' : pathname
  const safe = path.normalize(file).replace(/^\.{2}[\\/]/, '')
  const filename = path.join(root, safe)
  if (!filename.startsWith(root) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) {
    res.writeHead(404); res.end('Not found'); return
  }
  const type = filename.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' })
  fs.createReadStream(filename).pipe(res)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  if (url.pathname === '/api/market') {
    const symbols = (url.searchParams.get('symbols') || 'SPY,QQQ,BTC-USD,GC=F,DX-Y.NYB,CL=F').split(',').slice(0, 80)
    const query = encodeURIComponent(symbols.join(','))
    proxy(res, `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${query}`)
    return
  }
  if (url.pathname === '/api/news') {
    const query = encodeURIComponent(url.searchParams.get('q') || 'stock market finance')
    proxy(res, `https://news.google.com/rss/search?q=${query}&hl=en-US&gl=US&ceid=US:en`, xml => {
      const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 12).map(match => {
        const block = match[1]
        const read = tag => (block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) || [,''])[1].replace(/<!\[CDATA\[|\]\]>/g, '')
        return { title: read('title'), link: read('link'), published: read('pubDate'), source: read('source') }
      })
      return JSON.stringify({ items })
    })
    return
  }
  serveStatic(req, res)
})

server.listen(port, '0.0.0.0', () => console.log(`TradingDesk preview listening on ${port}`))
