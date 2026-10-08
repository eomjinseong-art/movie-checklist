# 영화봇 · 배우·감독별 영화 체크리스트

배우별 장편 출연작 · 감독별 장편 연출작 시청 체크 (모바일 우선 · 기기 간 서버 동기화)

**배우 19명** (818편) · **감독 1명** (30편) · 총 **848편**

| 배우 | EN | 편수 |
|---|---|---:|
| 덴젤 워싱턴 | Denzel Washington | 52 |
| 맷 데이먼 | Matt Damon | 48 |
| 다니엘 크레이그 | Daniel Craig | 34 |
| 톰 크루즈 | Tom Cruise | 45 |
| 러셀 크로우 | Russell Crowe | 58 |
| 레오나르도 디카프리오 | Leonardo DiCaprio | 28 |
| 매튜 맥커너히 | Matthew McConaughey | 41 |
| 톰 하디 | Tom Hardy | 28 |
| 제라드 버틀러 | Gerard Butler | 37 |
| 샤를리즈 테론 | Charlize Theron | 42 |
| 레아 세이두 | Léa Seydoux | 29 |
| 앤 해서웨이 | Anne Hathaway | 33 |
| 마고 로비 | Margot Robbie | 22 |
| 키아누 리브스 | Keanu Reeves | 56 |
| 휴 잭맨 | Hugh Jackman | 33 |
| 드웨인 존슨 | Dwayne Johnson | 41 |
| 리암 니슨 | Liam Neeson | 90 |
| 채드윅 보즈먼 | Chadwick Boseman | 15 |
| 모건 프리먼 | Morgan Freeman | 86 |

| 감독 | EN | 편수 |
|---|---|---:|
| 리들리 스콧 | Ridley Scott | 30 |

- 감독 목록은 `movies-data.js`의 `directors` 배열(배우와 같은 `{id, nameKo, nameEn, movies}` 구조)에 있고, 사이드바·전체 현황에 '감독' 섹션으로 표시됩니다
- 체크 키는 배우와 같은 `<목록id>:<영화id>` 형식(예: `ridley:alien`)이라 진행률·동기화·저장된 체크와 그대로 호환됩니다

## 사용
- `index.html` 을 브라우저에서 열거나 Vercel 배포 URL로 접속
- 목록 보기는 로그인 없이 누구나 가능 · 체크는 기본적으로 이 기기 `localStorage`에 저장
- **비번으로 저장**: 기기마다 비밀번호를 한 번 입력하면(약 400일 유지되는 httpOnly 쿠키) 체크가 서버(Upstash Redis)의 **목록 하나**에 저장되고 모든 기기가 같은 목록을 봄
  - 기기 첫 로그인 때 그 기기의 체크(`movie-checklist-items-v2`의 v:1 + 구버전 `movie-checklist-v1`)와 예전 동기화 코드(`movie-checklist-sync-code`)의 체크를 **합집합으로만** 서버에 합침(아무것도 지우지 않음) → `movie-checklist-imported-v1` = `1`, 원래 로컬 값은 `movie-checklist-pre-shared-backup-v1`에 보관
  - 이후 병합 규칙: 영화별 마지막 변경 우선(체크·해제 모두 전파)
- 로직: `sync-client.js` (두 페이지 공용), 서버: `api/login.js` · `api/logout.js` · `api/shared.js` · `api/_lib/store.js`

## API
- `POST /api/login {password}` → 맞으면 `mc_session` 쿠키(HttpOnly·Secure·SameSite=Lax·400일), 틀리면 401 · IP당 15분에 10회 실패 시 429
- `POST /api/logout` → 쿠키 삭제
- `GET /api/shared` (로그인 필요, 아니면 401) → `{ items, updatedAt, checked, now }`
- `POST /api/shared {items}` → 마지막 변경 우선 병합 · `{mode:"import", items, legacyCode}` → 합집합만(첫 로그인)
- Redis 키
  - `movie-checklist:shared:v1` — 공유 목록 `{ items: {"<목록id>:<영화id>": {v:0|1, t:ms}}, updatedAt }`
  - `movie-checklist:shared:v1:history` — 매 쓰기 전 이전 값(최근 50개, LPUSH/LTRIM)
  - `movie-checklist:sync:<CODE>` — 예전 동기화 코드별 기록(백업으로 그대로 보존, 읽기만 함). 예전 페이지용 `GET/POST /api/sync`도 그대로 동작
  - `movie-checklist:loginfail:<ip>` — 로그인 실패 횟수(15분 만료)
- 환경 변수: `KV_REST_API_URL`, `KV_REST_API_TOKEN` (Upstash), `MOVIE_CHECKLIST_PASSWORD_HASH` (Sensitive, `scrypt$N$r$p$salt$hash`), `MOVIE_CHECKLIST_SESSION_SECRET` (Sensitive, 바꾸면 모든 기기 로그아웃)

## 규칙
- 배우: 장편 출연(극장·주요 스트리밍) · 감독: 장편 연출작
- 제작만 / 미개봉 / TV 시리즈 / 다큐 나레이션 / 사소한 카메오 / (감독) 단편·옴니버스 단편 제외
- 출처: Wikipedia filmography · 한국 제목은 통용 표기(씨네21 등)

## 불확실 제목
- Léa Seydoux: The Beautiful Person / Belle Épine — 한국 개봉명 불확실
- Gerard Butler: Butterfly on a Wheel — 한국명 '샤터드'로도 표기
- Russell Crowe: Prisoners of the Sun — 일명 Blood Oath
- Russell Crowe: The Weight — 한국 개봉명 미확인 (더 웨이트)
- Russell Crowe: Gladiator II — 아카이브 영상만 사용되어 출연작에서 제외 (신규 촬영 없음)
- Matt Damon: Glory Daze 등 초기 소작 일부 제외
- Keanu Reeves: Generation Um... / Exposed 등 일부 저예산작 제외 또는 제한 포함
- Hugh Jackman: Erskineville Kings — 한국 개봉명 불확실
- Dwayne Johnson: Fast X 등 카메오·목소리 카메오, 다큐, 단편, DTV(Empire State), 미개봉작(Jumanji: Open World) 제외
- Liam Neeson: Pilgrim's Progress·Christiana(70년대 종교 소품), 포뇨 영어 더빙, 카메오, 내레이션, 미개봉작(The Mongoose 2026.10.30 · 4 Kids Walk Into a Bank) 제외 · Lamb/The Innocent/Wildcat 한국 개봉명 불확실
- Chadwick Boseman: 단편, 블랙 팬서: 와칸다 포에버(아카이브 영상만 사용) 제외 · The Kill Hole 한국 개봉명 불확실 (킬 홀)
- Morgan Freeman: 1964~68 무크레딧 단역·70년대 소품(Who Says I Can't Ride a Rainbow!, Blade), TV, 다큐·내레이션, 무크레딧(Brian Banks), 본인 카메오(커밍 2 아메리카), 제작만, DTV(Guilty by Association), 미개봉작(Rode to Ruin 2027) 제외 · Harry & Son/That Was Then... This Is Now/Levity/The Minute You Wake Up Dead/My Dead Friend Zoe 한국 개봉명 불확실 · Gone Baby Gone은 국내 DVD 제목(가라, 아이야, 가라) 기준
- Ridley Scott (감독): 단편(Boy and Bicycle 등)·옴니버스 보이지 않는 아이들의 단편·제작만·TV·미개봉작(Treasure Island 2027) 제외 · 블랙 호크 다운은 2001년(미국 첫 개봉) 기준, Wikipedia 표에는 2002년
