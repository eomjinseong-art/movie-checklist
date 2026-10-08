// Shared checklist storage for every page (single-password mode).
//
// - Checks always live in this device's localStorage ("movie-checklist-items-v2":
//   { "<listId>:<movieId>": { v: 0|1, t: ms } }, plus the older "movie-checklist-v1" {listId: [movieId]} cache).
// - After the password is typed once on a device (POST /api/login -> ~400-day httpOnly cookie), checks are saved
//   to ONE shared list on the server (/api/shared) and every logged-in device sees the same list.
// - First login on a device imports that device's checks (and its old sync code's checks) as a union — never removes.
// - Without login the lists stay viewable and checks are kept on this device only.
(function () {
  const STORAGE_KEY = "movie-checklist-v1";
  const ITEMS_KEY = "movie-checklist-items-v2";
  const CODE_KEY = "movie-checklist-sync-code"; // legacy sync code (kept, read for the one-time import)
  const DIRTY_KEY = "movie-checklist-sync-dirty";
  const OFFSET_KEY = "movie-checklist-clock-offset";
  const IMPORTED_KEY = "movie-checklist-imported-v1";
  const AUTH_KEY = "movie-checklist-auth-v1"; // UI hint only; the real session is the httpOnly cookie
  const BACKUP_KEY = "movie-checklist-pre-shared-backup-v1";
  const API_URL = "/api/shared";

  const listeners = [];
  const items = loadItems();
  let clockOffset = Number(localStorage.getItem(OFFSET_KEY)) || 0;
  let loggedIn = localStorage.getItem(AUTH_KEY) === "1";
  let saveTimer = null;
  let inflight = null;
  let status = "saving";

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      return obj && typeof obj === "object" ? obj : null;
    } catch (e) {
      return null;
    }
  }
  function legacyChecks() {
    // Old v1 cache: {listId: [movieId, ...]} -> {"listId:movieId": {v:1, t:1}}
    const legacy = readJSON(STORAGE_KEY) || {};
    const out = {};
    Object.keys(legacy).forEach((aid) => {
      if (!Array.isArray(legacy[aid])) return;
      legacy[aid].forEach((mid) => { out[aid + ":" + mid] = { v: 1, t: 1 }; });
    });
    return out;
  }
  function loadItems() {
    const v2 = readJSON(ITEMS_KEY);
    if (v2) return v2;
    const out = legacyChecks();
    if (Object.keys(out).length) localStorage.setItem(DIRTY_KEY, "1");
    return out;
  }
  function stateFromItems(its) {
    const st = {};
    Object.keys(its).forEach((k) => {
      if (!its[k] || !its[k].v) return;
      const i = k.indexOf(":");
      if (i < 1) return;
      const aid = k.slice(0, i), mid = k.slice(i + 1);
      (st[aid] = st[aid] || []).push(mid);
    });
    return st;
  }
  function persistLocal() {
    try {
      localStorage.setItem(ITEMS_KEY, JSON.stringify(items));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stateFromItems(items))); // keep v1 cache in sync
    } catch (e) {}
  }
  function now() {
    return Date.now() + clockOffset;
  }
  function notify() {
    listeners.forEach((fn) => { try { fn(); } catch (e) {} });
  }
  function applyServerItems(serverItems) {
    let changed = false;
    Object.keys(serverItems || {}).forEach((k) => {
      const inc = serverItems[k], cur = items[k];
      if (!inc || typeof inc.t !== "number") return;
      if (!cur || inc.t > cur.t || (inc.t === cur.t && inc.v > cur.v)) {
        if (!cur || cur.v !== inc.v || cur.t !== inc.t) changed = true;
        items[k] = { v: inc.v ? 1 : 0, t: inc.t };
      }
    });
    return changed;
  }

  // ---- UI ----
  const panel = document.getElementById("sync-panel");
  const form = document.getElementById("sync-login");
  const passEl = document.getElementById("sync-pass");
  const loginBtn = document.getElementById("sync-login-btn");
  const onRow = document.getElementById("sync-on");
  const statusEl = document.getElementById("sync-status");
  const logoutBtn = document.getElementById("sync-logout");
  const helpEl = document.getElementById("sync-help");
  const msgEl = document.getElementById("sync-msg");

  function showMsg(text, isErr) {
    if (!msgEl) return;
    msgEl.textContent = text || "";
    msgEl.classList.toggle("err", !!isErr);
  }
  function setStatus(st) {
    status = st;
    if (!statusEl) return;
    statusEl.textContent = st === "offline" ? "오프라인 · 연결되면 자동 저장" : "저장 중 · 모든 기기 공유";
    statusEl.className = "sync-status " + st;
  }
  function renderAuth() {
    if (form) form.hidden = loggedIn;
    if (onRow) onRow.hidden = !loggedIn;
    if (helpEl) helpEl.hidden = loggedIn;
    if (panel) panel.classList.toggle("on", loggedIn);
  }
  function setLoggedOut(message) {
    loggedIn = false;
    localStorage.removeItem(AUTH_KEY);
    clearTimeout(saveTimer);
    renderAuth();
    if (message) showMsg(message, true);
  }

  // ---- Server sync ----
  function scheduleSave(delay) {
    if (!loggedIn) return;
    setStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { sync(); }, delay == null ? 700 : delay);
  }
  function updateOffset(data, sentAt) {
    if (typeof data.now !== "number") return;
    const rtt = Date.now() - sentAt;
    clockOffset = data.now - (sentAt + rtt / 2);
    if (Math.abs(clockOffset) < 5000) clockOffset = 0; // ignore small skew
    localStorage.setItem(OFFSET_KEY, String(Math.round(clockOffset)));
  }
  function post(body) {
    return fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      credentials: "same-origin",
    }).then((r) => {
      if (r.status === 401) { const e = new Error("auth"); e.auth = true; throw e; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function onSyncError(e) {
    if (e && e.auth) setLoggedOut("로그인이 만료됐어요. 비밀번호를 다시 입력해 주세요. (체크는 이 기기에 남아 있어요)");
    else setStatus("offline");
  }

  // First login on this device: union this device's checks (+ its legacy sync code) into the shared list.
  function firstImport() {
    if (!localStorage.getItem(BACKUP_KEY)) {
      try {
        localStorage.setItem(BACKUP_KEY, JSON.stringify({
          at: Date.now(),
          itemsV2: localStorage.getItem(ITEMS_KEY),
          v1: localStorage.getItem(STORAGE_KEY),
          syncCode: localStorage.getItem(CODE_KEY),
        }));
      } catch (e) {}
    }
    const checked = {};
    const v1 = legacyChecks();
    Object.keys(v1).forEach((k) => { checked[k] = { v: 1, t: (items[k] && items[k].t) || 1 }; });
    Object.keys(items).forEach((k) => { if (items[k] && items[k].v) checked[k] = { v: 1, t: items[k].t }; });
    const legacyCode = String(localStorage.getItem(CODE_KEY) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const startedAt = now();
    const sentAt = Date.now();
    setStatus("saving");
    inflight = post({ mode: "import", items: checked, legacyCode: legacyCode.length >= 12 ? legacyCode : "" })
      .then((data) => {
        updateOffset(data, sentAt);
        const server = data.items || {};
        // The server now holds every check from this device. Drop this device's OLD unchecks for movies the
        // shared list has checked, so joining never removes a check; edits made after the import started still win.
        Object.keys(server).forEach((k) => {
          const cur = items[k], inc = server[k];
          if (inc && inc.v && cur && !cur.v && cur.t <= startedAt) items[k] = { v: 1, t: inc.t };
        });
        applyServerItems(server);
        localStorage.setItem(IMPORTED_KEY, "1");
        persistLocal();
        notify();
        const n = data.imported ? data.imported.fromDevice + data.imported.fromLegacy : 0;
        showMsg(n ? "이 기기의 체크 " + n + "편을 공유 목록에 합쳤어요." : "");
        setStatus("saved");
      })
      .catch(onSyncError)
      .finally(() => {
        inflight = null;
        if (loggedIn && localStorage.getItem(IMPORTED_KEY) === "1") scheduleSave(0); // push any edits made meanwhile
      });
    return inflight;
  }

  function sync() {
    if (!loggedIn) return;
    if (inflight) { scheduleSave(400); return; }
    if (localStorage.getItem(IMPORTED_KEY) !== "1") return firstImport();
    const sentDirtyAt = localStorage.getItem(DIRTY_KEY);
    const sentAt = Date.now();
    inflight = post({ items })
      .then((data) => {
        updateOffset(data, sentAt);
        const changed = applyServerItems(data.items);
        if (localStorage.getItem(DIRTY_KEY) === sentDirtyAt) localStorage.removeItem(DIRTY_KEY);
        persistLocal();
        if (changed) notify();
        if (localStorage.getItem(DIRTY_KEY)) scheduleSave(300);
        else setStatus("saved");
      })
      .catch(onSyncError)
      .finally(() => { inflight = null; });
    return inflight;
  }
  function flushBeacon() {
    if (!loggedIn || localStorage.getItem(IMPORTED_KEY) !== "1" || !localStorage.getItem(DIRTY_KEY) || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon(API_URL, new Blob([JSON.stringify({ items })], { type: "application/json" }));
    } catch (e) {}
  }

  async function login(e) {
    if (e) e.preventDefault();
    const password = passEl ? passEl.value : "";
    if (!password) { showMsg("비밀번호를 입력해 주세요.", true); return; }
    if (loginBtn) loginBtn.disabled = true;
    showMsg("확인 중…");
    try {
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        cache: "no-store",
        credentials: "same-origin",
      });
      if (r.status === 401) { showMsg("비밀번호가 맞지 않아요.", true); return; }
      if (r.status === 429) { showMsg("시도가 너무 많아요. 15분 뒤에 다시 해 주세요.", true); return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      if (passEl) passEl.value = "";
      loggedIn = true;
      localStorage.setItem(AUTH_KEY, "1");
      renderAuth();
      showMsg("");
      sync();
    } catch (err) {
      showMsg("서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.", true);
    } finally {
      if (loginBtn) loginBtn.disabled = false;
    }
  }
  async function logout() {
    flushBeacon();
    try { await fetch("/api/logout", { method: "POST", credentials: "same-origin", cache: "no-store" }); } catch (e) {}
    setLoggedOut("");
    showMsg("로그아웃했어요. 체크는 이 기기에만 저장돼요.");
  }

  if (form) form.addEventListener("submit", login);
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  window.addEventListener("online", () => scheduleSave(0));
  window.addEventListener("offline", () => { if (loggedIn) setStatus("offline"); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSave(0); // pull changes from other devices
    else flushBeacon();
  });
  window.addEventListener("pagehide", flushBeacon);
  setInterval(() => {
    if (!loggedIn || document.visibilityState !== "visible") return;
    if (status === "offline" || localStorage.getItem(DIRTY_KEY)) sync();
  }, 20000);

  function start() {
    renderAuth();
    if (loggedIn) {
      setStatus("saving");
      sync();
      return;
    }
    // A session cookie may exist even if the UI hint was cleared: probe quietly.
    fetch(API_URL, { cache: "no-store", credentials: "same-origin" })
      .then((r) => {
        if (!r.ok) return;
        loggedIn = true;
        localStorage.setItem(AUTH_KEY, "1");
        renderAuth();
        setStatus("saving");
        sync();
      })
      .catch(() => {});
  }

  window.MovieSync = {
    items, // live object: { "<listId>:<movieId>": { v, t } }
    now,
    stateFromItems,
    // Call after changing `items` locally: saves on this device, then to the server when logged in.
    changed() {
      persistLocal();
      localStorage.setItem(DIRTY_KEY, "1");
      scheduleSave();
    },
    onRemoteChange(fn) { listeners.push(fn); },
    start,
  };
})();
