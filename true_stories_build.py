#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate true-stories.html from the film records. Not a deploy build step."""
import html
import json
import re
from pathlib import Path

from true_stories_part1 import PART1
from true_stories_part2 import PART2

ROOT = Path(__file__).resolve().parent
FILMS = PART1 + PART2
SITE = "https://movie-checklist-sigma.vercel.app"
TAG_ORDER = ["용기", "가족", "우정", "역경극복", "정의", "희생", "희망", "신념", "집념", "화해"]
KEY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}:[a-z0-9][a-z0-9-]{0,127}$", re.I)


def esc(value):
    return html.escape(str(value), quote=True)


def sentences(text):
    return [p for p in re.split(r"(?<=다\.)\s+", text.strip()) if p.strip()]


def validate():
    if not 60 <= len(FILMS) <= 80:
        raise SystemExit(f"film count {len(FILMS)} outside 60-80")
    ids = [f["id"] for f in FILMS]
    if len(ids) != len(set(ids)):
        raise SystemExit("duplicate film id")
    raw = (ROOT / "movies-data.js").read_text(encoding="utf-8")
    raw = raw.replace("window.MOVIE_CHECKLIST_DATA = ", "", 1).strip().rstrip(";")
    data = json.loads(raw)
    known = {f"{a['id']}:{m['id']}" for a in data["actors"] for m in a["movies"]}
    used_tags = set()
    for film in FILMS:
        for field in ("ko", "en", "basis", "director", "cast", "genre", "country", "one", "plot", "real", "lesson"):
            if not str(film.get(field, "")).strip():
                raise SystemExit(f"missing {field} on {film.get('id')}")
        if film["basis"] not in ("실화", "실화 바탕"):
            raise SystemExit(f"bad basis {film['id']}")
        if film.get("country") == "한국" or "한국" in film["ko"]:
            raise SystemExit(f"korean film {film['id']}")
        if len(sentences(film["plot"])) < 3:
            raise SystemExit(f"plot too short {film['id']}: {film['plot']}")
        if len(sentences(film["real"])) < 2:
            raise SystemExit(f"real too short {film['id']}")
        if not film.get("tags"):
            raise SystemExit(f"no tags {film['id']}")
        used_tags.update(film["tags"])
        links = film.get("links") or []
        storage = links or [f"true:{film['id']}"]
        for key in storage:
            if not KEY_RE.match(key):
                raise SystemExit(f"bad key {key}")
            if links and key not in known:
                raise SystemExit(f"link not in actor data: {key}")
        blob = film["ko"] + film["en"] + film["plot"] + film["real"]
        if "죽은 시인의 사회" in blob or "Dead Poets" in blob:
            raise SystemExit("excluded film slipped in")
    unknown = used_tags - set(TAG_ORDER)
    if unknown:
        raise SystemExit(f"unexpected tags {unknown}")
    missing = [t for t in TAG_ORDER if t not in used_tags]
    if missing:
        raise SystemExit(f"unused tags {missing}")


def film_html(film, index):
    links = film.get("links") or []
    storage = links or [f"true:{film['id']}"]
    basis_class = "basis loose" if film["basis"] == "실화 바탕" else "basis"
    runtime = f"{film['runtime']}분 · " if film.get("runtime") else ""
    tags = "".join(f'<span class="tagpill">#{esc(tag)}</span>' for tag in film["tags"])
    shared = ""
    if links:
        shared = '<p class="shared-note">이 작품은 배우별 목록과 같은 시청 체크로 연결되어 있습니다.</p>'
    search = " ".join([
        film["ko"], film["en"], str(film["year"]), film["one"], film["director"], film["cast"],
        " ".join(film["tags"]), film["basis"],
    ]).lower()
    return f"""
<article class="movie" id="film-{esc(film['id'])}" data-id="{esc(film['id'])}" data-keys="{esc(','.join(storage))}" data-tags="{esc(' '.join(film['tags']))}" data-search="{esc(search)}">
  <input type="checkbox" aria-label="{esc(film['ko'])} 시청 여부" />
  <details>
    <summary>
      <h2 class="ko">{esc(film['ko'])}</h2>
      <span class="en">{esc(film['en'])}</span>
      <div class="meta">
        <span class="year">{film['year']}</span>
        <span class="{basis_class}">{esc(film['basis'])}</span>
        <span class="genre">{esc(film['country'])}</span>
      </div>
      <span class="oneline">{esc(film['one'])}</span>
      <div class="tags">{tags}</div>
    </summary>
    <div class="detail">
      <p class="factline"><b>감독</b> {esc(film['director'])}<br />
      <b>주연</b> {esc(film['cast'])}<br />
      <b>정보</b> {esc(runtime + film['genre'])}</p>
      {shared}
      <div><h3>줄거리</h3><p>{esc(film['plot'])}</p></div>
      <div><h3>실제 이야기</h3><p>{esc(film['real'])}</p></div>
      <div><h3>교훈</h3><p>{esc(film['lesson'])}</p></div>
    </div>
  </details>
</article>"""


def json_ld():
    elements = []
    for i, film in enumerate(FILMS, start=1):
        movie = {
            "@type": "Movie",
            "name": film["ko"],
            "alternateName": film["en"],
            "datePublished": str(film["year"]),
            "director": [{"@type": "Person", "name": name.strip()} for name in film["director"].split(",")],
            "actor": [{"@type": "Person", "name": name.strip()} for name in film["cast"].split(",")],
            "genre": film["genre"],
            "description": film["one"],
            "countryOfOrigin": film["country"],
            "inLanguage": "ko",
        }
        if film.get("runtime"):
            movie["duration"] = f"PT{int(film['runtime'])}M"
        elements.append({"@type": "ListItem", "position": i, "item": movie})
    payload = {
        "@context": "https://schema.org",
        "@type": "ItemList",
        "name": "실화 영화 체크리스트",
        "description": "외국 실화 영화를 감동과 교훈이 큰 순서로 모은 목록",
        "numberOfItems": len(FILMS),
        "itemListOrder": "https://schema.org/ItemListOrderAscending",
        "itemListElement": elements,
    }
    return json.dumps(payload, ensure_ascii=False, indent=2)


def tag_buttons():
    counts = {tag: 0 for tag in TAG_ORDER}
    for film in FILMS:
        for tag in film["tags"]:
            counts[tag] += 1
    buttons = [
        f'<button type="button" class="actor-btn tag-btn active" data-tag="all"><span class="name">전체</span><span class="prog">{len(FILMS)}편</span></button>'
    ]
    for tag in TAG_ORDER:
        buttons.append(
            f'<button type="button" class="actor-btn tag-btn" data-tag="{esc(tag)}"><span class="name">#{esc(tag)}</span><span class="prog">{counts[tag]}편</span></button>'
        )
    return "\n".join(buttons)


def render():
    validate()
    n = len(FILMS)
    films_html = "\n".join(film_html(film, i) for i, film in enumerate(FILMS, start=1))
    page = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0a0a0a" />
<meta name="description" content="외국 실화 영화 {n}편을 감동과 교훈이 큰 순서로 모았습니다. 쉰들러 리스트, 행복을 찾아서, 라이언처럼 잘 알려진 작품을 실화와 실화 바탕으로 구분하고, 본 영화를 체크해 기기 간에 동기화할 수 있습니다." />
<link rel="canonical" href="{SITE}/true-stories" />
<meta property="og:type" content="website" />
<meta property="og:locale" content="ko_KR" />
<meta property="og:site_name" content="영화봇" />
<meta property="og:title" content="실화 영화 체크리스트 · 영화봇" />
<meta property="og:description" content="외국 실화 영화 {n}편. 실화와 실화 바탕을 구분해 보고, 시청 체크를 동기화 코드로 이어 가세요." />
<meta property="og:url" content="{SITE}/true-stories" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="실화 영화 체크리스트 · 영화봇" />
<meta name="twitter:description" content="외국 실화 영화 {n}편을 감동과 교훈이 큰 순서로 모은 체크리스트." />
<title>실화 영화 체크리스트 · 영화봇</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;700&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
<link rel="stylesheet" href="/styles.css" />
<script type="application/ld+json">
{json_ld()}
</script>
</head>
<body>
<div class="app">
  <aside class="sidebar" id="sidebar" aria-label="교훈 태그">
    <div class="sidebar-head">
      <p class="eyebrow">영화봇</p>
      <p class="sidebar-title">실화 영화</p>
      <p class="sub" id="sidebar-total">외국 실화 영화 {n}편</p>
    </div>
    <nav class="actor-nav" id="tag-nav">
      {tag_buttons()}
    </nav>
  </aside>
  <div class="backdrop" id="backdrop"></div>
  <main class="main">
    <nav class="view-tabs" aria-label="목록 전환">
      <a class="view-tab" href="/">배우별</a>
      <a class="view-tab active" href="/true-stories" aria-current="page">실화 영화</a>
    </nav>
    <header class="page-head">
      <h1>실화 영화</h1>
      <p class="intro">외국 영화 {n}편입니다. 널리 알려졌고, 마음이 움직이며 교훈이 분명한 작품을 앞에 두었습니다. 실제 사건과 크게 어긋나면 실화 바탕이라고 적었고, 허구이거나 근거가 흐린 작품은 빼 두었습니다. 제목을 누르면 정보가 열리고, 체크는 시청 표시입니다.</p>
    </header>
    <div class="progress-panel">
      <div class="progress-top">
        <span class="progress-label"><strong id="progress-text">0/{n} 봤어요</strong></span>
        <span class="progress-pct" id="pct">0%</span>
      </div>
      <div class="bar"><div class="bar-fill" id="bar-fill"></div></div>
    </div>
    <section class="sync-panel" id="sync-panel" aria-label="기기 간 동기화">
      <div class="sync-row">
        <span class="sync-label">동기화 코드</span>
        <code class="sync-code" id="sync-code">—</code>
        <button type="button" class="btn small" id="sync-copy">복사</button>
        <button type="button" class="btn small" id="sync-link-toggle">다른 기기 연결</button>
        <span class="sync-status" id="sync-status" role="status" aria-live="polite">—</span>
      </div>
      <p class="sync-help">시청 체크는 배우별 목록과 같은 동기화 코드로 저장됩니다. 이미 배우 목록에 있는 작품은 그 체크와 함께 움직입니다.</p>
      <div class="sync-link" id="sync-link">
        <input type="text" id="sync-input" placeholder="기존 동기화 코드 입력" autocomplete="off" autocapitalize="characters" spellcheck="false" inputmode="latin" enterkeyhint="go" />
        <button type="button" class="btn" id="sync-connect">연결</button>
      </div>
      <p class="sync-msg" id="sync-msg"></p>
    </section>
    <div class="controls">
      <div class="search">
        <input type="search" id="search" placeholder="제목 검색 (한글/영문)…" autocomplete="off" enterkeyhint="search" />
      </div>
      <div class="filter-group" role="group" aria-label="시청 필터">
        <button type="button" class="filter-btn active" id="show-all" aria-pressed="true">전체</button>
        <button type="button" class="filter-btn" id="unwatched-only" aria-pressed="false">안 본 영화만</button>
      </div>
    </div>
    <div id="film-list" class="list">
{films_html}
    </div>
    <p class="empty" id="empty">검색·필터 결과가 없습니다.</p>
    <aside class="cpb" aria-label="광고">
      <a class="cpb-link" href="https://link.coupang.com/a/hsdzLh1vB6" target="_blank" rel="sponsored noopener noreferrer nofollow">
        <span class="cpb-label">광고</span>
        <span class="cpb-copy">팝콘은 체크리스트의 숨은 필수 항목이죠 · 쿠팡에서 챙기기</span>
        <span class="cpb-arrow" aria-hidden="true">→</span>
      </a>
      <p class="cpb-note">이 게시물은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.</p>
    </aside>
    <footer>
      외국 실화 영화 · 포스터 없이 텍스트만 정리했습니다<br />
      시청 체크는 동기화 코드로 서버에 저장되어 배우별 목록과 이어집니다<br />
      <a href="/">배우별 체크리스트로 돌아가기</a>
    </footer>
  </main>
</div>
<button type="button" class="menu-toggle" id="menu-toggle" aria-label="교훈 태그 열기">주제 선택</button>
<script src="/true-stories.js"></script>
</body>
</html>
"""
    (ROOT / "true-stories.html").write_text(page, encoding="utf-8")
    print(f"wrote true-stories.html films={n}")


if __name__ == "__main__":
    render()
