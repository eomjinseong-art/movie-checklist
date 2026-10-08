// The one shared checklist (single-password mode). Requires the session cookie from /api/login.
//   GET  /api/shared                       -> { items, updatedAt, checked, now }
//   POST /api/shared { items }             -> last-write-wins merge (checks AND unchecks propagate)
//   POST /api/shared { mode: "import", items, legacyCode }
//        first login on a device: union only — every checked item from this device and from its legacy
//        sync code (read-only) becomes checked; nothing is ever unchecked or removed.
const S = require("./_lib/store");

module.exports = async function handler(req, res) {
  const cfg = S.redisConfig();
  if (!cfg) return S.send(res, 500, { error: "storage not configured" });
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return S.send(res, 405, { error: "method not allowed" });
  }
  if (!S.isAuthed(req)) return S.send(res, 401, { error: "login required" });

  try {
    if (req.method === "GET") {
      const cur = await S.readShared(cfg);
      return S.send(res, 200, { items: cur.items, updatedAt: cur.updatedAt, checked: S.countChecked(cur.items), now: Date.now() });
    }

    let body;
    try {
      body = await S.readBody(req);
    } catch (e) {
      return S.send(res, 400, { error: "invalid body" });
    }
    const incoming = S.sanitizeItems(body && body.items);

    if (body && body.mode === "import") {
      let legacy = {};
      const code = S.normalizeCode(body.legacyCode);
      if (S.CODE_RE.test(code)) {
        const raw = await S.redis(cfg, ["GET", S.LEGACY_PREFIX + code]); // read-only
        if (raw) {
          try { legacy = S.sanitizeItems(JSON.parse(raw).items); } catch (e) { legacy = {}; }
        }
      }
      let addedDevice = 0, addedLegacy = 0;
      const out = await S.updateShared(cfg, (items) => {
        const a = S.unionChecked(items, legacy);
        const b = S.unionChecked(a.items, incoming);
        addedLegacy = a.added;
        addedDevice = b.added;
        return b.items;
      });
      return S.send(res, 200, {
        items: out.items, updatedAt: out.updatedAt, checked: S.countChecked(out.items), now: Date.now(),
        imported: { fromLegacy: addedLegacy, fromDevice: addedDevice },
      });
    }

    const out = await S.updateShared(cfg, (items) => S.mergeLww(items, incoming));
    return S.send(res, 200, { items: out.items, updatedAt: out.updatedAt, checked: S.countChecked(out.items), now: Date.now() });
  } catch (e) {
    return S.send(res, 502, { error: "storage unavailable" });
  }
};
