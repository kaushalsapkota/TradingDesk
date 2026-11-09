export default function handler(req, res) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    res.status(503).json({ error: "Authentication is not configured." });
    return;
  }

  const origin = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  const redirectTo = `${origin}/?auth=google`;
  const url = new URL(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  url.searchParams.set('apikey', anonKey);
  res.writeHead(302, { Location: url.toString(), 'Cache-Control': 'no-store' });
  res.end();
}
