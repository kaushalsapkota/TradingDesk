function decode(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
function field(xml, name) {
  const match = xml.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">"));
  return match ? decode(match[1]).trim() : "";
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", process.env.APCA_API_KEY_ID && process.env.APCA_API_SECRET_KEY ? "s-maxage=15, stale-while-revalidate=30" : "s-maxage=120, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  try {
    const key=process.env.APCA_API_KEY_ID,secret=process.env.APCA_API_SECRET_KEY;
    if(key&&secret){try{
      const params=new URLSearchParams({symbols:"AAPL,NVDA,MSFT,AMZN,GOOGL,META,TSLA,AMD,SPY,QQQ",limit:"50",sort:"desc"});
      const liveResponse=await fetch("https://data.alpaca.markets/v1beta1/news?"+params.toString(),{headers:{"APCA-API-KEY-ID":key,"APCA-API-SECRET-KEY":secret,"Accept":"application/json"},signal:AbortSignal.timeout(6500)});
      if(!liveResponse.ok)throw new Error("Alpaca news returned "+liveResponse.status);
      const livePayload=await liveResponse.json();
      const items=(livePayload.news||[]).map(article=>({title:article.headline||"",link:article.url||"",publishedAt:article.created_at||article.updated_at||"",source:article.source||article.author||"Market news",sourceUrl:"",summary:article.summary||"",symbols:Array.isArray(article.symbols)?article.symbols:[]})).filter(item=>item.title&&/^https?:\/\//i.test(item.link));
      return res.status(200).json({provider:"Alpaca market news",realtime:true,fetchedAt:Date.now(),items});
    }catch(error){console.error("Alpaca news unavailable; using RSS fallback",error.message);}}
    const query = String(req.query && req.query.q || "financial markets stocks forex cryptocurrency")
      .replace(/[^\w\s.-]/g, " ").trim().slice(0, 100) || "financial markets";
    const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) +
      "&hl=en-AU&gl=AU&ceid=AU:en";
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TradingDesk/1.0)", "Accept": "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(4500)
    });
    if (!response.ok) throw new Error("News provider returned " + response.status);
    const xml = await response.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 18).map(match => {
      const item = match[1];
      const source = item.match(/<source(?:\s+url="([^"]*)")?>([\s\S]*?)<\/source>/);
      return {
        title: field(item, "title"),
        link: field(item, "link"),
        publishedAt: field(item, "pubDate"),
        source: source ? decode(source[2]).trim() : "Google News",
        sourceUrl: source && source[1] ? decode(source[1]) : ""
      };
    }).filter(item => item.title && /^https?:\/\//i.test(item.link));
    return res.status(200).json({ provider: "Google News RSS fallback", realtime: false, fetchedAt: Date.now(), items });
  } catch (error) {
    console.error("News API failed", error && error.stack || error);
    return res.status(502).json({ error: "Financial news is temporarily unavailable. Please retry shortly." });
  }
};
