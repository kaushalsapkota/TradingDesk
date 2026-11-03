const ALLOWED_SYMBOLS = new Set([
  "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "SPY", "QQQ", "BTC-USD", "ETH-USD"
]);

export default async function handler(req, res) {
  const raw = String(req.query?.symbols || "AAPL,MSFT,NVDA,AMZN,GOOGL,META,TSLA,SPY,QQQ,BTC-USD,ETH-USD");
  const symbols = raw.split(",").map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => ALLOWED_SYMBOLS.has(symbol)).slice(0, 20);

  if (!symbols.length) return res.status(400).json({ error: "No supported symbols requested" });

  try {
    const results = await Promise.all(symbols.map(async (symbol) => {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1m&includePrePost=true`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);
      const payload = await response.json();
      const result = payload?.chart?.result?.[0];
      const meta = result?.meta;
      const price = Number(meta?.regularMarketPrice ?? meta?.postMarketPrice ?? meta?.previousClose);
      const previousClose = Number(meta?.previousClose ?? meta?.chartPreviousClose);
      if (!Number.isFinite(price) || !Number.isFinite(previousClose)) return null;
      return { symbol, price, previousClose, change: price - previousClose, changePercent: ((price - previousClose) / previousClose) * 100, currency: meta?.currency || "USD", marketState: meta?.marketState || "CLOSED", updatedAt: Date.now() };
    }));
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=30");
    return res.status(200).json({ source: "Yahoo Finance delayed public feed", delayed: true, updatedAt: Date.now(), data: results.filter(Boolean) });
  } catch (error) {
    return res.status(502).json({ error: "Live market feed unavailable", detail: error instanceof Error ? error.message : "Unknown upstream error" });
  }
}
