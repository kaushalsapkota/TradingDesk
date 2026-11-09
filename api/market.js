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

async function quote(item) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4500);
  try {
    const endpoint = "https://query1.finance.yahoo.com/v8/finance/chart/" +
      encodeURIComponent(item.symbol) + "?range=1d&interval=1m";
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 TradingDesk/1.0", "Accept": "application/json" }
    });
    if (!response.ok) throw new Error("Market provider returned " + response.status);
    const json = await response.json();
    const result = json && json.chart && json.chart.result && json.chart.result[0];
    if (!result) throw new Error("No quote returned");
    const meta = result.meta || {};
    const closes = (result.indicators && result.indicators.quote &&
      result.indicators.quote[0] && res¶»§q«^