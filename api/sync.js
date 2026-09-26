// Cross-device sync for the movie checklist.
// Storage: Upstash Redis (Vercel Marketplace) via REST — env KV_REST_API_URL / KV_REST_API_TOKEN
// (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN also accepted).
//
// Data model per sync code: { items: { "<actorId>:<movieId>": { v: 0|1, t: <ms> } }, updatedAt }
// Merge rule: last-write-wins per movie (higher t wins), so checks AND unchecks propagate
// and merging two devices never drops data.

const KEY_PREFIX = "movie-checklist:sync:";
const CODE_RE = /^[A-Z0-9]{12,64}$/;
const ITEM_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,127}$/i;
const MAX_ITEMS = 5000;

function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return { url: url.replace(/\/$/, ""), token };
}

async function redis(cfg, command) {
  const r = await fetch(cfg.url, {
    method: "POST",
    headers: { Authorization: "Bearer " + cfg.token, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error("redis error: " + (data.error || r.status));
  return data.result;
}

function normalizeCode(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function sanitizeItems(input) {
  const out = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  let n = 0;
  for (const k of Object.keys(input)) {
    if (n >= MAX_ITEMS) break;
    if (!ITEM_KEY_RE.test(k)) continue;
    const it = input[k];
    if (!it || typeof it !== "object") continue;
    const v = it.v ? 1 : 0;
    const t = Number(it.t);
    if (!Number.isFinite(t) || t < 0) continue;
    out[k] = { v, t: Math.min(Math.floor(t), Date.now() + 5 * 60 * 1000) };
    n++;
  }
  return out;
}

function merge(base, incoming) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(incoming)) {
    const cur = out[k];
    const inc = incoming[k];
    if (!cur || inc.t > cur.t || (inc.t === cur.t && inc.v > cur.v)) out[k] = inc;
  }
  return out;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === "string") return JSON.parse(req.body || "{}");
    if (Buffer.isBuffer(req.body)) return JSON.parse(req.body.toString("utf8") || "{}");
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 512 * 1024) throw new Error("too large");
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(obj));
}

module.exports = async function handler(req, res) {
  const cfg = redisConfig();
  if (!cfg) return send(res, 500, { error: "storage not configured" });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url, "http://localhost");
      const code = normalizeCode(url.searchParams.get("code"));
      if (!CODE_RE.test(code)) return send(res, 400, { error: "invalid code" });
      const raw = await redis(cfg, ["GET", KEY_PREFIX + code]);
      const doc = raw ? JSON.parse(raw) : null;
      return send(res, 200, {
        code,
        exists: !!doc,
        items: (doc && doc.items) || {},
        updatedAt: (doc && doc.updatedAt) || 0,
        now: Date.now(),
      });
    }

    if (req.method === "POST") {
      let body;
      try {
        body = await readBody(req);
      } catch (e) {
        return send(res, 400, { error: "invalid body" });
      }
      const code = normalizeCode(body && body.code);
      if (!CODE_RE.test(code)) return send(res, 400, { error: "invalid code" });
      const incoming = sanitizeItems(body.items);
      const key = KEY_PREFIX + code;
      const raw = await redis(cfg, ["GET", key]);
      const doc = raw ? JSON.parse(raw) : { items: {} };
      const merged = merge(sanitizeItems(doc.items), incoming);
      const changed = JSON.stringify(merged) !== JSON.stringify(doc.items || {});
      const updatedAt = changed ? Date.now() : doc.updatedAt || Date.now();
      if (changed || !raw) {
        await redis(cfg, ["SET", key, JSON.stringify({ items: merged, updatedAt })]);
      }
      return send(res, 200, { code, items: merged, updatedAt, now: Date.now() });
    }

    res.setHeader("Allow", "GET, POST");
    return send(res, 405, { error: "method not allowed" });
  } catch (e) {
    return send(res, 502, { error: "storage unavailable" });
  }
};
