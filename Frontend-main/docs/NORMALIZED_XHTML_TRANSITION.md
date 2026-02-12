# Mini 정규화 프로젝트 전환 가이드 (단계별)

현재 epub.js 기반 CFI 뷰어 → 정규화된 combined.xhtml + 앵커 기반 뷰어로 전환하는 단계별 과정.

---

## 의사결정 확정

| 항목 | 결정 |
|------|------|
| 정규화 범위 | **모든 책 정규화** (epub.js 제거, XhtmlViewer만 사용) |
| 뷰어 형태 | **페이지형** (paginated) |
| combined.xhtml 소스 | **현재**: 직접 제공 / **이후**: 서버에서 fetch |

---

## Phase 0: 현황 정리

### 현재 구조 (AS-IS)
- **소스**: EPUB 파일 (IndexedDB ArrayBuffer) → epub.js `ePub(buffer)`
- **위치 표현**: CFI (`epubcfi(...)`) + locations
- **진도**: `{ bookId, chapterIdx, eventIdx, cfi }` → `POST /api/progress`
- **이벤트 매칭**: manifest + chapter txt + CFI → chars 계산

### 목표 구조 (TO-BE)
- **소스**: `combined.xhtml` (현재 직접 제공 → 이후 서버 fetch)
- **위치 표현**: 앵커 `{ start: { chapterIndex, blockIndex, offset }, end: {...} }`
- **진도**: 앵커 → `POST /api/progress` → 백엔드가 meta.json으로 txt 좌표 변환
- **이벤트**: txt 기반 (AI 산출) → txt start/end ↔ 앵커 변환은 백엔드 담당

---

## Phase 1: 데이터 소스 및 인프라 준비 ✅

### 1.1 combined.xhtml 확보 경로
- **현재**: 사용자가 직접 제공 (로컬 파일/URL 등)
  - `loadCombinedXhtml(bookId, book)` → `utils/normalizedContent/combinedXhtmlLoader.js`
  - 우선순위: `book.combinedXhtmlContent` > `book.combinedXhtmlUrl` > `public/books/{bookId}/combined.xhtml`
- **이후**: `GET /api/books/{bookId}/combined` (서버 연동 시 추가)
- [ ] 이후 서버 연동 시 URL 규칙 확정

### 1.2 meta.json 로드 API
- [x] `GET /api/books/{bookId}/meta` → `api.getBookMeta(bookId)`
- [x] `loadBookMeta(bookId)` → `utils/normalizedContent/metaLoader.js` (API + `public/books/{bookId}/meta.json` fallback)
- [x] meta.json 구조: `{ chapters: [{ chapterIndex, paragraphStarts, paragraphLengths, totalCodePoints }] }`

### Phase 1 사용법
```js
import { loadCombinedXhtml, loadBookMeta } from '../utils/normalizedContent';

// combined.xhtml 로드 (우선순위: book.combinedXhtmlContent > book.combinedXhtmlUrl > public/books/{bookId}/combined.xhtml)
const xhtml = await loadCombinedXhtml(bookId, book);

// meta.json 로드 (API → public/books/{bookId}/meta.json fallback)
const meta = await loadBookMeta(bookId);
// meta.chapters[].paragraphStarts, paragraphLengths, totalCodePoints
```

개발 시: `public/books/{bookId}/combined.xhtml`, `public/books/{bookId}/meta.json` 배치

### Library 표시
- `public/books/books.json`에 책 목록 정의 → 라이브러리에서 표시
- 형식: `[ { "id": "Frankenstein", "title": "Frankenstein", "author": "Mary Shelley" }, ... ]`

---

## Phase 2: XHTML 뷰어 컴포넌트 구현 ✅

### 2.1 XHTML 로더
- [x] `loadCombinedXhtml` → XHTML 문자열
- [x] DOMParser로 파싱 → body innerHTML + style 추출
- [x] `dangerouslySetInnerHTML`로 렌더, `data-chapter-index`, `data-block-index` 보존

### 2.2 페이지형 렌더링 (paginated)
- [x] CSS `column-width` (single: 100%, double: 50%)
- [x] `column-fill: auto`, `column-gap: 24px`
- [x] prev/next → `scrollLeft` ± column width

### 2.3 블록 감지 (IntersectionObserver)
- [x] `[data-chapter-index][data-block-index]` Observer
- [x] 가장 많이 보이는 블록 = 현재 블록 (300ms 폴링)
- [ ] 블록 내 offset (선택, Phase 3에서 필요 시 추가)

### 2.4 앵커 생성
- [x] `{ start: { chapterIndex, blockIndex, offset: 0 }, end: {...} }`
- [x] 0-based, 블록 시작 offset 0

### Phase 2 사용법
- `/user/viewer/Frankenstein` 접속 (bookId가 비숫자면 XhtmlViewer 사용)
- `public/books/Frankenstein/combined.xhtml`, `meta.json` 필요

---

## Phase 3: 진도 저장/복원 전환 ✅

### 3.1 progress API 스키마
- [x] `{ bookId, anchor: { start, end } }` 저장 (progressCache)
- [ ] 백엔드 `POST /api/progress` anchor 수신 시 meta.json으로 txt 변환 (백엔드 작업)

### 3.2 useProgressAutoSave 수정
- [x] `currentEvent?.anchor` → `anchor` 필드로 저장

### 3.3 progressCache 확장
- [x] `progress.anchor` 필드 추가

### 3.4 진도 복원
- [x] `getProgressFromCache(bookId)` → `cachedProgress?.anchor`
- [x] `initialAnchor` → XhtmlViewer, `scrollIntoView`로 해당 블록 이동

---

## Phase 4: 이벤트/그래프 연동
- [ ] manifest의 event는 txt 기준 start/end 사용
- [ ] 백엔드가 txt 좌표로 변환·저장 → 프론트는 앵커만 전송

---

## Phase 5: 세부 구현 체크리스트

### 5.1 앵커 생성 시
- [ ] chapterIndex, blockIndex: 0-based
- [ ] offset: 블록 내 코드포인트 (`[...blockText].length` 등)
- [ ] 블록 시작: offset = 0

### 5.2 코드포인트 계산
```js
// JavaScript
const chars = [...chapterText];
const segment = chars.slice(start, end).join('');
```

### 5.3 combined.xhtml 구조 가정
```html
<h2 data-chapter-index="6" data-block-index="0">CHAPTER 1.</h2>
<p data-chapter-index="6" data-block-index="1">Call me Ishmael.</p>
```

### 5.4 meta.json 변환 (백엔드 담당, 참고용)
```
txtStart = paragraphStarts[blockIndex] + offset
txtEnd   = paragraphStarts[end.blockIndex] + end.offset
```

---

## Phase 6: 테스트 및 검증

### 6.1 단위 테스트
- [ ] 앵커 생성: data 속성 → `{ chapterIndex, blockIndex, offset }`
- [ ] offset 계산: 코드포인트 기준 검증
- [ ] meta 기반 txt 변환 (프론트에서 meta 쓰는 경우)

### 6.2 통합 테스트
- [ ] combined.xhtml 로드 → 블록 감지 → 앵커 생성 → POST /progress
- [ ] 진도 복원 → 해당 페이지/블록으로 이동

### 6.3 계약 검증
- [ ] 앵커 포맷: `{ chapterIndex, blockIndex, offset }`
- [ ] txt 변환 공식: `paragraphStarts[blockIndex] + offset`
- [ ] 좌표 단위: 코드포인트

---

## 구현 우선순위

| 순서 | 작업 | 의존성 |
|------|------|--------|
| 1 | XhtmlViewer 골격 (로드+렌더) + combined.xhtml 직접 제공 | - |
| 2 | 페이지형 렌더링 (CSS columns) | 1 |
| 3 | IntersectionObserver 블록 감지 + 앵커 생성 | 2 |
| 4 | progress API anchor 스키마 + useProgressAutoSave | 백엔드 |
| 5 | 진도 복원 (anchor → 페이지 이동) | 3, 4 |
| 6 | 이벤트/그래프 연동 | 4 |
| 7 | combined.xhtml 서버 fetch 전환 | 백엔드 준비 시 |
