// POST /api/logout -> clears this device's session cookie (saved checks are untouched).
const S = require("./_lib/store");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return S.send(res, 405, { error: "method not allowed" });
  }
  return S.send(res, 200, { ok: true }, { "Set-Cookie": S.clearCookie() });
};
