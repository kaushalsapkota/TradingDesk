const YAHOO = "https://query1.finance.yahoo.com";
const POLYMARKET = "https://gamma-api.polymarket.com/markets";
const NEWS_FEEDS = [
  ["Gold", "gold price OR XAUUSD OR gold futures"],
  ["Nasdaq & US stocks", "Nasdaq OR S&P 500 OR Wall Street stocks"],
  ["Forex", "forex OR US dollar OR EURUSD OR USDJPY OR dollar index"],
  ["Economy & Fed", "Federal Reserve OR FOMC OR CPI OR payrolls OR Powell"],
  ["Crypto", "bitcoin OR ethereum OR crypto market"],
  ["Bonds & yields", "Treasury yields OR 10-year yield OR bond market"],
];
const SYMBOL = /^[A-Za-z0-9.^=-]{1,24}$/;

const json = (res, status, body, maxAge = 15) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", `s-maxage=${maxAge}, stale-while-revalidate=30`);
  res.end(JSON.stringify(body));
};

async function upstream(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "TradingDesk/1.0 (+https://github.com/kaushalsapkota/TradingDesk)" },
  });
  if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
  return response;
}

function quoteRows(payload) {
  const rows = {};
  for (const result of payload?.spark?.result || []) {
    const response = result.response?.[0];
    const quote = response?.indicators?.quote?.[0] || {};
    const closes = (quote.close || []).filter((value) => Number.isFinite(value));
    const timestamps = (response.timestamp || []).filter((_, index) => Number.isFinite(quote.close?.[index]));
    const price = closes.at(-1) ?? response.meta?.regularMarketPrice;
    const previous = response.meta?.previousClose ?? response.meta?.chartPreviousClose;
    if (!Number.isFinite(price)) continue;
    rows[result.symbol] = {
      price,
      prev: Number.isFinite(previous) ? previous : null,
      chg: Number.isFinite(previous) ? price - previous : null,
      pct: Number.isFinite(previous) && previous ? (price / previous - 1) * 100 : null,
      ts: timestamps.at(-1) || response.meta?.regularMarketTime || null,
      spark: closes.slice(-60),
    };
  }
  return rows;
}

function newsItems(xml, category) {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const read = (name) => {
      const value = item.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "";
      return value.replace(/<!\[CDATA\[|\]\]>/g, "").trim();
    };
    const title = read("title");
    const link = read("link");
    const source = read("source") || "Google News";
    const pubDate = read("pubDate");
    if (title && link) items.push({
      title: title.replace(/\s+-\s+[^-]+$/, "").trim(),
      src: source,
      link,
      ts: Number.isFinite(Date.parse(pubDate)) ? Math.floor(Date.parse(pubDate) / 1000) : null,
      cat: category,
      hi: /\b(CPI|FOMC|NFP|non-?farm payrolls?|Powell|rate decision)\b/i.test(title),
    });
  }
  return items;
}

module.exports = async (req, res) => {
  try {
    const params = new URL(req.url, "http://localhost").searchParams;
    const type = params.get("type") || "quotes";

    if (type === "quotes") {
      const symbols = (params.get("symbols") || "").split(",").filter((symbol) => SYMBOL.test(symbol)).slice(0, 40);
      if (!symbols.length) return json(res, 400, { error: "At least one valid symbol is required." }, 0);
      const upstreamResponse = await upstream(`${YAHOO}/v8/finance/spark?symbols=${encodeURIComponent(symbols.join(","))}&range=1d&interval=15m`);
      return json(res, 200, { quotes: quoteRows(await upstreamResponse.json()), fetchedAt: Math.floor(Date.now() / 1000) }, 1);
    }

    if (type === "chart") {
      const symbol = params.get("symbol") || "";
      const interval = params.get("interval") || "5m";
      const range = params.get("range") || "5d";
      if (!SYMBOL.test(symbol) || !/^(1m|2m|5m|15m|30m|60m|90m|1h|1d|5d|1wk|1mo|3mo)$/.test(interval) || !/^(1d|5d|1mo|3mo|6mo|1y|5y)$/.test(range)) {
        return json(res, 400, { error: "Invalid chart request." }, 0);
      }
      const upstreamResponse = await upstream(`${YAHOO}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`);
      const result = (await upstreamResponse.json())?.chart?.result?.[0];
      if (!result) return json(res, 502, { error: "No chart data returned." }, 0);
      const quote = result.indicators?.quote?.[0] || {};
      const bars = (result.timestamp || []).flatMap((time, index) => {
        const open = quote.open?.[index], high = quote.high?.[index], low = quote.low?.[index], close = quote.close?.[index];
        return [open, high, low, close].every(Number.isFinite) ? [{ time, open, high, low, close, volume: quote.volume?.[index] || 0 }] : [];
      });
      return json(res, 200, { bars, meta: result.meta || {}, fetchedAt: Math.floor(Date.now() / 1000) });
    }

    if (type === "news") {
      const feeds = await Promise.all(NEWS_FEEDS.map(async ([category, query]) => {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${query} when:1d`)}&hl=en-US&gl=US&ceid=US:en`;
        return newsItems(await (await upstream(url)).text(), category);
      }));
      const seen = new Set();
      const news = feeds.flat().filter((item) => {
        const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 180);
      return json(res, 200, { news, fetchedAt: Math.floor(Date.now() / 1000) }, 60);
    }

    if (type === "poly") {
      const markets = await (await upstream(`${POLYMARKET}?closed=false&limit=50&order=volume24hr&ascending=false`)).json();
      const poly = (Array.isArray(markets) ? markets : []).slice(0, 25).map((market) => ({
        title: market.question || market.title || "Market",
        q: market.question || market.title || "Market",
        out: "Yes",
        yes: Number(market.outcomePrices?.[0] ?? market.yesPrice ?? 0),
        vol24: Number(market.volume24hr || 0),
        vol: Number(market.volume || 0),
        end: market.endDate || market.end_date || null,
        n: Array.isArray(market.outcomes) ? market.outcomes.length : 2,
      }));
      return json(res, 200, { poly, fetchedAt: Math.floor(Date.now() / 1000) }, 60);
    }

    return json(res, 400, { error: "Unknown market data type." }, 0);
  } catch (error) {
    return json(res, 502, { error: error instanceof Error ? error.message : "Market data unavailable." }, 0);
  }
};
