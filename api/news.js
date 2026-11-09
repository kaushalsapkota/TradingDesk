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
  res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const query = String(req.query && req.query.q || "financial markets stocks forex cryptocurrency")
    .replace(/[^\w\s.-]/g, " ").trim().slice(0, 100) || "financial markets";
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(query) +
    "&hl=en-AU&gl=AU&ceid=AU:en";
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; TradingDesk/1.0)", "Accept": "application/rss+xml, application/xml, text/xml" },
      signal: AbortSignal.timeout(9000)
    });
    if (!response.ok) throw new Error("News provider returned " + response.status);
    const xml = await response.text();
    const items = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/g)).slice(0, 18).map(match => {
      const item = match[1];
      const ¶»§q«^