export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || "SPY").trim().toUpperCase()
  const date = String(req.query?.date || "").trim()
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || (date && !/^\d{9,12}$/.test(date))) return res.status(400).json({ error: "Invalid options request" })
  const headers = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", Accept: "application/json,text/plain,*/*", "Accept-Language": "en-US,en;q=0.9", Referer: "https://finance.yahoo.com/" }
  try {
    // Yahoo's options endpoint often requires a short-lived consent cookie and crumb.
    let cookie = ""
    try {
      const consent = await fetch("https://fc.yahoo.com/", { headers, redirect: "manual", signal: AbortSignal.timeout(5000) })
      cookie = (consent.headers.get("set-cookie") || "").split(",").map(v => v.split(";")[0]).filter(Boolean).join("; ")
    } catch {}
    let crumb = ""
    if (cookie) {
      try {
        const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", { headers: { ...headers, Cookie: cookie }, signal: AbortSignal.timeout(5000) })
        if (crumbResponse.ok) crumb = (await crumbResponse.text()).trim()
      } catch {}
    }
    const query = new URLSearchParams()
    query.set("formatted", "true")
    if (date) query.set("date", date)
    if (crumb) query.set("crumb", crumb)
    const url = "https://query1.finance.yahoo.com/v7/finance/options/" + encodeURIComponent(symbol) + "?" + query.toString()
    const response = await fetch(url, { headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, signal: AbortSignal.timeout(9000) })
    if (!response.ok) throw new Error("Yahoo options returned " + response.status + (crumb ? " after crumb authentication" : " without a usable Yahoo crumb"))
    const payload = await response.json(), result = payload?.optionChain?.result?.[0]
    if (!result) throw new Error(payload?.optionChain?.error?.description || "No options chain returned")
    const options = (result.options || []).map(chain => ({
      expirationDate: chain.expirationDate,
      calls: (chain.calls || []).map(c => ({ contractSymbol:c.contractSymbol,strike:c.strike,bid:c.bid,ask:c.ask,lastPrice:c.lastPrice,volume:c.volume,openInterest:c.openInterest,impliedVolatility:c.impliedVolatility,inTheMoney:c.inTheMoney })),
      puts: (chain.puts || []).map(c => ({ contractSymbol:c.contractSymbol,strike:c.strike,bid:c.bid,ask:c.ask,lastPrice:c.lastPrice,volume:c.volume,openInterest:c.openInterest,impliedVolatility:c.impliedVolatility,inTheMoney:c.inTheMoney }))
    }))
    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60")
    return res.status(200).json({ symbol, underlyingPrice:result.quote?.regularMarketPrice??null, expirationDates:result.expirationDates||[], options, source:"Yahoo Finance Options", delayed:true, updatedAt:Date.now() })
  } catch (error) {
    console.error("Yahoo options unavailable:", error instanceof Error ? error.message : "unknown error")
    return res.status(502).json({ error:"Yahoo Finance options data is currently unavailable", detail:error instanceof Error?error.message:"Unknown error" })
  }
}
