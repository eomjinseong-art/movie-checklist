(function () {
  const STORAGE_KEY = "movie-checklist-v1";
  const ITEMS_KEY = "movie-checklist-items-v2";
  const CODE_KEY = "movie-checklist-sync-code";
  const DIRTY_KEY = "movie-checklist-sync-dirty";
  const OFFSET_KEY = "movie-checklist-clock-offset";
  const API_URL = "/api/sync";
  const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const CODE_LEN = 16;

  const films = Array.from(document.querySelectorAll("article.movie"));
  const progressText = document.getElementById("progress-text");
  const pctEl = document.getElementById("pct");
  const barFill = document.getElementById("bar-fill");
  const emptyEl = document.getElementById("empty");
  const searchEl = document.getElementById("search");
  const sidebar = document.getElementById("sidebar");
  const backdrop = document.getElementById("backdrop");
  const total = films.length;

  let tag = "all";
  let unwatchedOnly = false;
  let items = loadItems();
  let state = stateFromItems(items);
  let syncCode = null;
  let clockOffset = Number(localStorage.getItem(OFFSET_KEY)) || 0;
  let saveTimer = null;
  let inflight = null;

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
  function loadItems() {
    const v2 = readJSON(ITEMS_KEY);
    if (v2) return v2;
    const legacy = readJSON(STORAGE_KEY) || {};
    const out = {};
    Object.keys(legacy).forEach((aid) => {
      if (!Array.isArray(legacy[aid])) return;
      legacy[aid].forEach((mid) => { out[aid + ":" + mid] = { v: 1, t: 1 }; });
    });
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }
  function now() { return Date.now() + clockOffset; }
  function keysOf(el) {
    return (el.dataset.keys || "").split(",").filter(Boolean);
  }
  function isOn(keys) {
    return keys.some((k) => items[k] && items[k].v);
  }
  function setFilm(keys, on) {
    const t = now();
    keys.forEach((k) => { items[k] = { v: on ? 1 : 0, t: t }; });
    state = stateFromItems(items);
    persistLocal();
    localStorage.setItem(DIRTY_KEY, "1");
    scheduleSave();
    refresh();
  }

  function refresh() {
    const q = searchEl.value.trim().toLowerCase();
    let watched = 0;
    let visible = 0;
    films.forEach((el) => {
      const keys = keysOf(el);
      const on = isOn(keys);
      if (on) watched++;
      el.classList.toggle("watched", on);
      const box = el.querySelector('input[type="checkbox"]');
      if (box) box.checked = on;
      const tags = (el.dataset.tags || "").split(" ").filter(Boolean);
      const hay = el.dataset.search || "";
      let show = true;
      if (tag !== "all" && tags.indexOf(tag) === -1) show = false;
      if (unwatchedOnly && on) show = false;
      if (q && hay.indexOf(q) === -1) show = false;
      el.hidden = !show;
      if (show) visible++;
    });
    progressText.textContent = watched + "/" + total + " 봤어요";
    const pct = total ? Math.round((watched / total) * 100) : 0;
    pctEl.textContent = pct + "%";
    barFill.style.width = pct + "%";
    emptyEl.classList.toggle("show", visible === 0);
  }

  films.forEach((el) => {
    const box = el.querySelector('input[type="checkbox"]');
    if (!box) return;
    box.addEventListener("click", (e) => e.stopPropagation());
    box.addEventListener("change", () => {
      const keys = keysOf(el);
      setFilm(keys, box.checked);
    });
  });

  document.querySelectorAll(".tag-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      tag = btn.dataset.tag || "all";
      document.querySelectorAll(".tag-btn").forEach((b) => b.classList.toggle("active", b === btn));
      sidebar.classList.remove("open");
      backdrop.classList.remove("show");
      refresh();
    });
  });

  document.getElementById("show-all").addEventListener("click", () => {
    unwatchedOnly = false;
    document.getElementById("show-all").classList.add("active");
    document.getElementById("show-all").setAttribute("aria-pressed", "true");
    document.getElementById("unwatched-only").classList.remove("active");
    document.getElementById("unwatched-only").setAttribute("aria-pressed", "false");
    refresh();
  });
  document.getElementById("unwatched-only").addEventListener("click", () => {
    unwatchedOnly = true;
    document.getElementById("unwatched-only").classList.add("active");
    document.getElementById("unwatched-only").setAttribute("aria-pressed", "true");
    document.getElementById("show-all").classList.remove("active");
    document.getElementById("show-all").setAttribute("aria-pressed", "false");
    refresh();
  });
  searchEl.addEventListener("input", refresh);

  document.getElementById("menu-toggle").addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    backdrop.classList.toggle("show", open);
  });
  backdrop.addEventListener("click", () => {
    sidebar.classList.remove("open");
    backdrop.classList.remove("show");
  });

  const syncCodeEl = document.getElementById("sync-code");
  const syncStatusEl = document.getElementById("sync-status");
  const syncPanel = document.getElementById("sync-panel");
  const syncLinkEl = document.getElementById("sync-link");
  const syncInput = document.getElementById("sync-input");
  const syncMsg = document.getElementById("sync-msg");

  function normalizeCode(raw) {
    return String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }
  function formatCode(code) {
    return code.replace(/(.{4})(?=.)/g, "$1-");
  }
  function generateCode() {
    const bytes = new Uint8Array(CODE_LEN);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    let c = "";
    for (let i = 0; i < CODE_LEN; i++) c += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return c;
  }
  function setStatus(st) {
    const label = { saved: "저장됨", saving: "저장 중…", offline: "오프라인 · 이 기기에 임시 저장" }[st] || "";
    syncStatusEl.textContent = label;
    syncStatusEl.className = "sync-status " + st;
  }
  function showMsg(text, isErr) {
    syncMsg.textContent = text || "";
    syncMsg.classList.toggle("err", !!isErr);
  }
  function scheduleSave(delay) {
    setStatus("saving");
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { sync(); }, delay == null ? 700 : delay);
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
  async function sync() {
    if (!syncCode) return;
    if (inflight) { scheduleSave(400); return; }
    const code = syncCode;
    const sentDirtyAt = localStorage.getItem(DIRTY_KEY);
    const sentAt = Date.now();
    inflight = fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, items: items }),
      cache: "no-store",
    })
      .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then((data) => {
        if (code !== syncCode) return;
        if (typeof data.now === "number") {
          const rtt = Date.now() - sentAt;
          clockOffset = data.now - (sentAt + rtt / 2);
          if (Math.abs(clockOffset) < 5000) clockOffset = 0;
          localStorage.setItem(OFFSET_KEY, String(Math.round(clockOffset)));
        }
        const changed = applyServerItems(data.items);
        if (localStorage.getItem(DIRTY_KEY) === sentDirtyAt) localStorage.removeItem(DIRTY_KEY);
        if (changed) {
          state = stateFromItems(items);
          refresh();
        }
        persistLocal();
        if (localStorage.getItem(DIRTY_KEY)) scheduleSave(300);
        else setStatus("saved");
      })
      .catch(() => {
        if (code === syncCode) setStatus("offline");
      })
      .finally(() => { inflight = null; });
    return inflight;
  }
  function flushBeacon() {
    if (!syncCode || !localStorage.getItem(DIRTY_KEY) || !navigator.sendBeacon) return;
    try {
      navigator.sendBeacon(API_URL, new Blob([JSON.stringify({ code: syncCode, items: items })], { type: "application/json" }));
    } catch (e) {}
  }
  function initSync() {
    let code = normalizeCode(localStorage.getItem(CODE_KEY));
    const first = code.length < 12;
    if (first) {
      code = generateCode();
      localStorage.setItem(CODE_KEY, code);
      localStorage.setItem(DIRTY_KEY, "1");
      syncPanel.classList.add("first");
      showMsg("새 동기화 코드가 만들어졌어요. 다른 기기에서 이어보려면 이 코드를 복사해 두세요.");
    }
    syncCode = code;
    syncCodeEl.textContent = formatCode(code);
    setStatus("saving");
    sync();
  }
  document.getElementById("sync-copy").addEventListener("click", () => {
    const text = formatCode(syncCode || "");
    const done = () => showMsg("코드를 복사했어요: " + text);
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  });
  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); done(); } catch (e) {
      showMsg("복사에 실패했어요. 코드를 길게 눌러 직접 복사해 주세요.", true);
    }
    ta.remove();
  }
  document.getElementById("sync-link-toggle").addEventListener("click", () => {
    syncLinkEl.classList.toggle("show");
    if (syncLinkEl.classList.contains("show")) syncInput.focus();
  });
  async function connectCode() {
    const code = normalizeCode(syncInput.value);
    if (code.length < 12 || code.length > 64) {
      showMsg("코드 형식이 올바르지 않아요. 다른 기기에 표시된 코드를 그대로 입력해 주세요.", true);
      return;
    }
    if (code === syncCode) { showMsg("이미 이 코드로 연결되어 있어요."); return; }
    showMsg("연결 중…");
    try {
      const r = await fetch(API_URL + "?code=" + encodeURIComponent(code), { cache: "no-store" });
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      if (!data.exists && !confirm("이 코드로 저장된 기록이 아직 없어요. 그래도 이 코드로 연결할까요?")) {
        showMsg("");
        return;
      }
      syncCode = code;
      localStorage.setItem(CODE_KEY, code);
      localStorage.setItem(DIRTY_KEY, "1");
      syncCodeEl.textContent = formatCode(code);
      syncPanel.classList.remove("first");
      applyServerItems(data.items);
      state = stateFromItems(items);
      persistLocal();
      refresh();
      syncInput.value = "";
      syncLinkEl.classList.remove("show");
      showMsg("연결됐어요. 이 기기의 체크 기록도 함께 합쳐 저장합니다.");
      scheduleSave(0);
    } catch (e) {
      showMsg("서버에 연결하지 못했어요. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.", true);
    }
  }
  document.getElementById("sync-connect").addEventListener("click", connectCode);
  syncInput.addEventListener("keydown", (e) => { if (e.key === "Enter") connectCode(); });
  window.addEventListener("online", () => scheduleSave(0));
  window.addEventListener("offline", () => setStatus("offline"));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") scheduleSave(0);
    else flushBeacon();
  });
  window.addEventListener("pagehide", flushBeacon);

  refresh();
  initSync();
})();
