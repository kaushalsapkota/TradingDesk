export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) return res.status(503).json({ configured: false, error: "Supabase public client settings are not configured." });
  return res.status(200).json({ configured: true, url, key });
}
