// POST /api/login { password } -> sets a long-lived httpOnly session cookie (one login per device).
// Per-IP limit: 10 failed attempts per 15 minutes.
const S = require("./_lib/store");

const MAX_FAILS = 10;
const WINDOW_SEC = 15 * 60;

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return S.send(res, 405, { error: "method not allowed" });
  }
  const cfg = S.redisConfig();
  if (!cfg) return S.send(res, 500, { error: "storage not configured" });

  let body;
  try {
    body = await S.readBody(req);
  } catch (e) {
    return S.send(res, 400, { error: "invalid body" });
  }
  const password = body && typeof body.password === "string" ? body.password : "";
  if (!password || password.length > 200) return S.send(res, 400, { error: "password required" });

  const failKey = S.LOGIN_FAIL_PREFIX + S.clientIp(req);
  try {
    const fails = Number(await S.redis(cfg, ["GET", failKey])) || 0;
    if (fails >= MAX_FAILS) return S.send(res, 429, { error: "too many attempts" }, { "Retry-After": String(WINDOW_SEC) });

    const ok = await S.verifyPassword(password);
    if (ok === null) return S.send(res, 500, { error: "login not configured" });
    if (!ok) {
      await S.redis(cfg, ["SET", failKey, "0", "EX", String(WINDOW_SEC), "NX"]);
      await S.redis(cfg, ["INCR", failKey]);
      return S.send(res, 401, { error: "wrong password" });
    }
    const token = S.signSession();
    if (!token) return S.send(res, 500, { error: "login not configured" });
    return S.send(res, 200, { ok: true }, { "Set-Cookie": S.sessionCookie(token) });
  } catch (e) {
    return S.send(res, 502, { error: "storage unavailable" });
  }
};
