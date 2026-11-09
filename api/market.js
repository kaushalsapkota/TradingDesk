const SYMBOLS = [
  { symbol: "AAPL", name: "Apple", group: "US stocks" },
  { symbol: "NVDA", name: "NVIDIA", group: "US stocks" },
  { symbol: "MSFT", name: "Microsoft", group: "US stocks" },
  { symbol: "^AXJO", name: "ASX 200", group: "Australia" },
  { symbol: "^NSEI", name: "Nifty 50", group: "India" },
  { symbol: "SPY", name: "S&P 500 ETF", group: "Indices" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", group: "Indices" },
  { symbol: "EURUSD=X", name: "EUR / USD", group: "Forex" },
  { symbol: "GC=F", name: "Gold futures", group: "Commodities" },
  { symbol: "CL=F", name: "WTI crude oil", group: "Commodities" }
];

async function getQuote(item) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4500);
  try {
    const url = "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(item.symbol) + "?range=1d&interval=1m";
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 TradingDesk/1.0", "Accept": "application/json" }
    });
    if (!response.ok) throw new Error("Provider returned " + response.status);
    const payload = await response.json();
    const result = payload && payload.chart && payload.chart.result && payload.chart.result[0];
    if (!result) throw new Error("No quote returned");
    const meta = result.meta || {};
    const quote = result.indicators && result.indicators.quote && result.indicators.quote[0] || {};
    const closes = (quote.close || []).filter(Number.isFinite);
    const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length - 1];
    const previous = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : meta.previousClose;
    if (!Number.isFinite(price)) throw new Error("Price unavailable");
    return {
      symbol: item.symbol, name: item.name, group: item.group,
      price, previousClose: Number.isFinite(previous) ? previous : null,
      change: Number.isFinite(previous) ? price - previous : null,
      changePercent: Number.isFinite(previous) && previous !== 0 ? (price - previous) / previous * 100 : null,
      currency: meta.currency || "USD",
      exchange: meta.fullExchangeName || meta.exchangeName || "",
      marketState: meta.marketState || "UNKNOWN",
      timestamp: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
      history: closes.slice(-90)
    };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=45");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const results = await Promise.allSettled(SYMBOLS.map(getQuote));
    const data = results.map((result, index) => result.status === "fulfilled"
      ? result.value
      : { symbol: SYMBOLS[index].symbol, name: SYMBOLS[index].name, group: SYMBOLS[index].group, error: "Quote temporarily unavailable" });
    return res.status(200).json({
      provider: "Yahoo Finance chart data",
      fetchedAt: Date.now(),
      delayed: true,
      note: "Stocks, forex and commodity quotes may be delayed by the provider or exchange.",
      data
    });
  } catch (error) {
    console.error("Market API failed", error && error.stack || error);
    return res.status(502).json({ error: "Market data is temporarily unavailable." });
  }
};
