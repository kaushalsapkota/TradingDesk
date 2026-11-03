const crypto = require("node:crypto");
const google = require("./google");

const secret = () => process.env.AUTH_SECRET || "";
const sign = value => crypto.createHmac("sha256", secret()).update(value).digest("base64url");
const json = (res, status, body, headers = {}) => {
  res.statusCode = status;
  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
};
const normalize = phone => String(phone || "").replace(/[\s().-]/g, "");
const valid = phone => /^\+[1-9]\d{7,14}$/.test(phone);

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "POST required." });
  if (!secret()) return json(res, 503, { error: "Phone sign-in is not configured. Set AUTH_SECRET in Vercel." });
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; } catch { return json(res, 400, { error: "Invalid JSON." }); }
  const phone = normalize(body.phone);
  if (!valid(phone)) return json(res, 400, { error: "Use an international phone number, for example +61412345678." });
  const action = body.action || "send";
  if (action === "send") {
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_FROM_NUMBER) return json(res, 503, { error: "Phone sign-in is not configured. Set the Twilio environment variables in Vercel." });
    const code = String(crypto.randomInt(100000, 1000000));
    const payload = `${phone}.${code}.${Date.now() + 10 * 60 * 1000}`;
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    const sms = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ To: phone, From: process.env.TWILIO_FROM_NUMBER, Body: `Your Trading Desk verification code is ${code}. It expires in 10 minutes.` }),
    });
    if (!sms.ok) return json(res, 502, { error: "The SMS provider could not send a code." });
    return json(res, 200, { sent: true }, { "Set-Cookie": `td_phone_challenge=${encodeURIComponent(`${payload}.${sign(payload)}`)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=600` });
  }
  if (action === "verify") {
    const raw = req.headers.cookie?.match(/(?:^|;\s*)td_phone_challenge=([^;]+)/)?.[1];
    const value = raw && decodeURIComponent(raw), parts = value && value.split(".");
    if (!parts || parts.length !== 4 || parts[0] !== phone || !/^\d{6}$/.test(body.code || "") || Number(parts[2]) < Date.now() || sign(parts.slice(0, 3).join(".")) !== parts[3] || body.code !== parts[1]) return json(res, 400, { error: "That verification code is invalid or expired." });
    const session = google.pack({ provider: "phone", sub: phone, phone, name: phone }, 60 * 60 * 24 * 30);
    return json(res, 200, { verified: true, phone }, { "Set-Cookie": [`td_session=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=${60 * 60 * 24 * 30}`, "td_phone_challenge=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0"] });
  }
  return json(res, 400, { error: "Unknown phone action." });
};
