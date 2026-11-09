const TOPICS = ["stock market", "futures forex gold", "Federal Reserve economy", "crypto market", "earnings markets"];
const STOCKS = ["AAPL", "NVDA", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "SPY", "QQQ"];
function clean(v = "") {
  return String(v).replace(/<[^>]*>/g, "").replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
export default async function handler(req, res) {
  const key = process.env.APCA_API_KEY_ID, secret = process.env.APCA_API_SECRET_KEY
  const query = String(req.query?.q || TOPICS.join(" OR ")).slice(0, 180)
  if (key && secret) {
    try {
      const params = new URLSearchParams({ symbols: STOCKS.join(","), limit: "50", sort: "desc" })
      const response = await fetch("https://data.alpaca.markets/v1beta1/news?" + params.toString(), { headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, Accept: "application/json" }, signal: AbortSignal.timeout(6500) })
      if (!response.ok) throw new Error("Alpaca news returned " + response.status)
      const payload = await response.json()
      const data = (payload.news || []).map(article => ({ title: article.headline || "", link: article.url || "", published: article.created_at || article.updated_at || "", source: article.source || article.author || "Market news", summary: article.summary || "", symbols: Array.isArray(article.symbols) ? article.symbols : [] })).filter(item => item.title && /^https?:\/\//i.test(item.link))
      res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30")
      return res.status(200).json({ source: "Alpaca market news", realtime: true, updatedAt: Date.now(), data })
    } catch (error) { console.error("Alpaca news unavailable; using RSS fallback:", error instanceof Error ? error.message : "unknown error") }
  }
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query + " when:1d") + "&hl=en-US&gl=US&ceid=US:en"
  try {
    const response = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml" }, signal: AbortSignal.timeout(9000) })
    if (!response.ok) throw new Error("News source returned " + response.status)
    const xml = await response.text()
    const data = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 80).map(match => {
      const item = match[1], read = tag => clean(item.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"))?.[1] || ""), source = item.match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/i)
      return { title: read("title"), link: read("link"), published: read("pubDate"), source: source ? clean(source[2]) : "Google News", summary: "", symbols: [] }
    }).filter(item => item.title && /^https?:\/\//i.test(item.link))
    res.setHeader("Cache-Control", "s-maxage=90, stale-while-revalidate=180")
    return res.status(200).json({ source: "Google News RSS", realtime: false, delayed: true, updatedAt: Date.now(), data })
  } catch (error) { return res.status(502).json({ error: "News feed unavailable", detail: error instanceof Error ? error.message : "Unknown error" }) }
}
