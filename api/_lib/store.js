// Shared helpers for the single-password sync API (not a route: files under api/_lib are ignored by Vercel routing).
//
// Canonical list: Redis string key "movie-checklist:shared:v1"
//   value: { items: { "<listId>:<movieId>": { v: 0|1, t: <ms> } }, updatedAt }
// Before every write the previous value is pushed to "movie-checklist:shared:v1:history" (newest first, max 50).
// Legacy per-code keys "movie-checklist:sync:<CODE>" are only ever READ here (first-login import).
const crypto = require("crypto");

const SHARED_KEY = "movie-checklist:shared:v1";
const HISTORY_KEY = "movie-checklist:shared:v1:history";
const HISTORY_MAX = 50;
const LEGACY_PREFIX = "movie-checklist:sync:";
const LOGIN_FAIL_PREFIX = "movie-checklist:loginfail:";
const CODE_RE = /^[A-Z0-9]{12,64}$/;
const ITEM_KEY_RE = /^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,127}$/i;
const MAX_ITEMS = 5000;
const COOKIE_NAME = "mc_session";
const SESSION_MAX_AGE = 400 * 24 * 60 * 60; // seconds (browser cap for cookie Max-Age)

// Compare-and-set with rolling history, atomically inside Redis.
const CAS_SCRIPT = [
  "local cur = redis.call('GET', KEYS[1])",
  "if (cur == false and ARGV[1] == '') or cur == ARGV[1] then",
  "  if cur then",
  "    redis.call('LPUSH', KEYS[2], cur)",
  "    redis.call('LTRIM', KEYS[2], 0, tonumber(ARGV[3]) - 1)",
  "  end",
  "  redis.call('SET', KEYS[1], ARGV[2])",
  "  return 1",
  "end",
  "return 0",
].join("\n");

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

// Last-write-wins per movie (same rule as the legacy /api/sync).
function mergeLww(base, incoming) {
  const out = Object.assign({}, base);
  for (const k of Object.keys(incoming)) {
    const cur = out[k];
    const inc = incoming[k];
    if (!cur || inc.t > cur.t || (inc.t === cur.t && inc.v > cur.v)) out[k] = inc;
  }
  return out;
}

// Union of checks: every incoming v:1 becomes checked; nothing is ever unchecked or removed.
function unionChecked(base, incoming) {
  const out = Object.assign({}, base);
  let added = 0;
  for (const k of Object.keys(incoming)) {
    const inc = incoming[k];
    if (!inc || !inc.v) continue;
    const cur = out[k];
    if (cur && cur.v) continue;
    out[k] = { v: 1, t: Math.max(inc.t, cur ? cur.t + 1 : 0) };
    added++;
  }
  return { items: out, added };
}

function countChecked(items) {
  return Object.keys(items).filter((k) => items[k] && items[k].v).length;
}

async function readShared(cfg) {
  const raw = await redis(cfg, ["GET", SHARED_KEY]);
  const doc = raw ? JSON.parse(raw) : { items: {}, updatedAt: 0 };
  return { raw: raw || "", items: sanitizeItems(doc.items), updatedAt: doc.updatedAt || 0 };
}

// Read-modify-write with optimistic concurrency. `update(items)` returns new items.
async function updateShared(cfg, update) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const cur = await readShared(cfg);
    const next = update(cur.items);
    if (JSON.stringify(next) === JSON.stringify(cur.items) && cur.raw) {
      return { items: cur.items, updatedAt: cur.updatedAt, written: false };
    }
    const updatedAt = Date.now();
    const value = JSON.stringify({ items: next, updatedAt });
    const ok = await redis(cfg, ["EVAL", CAS_SCRIPT, "2", SHARED_KEY, HISTORY_KEY, cur.raw, value, String(HISTORY_MAX)]);
    if (Number(ok) === 1) return { items: next, updatedAt, written: true };
  }
  throw new Error("busy");
}

// ---- Password + session ----
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromB64url(s) {
  return Buffer.from(String(s).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// MOVIE_CHECKLIST_PASSWORD_HASH = "scrypt$<N>$<r>$<p>$<saltB64>$<hashB64>"
function verifyPassword(password) {
  const spec = process.env.MOVIE_CHECKLIST_PASSWORD_HASH || "";
  const parts = spec.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return Promise.resolve(null); // not configured
  const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  return new Promise((resolve) => {
    crypto.scrypt(String(password), salt, expected.length, { N, r, p, maxmem: 256 * N * r + 1024 * 1024 }, (err, got) => {
      if (err) return resolve(false);
      resolve(got.length === expected.length && crypto.timingSafeEqual(got, expected));
    });
  });
}

function sessionSecret() {
  const s = process.env.MOVIE_CHECKLIST_SESSION_SECRET || "";
  return s.length >= 32 ? s : null;
}

function signSession() {
  const secret = sessionSecret();
  if (!secret) return null;
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(JSON.stringify({ v: 1, iat: now, exp: now + SESSION_MAX_AGE }));
  const sig = b64url(crypto.createHmac("sha256", secret).update(payload).digest());
  return payload + "." + sig;
}

function readCookie(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function isAuthed(req) {
  const secret = sessionSecret();
  const tok = readCookie(req, COOKIE_NAME);
  if (!secret || !tok) return false;
  const dot = tok.indexOf(".");
  if (dot < 1) return false;
  const payload = tok.slice(0, dot);
  const sig = fromB64url(tok.slice(dot + 1));
  const want = crypto.createHmac("sha256", secret).update(payload).digest();
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return false;
  try {
    const data = JSON.parse(fromB64url(payload).toString("utf8"));
    return data.v === 1 && Number(data.exp) > Date.now() / 1000;
  } catch (e) {
    return false;
  }
}

function sessionCookie(token) {
  return COOKIE_NAME + "=" + token + "; Path=/; Max-Age=" + SESSION_MAX_AGE + "; HttpOnly; Secure; SameSite=Lax";
}
function clearCookie() {
  return COOKIE_NAME + "=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax";
}

function clientIp(req) {
  const h = req.headers;
  const raw = h["x-vercel-forwarded-for"] || h["x-real-ip"] || h["x-forwarded-for"] || "";
  const ip = String(raw).split(",")[0].trim() || "unknown";
  return ip.replace(/[^0-9a-fA-F:.]/g, "").slice(0, 64) || "unknown";
}

// ---- HTTP ----
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

function send(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [k, v] of Object.entries(headers || {})) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

module.exports = {
  SHARED_KEY, HISTORY_KEY, LEGACY_PREFIX, LOGIN_FAIL_PREFIX, CODE_RE,
  redisConfig, redis, normalizeCode, sanitizeItems, mergeLww, unionChecked, countChecked,
  readShared, updateShared, verifyPassword, signSession, isAuthed, sessionCookie, clearCookie,
  clientIp, readBody, send,
};
