export default async function handler(req, res) {
  const symbol = String(req.query?.symbol || "SPY").trim().toUpperCase(), date = String(req.query?.date || "").trim()
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || (date && !/^\d{9,12}$/.test(date))) return res.status(400).json({ error: "Invalid options request" })
  const url = "https://query1.finance.yahoo.com/v7/finance/options/" + encodeURIComponent(symbol) + (date ? "?date=" + encodeURIComponent(date) : "")
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 TradingDesk/1.0", Accept: "application/json" }, signal: AbortSignal.timeout(9000) })
    if (!response.ok) throw new Error("Yahoo options returned " + response.status)
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
