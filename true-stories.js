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
  const listEl = document.getElementById("film-list");
  const originalFilms = films.slice();
  const tagNav = document.getElementById("tag-nav");
  const tagButtons = Array.from(tagNav.querySelectorAll(".tag-btn"));
  // Same preference as the actor lists. Watched checks stay in MovieSync.
  const SORT_KEY = "movie-checklist-sort-v1";
  let sortMode = "best";
  try {
    const savedSort = localStorage.getItem(SORT_KEY);
    if (savedSort === "best" || savedSort === "original") sortMode = savedSort;
  } catch (e) { /* private mode: keep the default */ }

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

  function scoreOf(el) {
    const n = parseFloat(el.dataset.score);
    return Number.isFinite(n) ? n : -1;
  }
  function tagMembers(tagName) {
    if (!tagName || tagName === "all") return films;
    return films.filter((el) => (el.dataset.tags || "").split(" ").indexOf(tagName) !== -1);
  }
  function tagRank(tagName) {
    const members = tagMembers(tagName);
    let watched = 0;
    let sum = 0;
    let n = 0;
    members.forEach((el) => {
      if (isOn(keysOf(el))) watched++;
      const s = scoreOf(el);
      if (s >= 0) { sum += s; n++; }
    });
    return { watched: watched, avg: n ? sum / n : -1, total: members.length };
  }
  function applySortButtons() {
    document.querySelectorAll("#sort-filter .sort-btn").forEach((b) => {
      const on = b.dataset.sort === sortMode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }
  function applyCategoryOrder() {
    const all = tagButtons.filter((b) => (b.dataset.tag || "all") === "all");
    const rest = tagButtons.filter((b) => (b.dataset.tag || "all") !== "all")
      .map((btn, index) => ({ btn: btn, index: index, rank: tagRank(btn.dataset.tag) }));
    if (sortMode !== "original") {
      rest.sort((a, b) => {
        if (b.rank.watched !== a.rank.watched) return b.rank.watched - a.rank.watched;
        if (b.rank.avg !== a.rank.avg) return b.rank.avg - a.rank.avg;
        return a.index - b.index;
      });
    }
    all.concat(rest.map((row) => row.btn)).forEach((btn) => {
      const rank = tagRank(btn.dataset.tag || "all");
      const prog = btn.querySelector(".prog");
      if (prog) prog.textContent = rank.watched + "/" + rank.total;
      tagNav.appendChild(btn);
    });
  }
  function applyFilmOrder() {
    const rows = originalFilms.map((el, index) => ({ el: el, index: index }));
    if (sortMode !== "original") {
      rows.sort((a, b) => {
        const ds = scoreOf(b.el) - scoreOf(a.el);
        if (ds) return ds;
        return a.index - b.index;
      });
    }
    rows.forEach((row) => listEl.appendChild(row.el));
  }

  function refresh() {
    applyCategoryOrder();
    applyFilmOrder();
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
      const on = box.checked;
      box.checked = !on; // nothing changes until 확인
      const t = el.querySelector("h2.ko");
      window.MovieConfirm.ask(t ? t.textContent.trim() : "이 영화", on).then((ok) => {
        if (ok) setFilm(keys, on);
        else refresh();
      });
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

  films.forEach((el) => {
    const meta = el.querySelector(".meta");
    if (!meta || meta.querySelector(".score")) return;
    const score = scoreOf(el);
    if (score < 0) return;
    const sc = document.createElement("span");
    const estimated = el.dataset.scoreEstimated === "true";
    sc.className = "score" + (estimated ? " estimated" : "");
    const shown = (score / 10).toFixed(1);
    sc.appendChild(document.createTextNode(shown));
    if (estimated) {
      const est = document.createElement("span");
      est.className = "est";
      est.textContent = "추정";
      sc.appendChild(est);
    }
    const bits = ["평가 " + shown + " / 10"];
    if (el.dataset.imdb) {
      bits.push("IMDb " + el.dataset.imdb + (el.dataset.imdbVotes ? " · " + Number(el.dataset.imdbVotes).toLocaleString("en-US") + "표" : ""));
    }
    if (el.dataset.metacritic) bits.push("메타크리틱 " + el.dataset.metacritic);
    if (el.dataset.rt) bits.push("로튼토마토 " + el.dataset.rt + "%");
    if (el.dataset.criticEstimated === "true") bits.push("평론 점수는 추정");
    sc.title = bits.join(" · ");
    meta.insertBefore(sc, meta.firstChild);
  });
  document.querySelectorAll("#sort-filter .sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      sortMode = btn.dataset.sort === "original" ? "original" : "best";
      try { localStorage.setItem(SORT_KEY, sortMode); } catch (e) { /* ignore */ }
      applySortButtons();
      refresh();
    });
  });
  applySortButtons();

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
