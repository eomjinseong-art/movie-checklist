(function () {
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
  // Checks: this device (localStorage) + one shared list on the server after password login (sync-client.js).
  const SYNC = window.MovieSync;
  const items = SYNC.items;
  let state = SYNC.stateFromItems(items);

  function keysOf(el) {
    return (el.dataset.keys || "").split(",").filter(Boolean);
  }
  function isOn(keys) {
    return keys.some((k) => items[k] && items[k].v);
  }
  function setFilm(keys, on) {
    const t = SYNC.now();
    keys.forEach((k) => { items[k] = { v: on ? 1 : 0, t: t }; });
    state = SYNC.stateFromItems(items);
    SYNC.changed();
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

  SYNC.onRemoteChange(() => {
    state = SYNC.stateFromItems(items);
    refresh();
  });

  refresh();
  SYNC.start();
})();
