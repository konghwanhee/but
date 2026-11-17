# but · 뷰티 카드뉴스 허브

`b   ut` 카드뉴스(뷰티 포인트 · 뷰티 테크 · 데일리 브리핑)를 한곳에서 보고,
문구를 고치고, PNG로 내려받고, 이 저장소에 바로 저장하는 정적 사이트입니다.
빌드 도구·외부 라이브러리 없이 `index.html` 하나로 열립니다.

## 화면

1. **홈 · 챕터별 표지 갤러리** — 상단 필터 `전체 / 뷰티 포인트 / 뷰티 테크 / 데일리 브리핑`,
   각 챕터 안에 카드뉴스가 표지 이미지 + 일자 + 주제 카드로 놓입니다.
2. **상세 · 텍스트 수정** — 카드를 누르면 표지 → (요약) → `1/N`…`N/N` 장표 탭,
   1080×1350 실시간 캔버스, 문구 입력칸(Enter 줄바꿈, 마침표·쉼표 기준 자동 줄바꿈).
   - `현재 장표 PNG` · `전체 장표 PNG` · `JSON 내보내기`
   - `GitHub에 저장`: 저장용 토큰(PAT)을 한 번 연결하면 `data/{id}.json`을 GitHub API로 바로 커밋

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
