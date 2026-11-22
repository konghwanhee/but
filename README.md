# but · 뷰티 카드뉴스 허브

`b   ut` 카드뉴스(뷰티 포인트 · 뷰티 테크 · 뷰티 브리핑 · 뷰티 픽)를 한곳에서 보고,
문구를 고치고, PNG로 내려받고, 이 저장소에 바로 저장하는 정적 사이트입니다.
빌드 도구·외부 라이브러리 없이 `index.html` 하나로 열립니다.

## 화면

1. **홈 · 챕터별 표지 갤러리** — 상단 필터 `전체 / 뷰티 포인트 / 뷰티 테크 / 뷰티 브리핑 / 뷰티 픽`,
   각 챕터 안에 카드뉴스가 표지 이미지 + 일자 + 주제 카드로 놓입니다(최신순 — 날짜 내림차순, 같은 날은 호수 내림차순).
   - **모바일(≤720px)**: 챕터당 4개(2열 × 2행)만 보이고, 아래에 `1 2 3 …` 페이지네이션.
     5페이지를 넘으면 `‹ ›`(앞/뒤 페이지)와 `« »`(처음/끝 페이지)가 함께 나옵니다.
   - **데스크톱(≥721px)**: 챕터당 한 줄에 6개, 좌우로 넘겨 보는 가로 스크롤. 챕터 제목 옆 `‹ ›` 화살표로
     한 번에 6개씩 넘기며, 카드가 6개 이하면 화살표는 나오지 않습니다. 창 크기를 바꾸면 두 레이아웃이 자동으로 전환됩니다.
2. **상세 · 텍스트 수정** — 카드를 누르면 표지 → (요약) → `1/N`…`N/N` 장표 탭,
   1080×1350 실시간 캔버스, 문구 입력칸(Enter 줄바꿈, 마침표·쉼표 기준 자동 줄바꿈).
   - `현재 장표 PNG` · `전체 장표 PNG` · `JSON 내보내기`
   - `GitHub에 저장`: 저장용 토큰(PAT)을 한 번 연결하면 `data/{id}.json`을 GitHub API로 바로 커밋
   - `결재` (**4개 챕터 정식 호 모두** 노출 · TEST 항목은 버튼이 막힘):
     2차 확인창(취소 / 결재 확정)에서 확정해야 커밋됩니다. `data/{id}.json`·`data/manifest.json`에
     `approved`(결재 여부) · `approvedAt`(결재 시각) · `scheduledUploadAt`(업로드 예정 — 결재 시점 기준
     다음 업로드 시각, 포인트·테크 08:00 / 브리핑 18:00 / 픽은 결재한 날 정각) · `publishedAt`(업로드 완료, 없으면 `null`)를 기록합니다.
     버튼은 `결재됨 ✓`(딥 버건디)로 바뀌고, 편집 화면 상단·홈 카드에는 `결재됨 · 예정 MM.DD HH:00`,
     `publishedAt`이 있으면 `업로드 완료 · YYYY.MM.DD`로 표시됩니다. 다시 누르면 확인 후 결재 취소.
     토큰이 없으면 안내와 함께 연결 창이 열립니다. `scripts/sync_to_github.py` 재동기화도 이 네 값을 보존합니다.

## 구조

```
index.html / style.css / app.js   사이트 (정적)
data/manifest.json                전체 카드뉴스 목록
data/{id}.json                    카드뉴스 원본 JSON (이미지 경로 assets/…)
assets/                           카드뉴스가 실제로 쓰는 이미지·로고·웹폰트
assets/_sources.json              자산 ↔ 원본 소스 경로·해시 (동기화용)
covers/{id}-cover.png             홈 갤러리 표지 썸네일
```

## 새 카드뉴스 올리기

워크스페이스(피클) 쪽에서:

```bash
# scripts/content/ 에 새 JSON 을 만들고, scripts/cardnews-decks.json 에 한 줄 추가한 뒤
python3 scripts/sync_to_github.py
```

스크립트가 하는 일: `git pull --rebase` → GitHub에서 직접 고친 `data/*.json`이 있으면
워크스페이스(`scripts/content/`)로 먼저 가져오기 → 표지 썸네일 렌더 → 이미지 중복 제거·용량 최적화 →
`data/*.json`·`data/manifest.json` 갱신 → `commit && push`.

## 목록 제목 = 표지 헤드라인

홈 갤러리 카드와 상세 화면 상단의 제목은 `data/manifest.json` 의 `title` 입니다.
편집 화면에서 **표지 헤드라인**(`cover.headline`)을 고쳐 `GitHub에 저장`하면
`data/{id}.json` 과 함께 `data/manifest.json` 의 `title` 도 표지 헤드라인 한 줄
(줄바꿈은 공백)로 바뀌어 커밋되고, 목록·상세 화면에 바로 반영됩니다.
`scripts/sync_to_github.py` 도 원격에서 가져온 표지 헤드라인을 `scripts/cardnews-decks.json` 의
`title` 에 맞춰 두므로, 다음 동기화가 옛 제목을 다시 쓰지 않습니다.

## 저장용 토큰(PAT)

GitHub → Settings → Developer settings → **Fine-grained tokens** 에서
- Repository access: **Only select repositories → `konghwanhee/but`**
- Permissions → Repository permissions → **Contents: Read and write**

로 만든 토큰을 상세 화면의 `GitHub 연결`에 붙여넣으면 됩니다.
토큰은 그 브라우저(localStorage)에만 남고, 연결하지 않아도 편집·PNG 저장·JSON 내보내기는 모두 동작합니다.

## 로컬에서 열기

```bash
cd but && python3 -m http.server 8000
# http://127.0.0.1:8000/
```

(`file://`로 열면 `data/*.json`을 읽지 못합니다. 서버로 열어 주세요.)
