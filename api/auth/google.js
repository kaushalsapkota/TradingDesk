const crypto = require("node:crypto");

const cookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.secure !== false) parts.push("Secure");
  return parts.join("; ");
};

const secret = () => process.env.AUTH_SECRET || process.env.GOOGLE_CLIENT_SECRET || "";
const sign = value => crypto.createHmac("sha256", secret()).update(value).digest("base64url");
const same = (a, b) => {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};
const pack = (value, maxAge) => {
  const body = Buffer.from(JSON.stringify({ ...value, exp: Math.floor(Date.now() / 1000) + maxAge })).toString("base64url");
  return `${body}.${sign(body)}`;
};
const unpack = value => {
  if (!value || !secret()) return null;
  const [body, sig] = value.split(".");
  if (!body || !sig || !same(sig, sign(body))) return null;
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  return data.exp > Math.floor(Date.now() / 1000) ? data : null;
};
const send = (res, status, body, headers = {}) => {
  res.statusCode = status;
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};

module.exports = async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const origin = `${req.headers["x-forwarded-proto"] || "https"}://${req.headers["x-forwarded-host"] || req.headers.host || "localhost"}`;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google?mode=callback`;
  if (!secret()) return send(res, 503, { error: "Authentication is not configured. Set AUTH_SECRET in Vercel." });

  if (req.method === "GET" && new URL(req.url, "http://localhost").searchParams.get("mode") === "callback") {
    const params = new URL(req.url, "http://localhost").searchParams;
    const code = params.get("code");
    const state = params.get("state");
    const expected = req.headers.cookie?.match(/(?:^|;\s*)td_oauth_state=([^;]+)/)?.[1];
    if (!code || !state || !expected || !same(decodeURIComponent(expected), state)) {
      return send(res, 400, { error: "Google sign-in state is invalid or expired." });
    }
    if (!clientId || !process.env.GOOGLE_CLIENT_SECRET) return send(res, 503, { error: "Google OAuth credentials are not configured." });
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code" }),
    });
    if (!tokenResponse.ok) return send(res, 502, { error: "Google token exchange failed." });
    const tokens = await tokenResponse.json();
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    if (!profileResponse.ok) return send(res, 502, { error: "Google profile lookup failed." });
    const profile = await profileResponse.json();
    const target = "/";
    res.statusCode = 302;
    res.setHeader("Location", target);
    res.setHeader("Set-Cookie", [
      cookie("td_session", pack({ provider: "google", sub: profile.sub, email: profile.email, name: profile.name || profile.email, picture: profile.picture || "" }, 60 * 60 * 24 * 30), { maxAge: 60 * 60 * 24 * 30 }),
      cookie("td_oauth_state", "", { maxAge: 0 }),
    ]);
    return res.end();
  }

  if (!clientId) return send(res, 503, { error: "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Vercel." });
  const state = crypto.randomBytes(24).toString("base64url");
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    state,
    prompt: "select_account",
  });
  res.statusCode = 302;
  res.setHeader("Location", url.toString());
  res.setHeader("Set-Cookie", cookie("td_oauth_state", state, { maxAge: 600 }));
  res.end();
};

module.exports.unpack = unpack;
module.exports.pack = pack;
