const TOPICS = ["stock market", "futures forex gold", "Federal Reserve economy", "crypto market", "earnings markets"];

function clean(value = "") {
  return value.replace(/<[^>]*>/g, "").replace(/<!\[CDATA\[|\]\]>/g, "").trim();
}

export default async function handler(req, res) {
  const query = String(req.query?.q || TOPICS.join(" OR ")).slice(0, 180);
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const response = await fetch(url, { headers: { Accept: "application/rss+xml, application/xml" } });
    if (!response.ok) throw new Error(`News source returned ${response.status}`);
    const xml = await response.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 80).map((match) => {
      const item = match[1];
      const read = (tag) => clean(item.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || "");
      return { title: read("title"), link: read("link"), published: read("pubDate"), source: read("source") };
    }).filter((item) => item.title && item.link);
    res.setHeader("Cache-Control", "s-maxage=120, stale-while-revalidate=300");
    return res.status(200).json({ source: "Google News RSS public feed", delayed: true, updatedAt: Date.now(), data: items });
  } catch (error) {
    return res.status(502).json({ error: "News feed unavailable", detail: error instanceof Error ? error.message : "Unknown upstream error" });
  }
}
