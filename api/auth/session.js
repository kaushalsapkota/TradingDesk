const google = require("./google");

module.exports = async (req, res) => {
  const value = req.headers.cookie?.match(/(?:^|;\s*)td_session=([^;]+)/)?.[1];
  const session = google.unpack(value && decodeURIComponent(value));
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify({ signedIn: !!session, user: session ? { name: session.name, email: session.email, picture: session.picture, provider: session.provider } : null }));
};
