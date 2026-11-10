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
  { symbol: "CL=F", name: "WTI crude oil", group: "Commodities" },
  { symbol: "AMZN", name: "Amazon", group: "US stocks" },
  { symbol: "GOOGL", name: "Alphabet", group: "US stocks" },
  { symbol: "META", name: "Meta Platforms", group: "US stocks" },
  { symbol: "TSLA", name: "Tesla", group: "US stocks" },
  { symbol: "AMD", name: "Advanced Micro Devices", group: "US stocks" }
];
const LIVE_SYMBOLS = ["AAPL","NVDA","MSFT","AMZN","GOOGL","META","TSLA","AMD","SPY","QQQ"];

async function getStooqQuote(item) {
  const map = {AAPL:"aapl.us",NVDA:"nvda.us",MSFT:"msft.us",SPY:"spy.us",QQQ:"qqq.us"};
  const ticker = map[item.symbol];
  if (!ticker) throw new Error("No Stooq symbol mapping");
  const response = await fetch("https://stooq.com/q/l/?s="+ticker+"&f=sd2t2ohlcv&h&e=csv",{signal:AbortSignal.timeout(4500)});
  if (!response.ok) throw new Error("Stooq "+response.status);
  const rows=(await response.text()).trim().split(/\r?\n/);
  if(rows.length<2) throw new Error("No Stooq quote");
  const fields=rows[1].split(",");
  const price=Number(fields[6]),open=Number(fields[3]);
  if(!Number.isFinite(price)) throw new Error("Stooq quote unavailable");
  return {symbol:item.symbol,name:item.name,group:item.group,price,previousClose:Number.isFinite(open)?open:null,change:Number.isFinite(open)?price-open:null,changePercent:Number.isFinite(open)&&open?((price-open)/open)*100:null,currency:"USD",exchange:"Stooq",marketState:"SNAPSHOT",timestamp:Date.now(),history:[],source:"Stooq",delayed:true};
}

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
  } catch (primaryError) {
    try { return await getStooqQuote(item); }
    catch (_) { throw primaryError; }
  } finally {
    clearTimeout(timeout);
  }
}

async function getAlpacaSnapshots() {
 const key=process.env.APCA_API_KEY_ID,secret=process.env.APCA_API_SECRET_KEY;if(!key||!secret)return null;
 const url="https://data.alpaca.markets/v2/stocks/snapshots?symbols="+LIVE_SYMBOLS.join(",")+"&feed=iex";
 const response=await fetch(url,{headers:{"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,"Accept":"application/json"},signal:AbortSignal.timeout(6500)});
 if(!response.ok)throw new Error("Alpaca market feed returned "+response.status);
 const payload=await response.json(),snapshots=payload.snapshots||payload,now=Date.now();
 return Object.fromEntries(LIVE_SYMBOLS.filter(symbol=>snapshots[symbol]).map(symbol=>{
  const snap=snapshots[symbol],item=SYMBOLS.find(x=>x.symbol===symbol)||{symbol,name:symbol,group:"US stocks"},trade=snap.latestTrade||{},minute=snap.minuteBar||{},day=snap.dailyBar||{},prev=snap.prevDailyBar||{};
  const price=Number.isFinite(trade.p)?trade.p:(Number.isFinite(minute.c)?minute.c:day.c),previous=Number.isFinite(prev.c)?prev.c:null,stamp=trade.t||minute.t||day.t||null,age=stamp?now-new Date(stamp).getTime():Infinity;
  return [symbol,{symbol,name:item.name,group:item.group,price,previousClose:previous,change:Number.isFinite(previous)&&Number.isFinite(price)?price-previous:null,changePercent:Number.isFinite(previous)&&previous!==0&&Number.isFinite(price)?(price-previous)/previous*100:null,currency:"USD",exchange:"IEX",marketState:"IEX",timestamp:stamp?new Date(stamp).getTime():now,history:[prev.c,day.o,minute.o,minute.c,price].filter(Number.isFinite),source:"Alpaca IEX",feed:"IEX",realtime:age<120000,delayed:false}];
 }));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY ? "s-maxage=2, stale-while-revalidate=3" : "s-maxage=15, stale-while-revalidate=45");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    let liveSnapshots=null,liveFeedError=null;
    try { liveSnapshots=await getAlpacaSnapshots(); } catch(error) { liveFeedError=error.message; console.error("Alpaca feed unavailable",error.message); }
    const data=await Promise.all(SYMBOLS.map(async item=>{if(liveSnapshots&&liveSnapshots[item.symbol])return liveSnapshots[item.symbol];try{return await getQuote(item)}catch(_){return {symbol:item.symbol,name:item.name,group:item.group,error:"Quote temporarily unavailable"}}}));
    const realtime=!!liveSnapshots&&Object.keys(liveSnapshots).length>0;
    return res.status(200).json({
      provider:realtime?"Alpaca IEX real-time + Yahoo/Stooq snapshots":"Yahoo Finance with Stooq fallback",
      realtime,liveFeed:realtime?"Alpaca IEX":null,liveSymbols:realtime?Object.keys(liveSnapshots).length:0,pollIntervalMs:realtime?5000:null,liveFeedError:liveFeedError||null,
      sources: [
        {name:"Alpaca IEX",status:process.env.APCA_API_KEY_ID&&process.env.APCA_API_SECRET_KEY?"configured":"api_key_required",role:"Real-time US stock trades and quotes from IEX; 10 symbols"},
        {name:"Yahoo Finance",status:"active",role:"Fallback snapshots for international indices, FX and commodities"},
        {name:"Stooq",status:"fallback",role:"US equity and ETF fallback snapshots"},
        {name:"Binance",status:"active",role:"Live crypto WebSocket stream"},
        {name:"Coinbase Exchange",status:"available",role:"Alternative crypto feed; adapter not yet enabled"},
        {name:"Kraken",status:"available",role:"Alternative crypto feed; adapter not yet enabled"},
        {name:"CoinGecko",status:"available",role:"Crypto market data; API integration pending"},
        {name:"Twelve Data",status:process.env.TWELVEDATA_API_KEY?"configured":"api_key_required",role:"Optional market data adapter"},
        {name:"Alpha Vantage",status:process.env.ALPHA_VANTAGE_API_KEY?"configured":"api_key_required",role:"Optional market data adapter"},
        {name:"Finnhub",status:process.env.FINNHUB_API_KEY?"configured":"api_key_required",role:"Optional market data adapter"},
        {name:"Financial Modeling Prep",status:process.env.FMP_API_KEY?"configured":"api_key_required",role:"Optional market data adapter"},
        {name:"Polygon",status:process.env.POLYGON_API_KEY?"configured":"api_key_required",role:"Optional market data adapter"},
        {name:"Marketstack",status:process.env.MARKETSTACK_API_KEY?"configured":"api_key_required",role:"Optional market data adapter"}
      ],
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
