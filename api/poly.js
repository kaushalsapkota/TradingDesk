export default async function handler(req, res) {
  const url = "https://gamma-api.polymarket.com/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=60"
  try {
    const response = await fetch(url, { headers:{Accept:"application/json","User-Agent":"TradingDesk/1.0"}, signal:AbortSignal.timeout(9000) })
    if (!response.ok) throw new Error("Polymarket returned " + response.status)
    const data = await response.json()
    res.setHeader("Cache-Control","s-maxage=30, stale-while-revalidate=60")
    return res.status(200).json({source:"Polymarket Gamma API",realtime:true,updatedAt:Date.now(),data:Array.isArray(data)?data:[]})
  } catch (error) {
    console.error("Polymarket feed unavailable:", error instanceof Error ? error.message : "unknown error")
    return res.status(502).json({error:"Polymarket data is currently unavailable",detail:error instanceof Error?error.message:"Unknown error"})
  }
}
