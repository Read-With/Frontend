# ReadWith Frontend

전자책(EPUB) 뷰어와 등장인물 관계 그래프를 제공하는 스마트 독서 플랫폼 **ReadWith**의 프론트엔드입니다. React + Vite 기반으로 구축되었으며, Vercel에 배포됩니다.

## 주요 기능

- **홈(랜딩)**: Google OAuth 로그인, 로그인 상태면 서재로 자동 이동
- **서재(마이페이지)**: EPUB 파일 업로드 및 보유 도서 목록/정렬/검색
- **뷰어(Viewer)**: XHTML 기반 EPUB 콘텐츠 렌더링, 폰트 크기·줄 간격 등 뷰어 설정, 툴바
- **관계 그래프(Relation Graph)**: Cytoscape 기반 등장인물 관계 시각화, 챕터별 관계 변화 탐색, 인물별 관계 긍정도·연결 분석(레이더 차트)
- **북마크(Bookmarks)**: 도서별 북마크 저장/조회
- **관리자 콘솔(Admin)**: 도서 데이터 관리 대시보드 — 도서 목록, 인물/이벤트/요약/관계 정보 정규화 작업, 작업 로그 모니터링, 데이터 업로드 및 삭제

## 기술 스택

- **프레임워크**: React 19, React Router 7, Vite 6
- **상태/데이터**: TanStack Query (React Query)
- **스타일**: 컴포넌트/페이지별 CSS + `src/index.css` 디자인 토큰 (Tailwind는 base 리셋용으로만 유지)
- **시각화**: Cytoscape.js (+ cose-bilkent), Recharts
- **기타**: Axios, JSZip(EPUB 파싱), isomorphic-dompurify(XHTML sanitize)
- **배포**: Vercel

## 관계 그래프는 무엇을 기반으로 그려지나요?

관계 그래프는 도서 원문을 프론트에서 직접 분석하는 것이 아니라, 백엔드가 미리 분석해 제공하는 두 API 응답을 조합해 그립니다.

1. **매니페스트** (`GET /v2/books/:bookId/manifest`): 인물 목록(이름, 성격 소개, 프로필 이미지, 주요 인물 여부)과 챕터별 이벤트(서사 사건) 순서를 제공 — 그래프 노드의 기본 정보로 사용
2. **관계 델타** (`GET /v2/books/:bookId/relationship-deltas`): 챕터/이벤트 단위로 발생한 인물 간 관계 변화 이벤트 목록. 각 델타는 다음을 포함
   - `nodeWeights`: 해당 이벤트에 등장한 인물과 그 비중(가중치)
   - `items`: 두 인물(`fromCharacterId` ↔ `toCharacterId`) 간 관계 라벨, 긍정도(-1 ~ +1, UI에는 -100% ~ +100%로 표시), 근거 횟수(evidenceCount), 관계 변화 이유(reason)

프론트엔드는 이 델타들을 챕터·이벤트 순서대로 **누적(accumulate)**해(`utils/api/graphApi.js`) 특정 시점까지의 인물·관계 스냅샷을 만들고, 이를 Cytoscape 엘리먼트로 변환해(`utils/graph/graphModel.js`) 렌더링합니다.

- **노드 크기**: 누적된 `nodeWeights`를 전체 노드 중 상대적으로 정규화한 값 (`estimateNodeSizePx`)
- **엣지 색상**: 누적 긍정도(positivity) — 부정적일수록 붉은 계열, 긍정적일수록 초록 계열 (굵기는 긍정도와 무관하며 화면 컨텍스트별 고정값)
- **엣지 툴팁의 타임라인/레이더 차트**: 관계 라벨 변화 이력(labelHistory)을 시간순으로 시각화

조회 범위는 두 가지입니다.
- **매크로(책 범위) 그래프**: 선택한 챕터까지 책 전체를 누적 (`getBookScopeRelationshipGraph`)
- **뷰어(읽는 위치) 그래프**: 현재 읽고 있는 이벤트까지만 누적 (`ensureChapterEventsDiscovered` → `resolveCumulativeGraphForDisplay`)

매니페스트와 그래프 응답은 재요청을 줄이기 위해 로컬(storage/session) 캐시에 저장되어 재사용됩니다. 무효화 조건은 다음과 같습니다(`utils/common/cache/cacheManager.js`).

| 캐시 | TTL | 비고 |
| --- | --- | --- |
| 매니페스트 | 15분 | 인물/챕터 메타데이터 |
| 도서 목록 | 24시간 | 서재 목록 |
| 챕터 이벤트(그래프용) | 24시간 | 관계 델타 discovery 결과 |
| 진행률 / 뷰어 재개 위치 | 3일 | 도서별 읽기 진행률(%)과 뷰어 재개 위치(locator)를 하나의 캐시(`progressCache`)로 관리 |

- 세션(메모리) 캐시는 탭을 닫거나(`beforeunload`) 새로고침하면 초기화되고, storage 캐시는 TTL이 지나면 다음 접근 시 자동 폐기됩니다.
- 그래프 로드 실패 시 재시도 함수(`retryGraph`)로 강제 재조회할 수 있습니다.
- TTL 내에도 최신 관계가 반영되지 않는 것처럼 보일 수 있는데, 이는 의도된 동작(불필요한 API 재호출 방지)입니다.

### 대형 도서에서의 그래프 성능

- 겹침(overlap) 해결 알고리즘은 대상 노드가 **2000개(`MAX_NODES`)를 넘으면 전체를 계산하는 대신, 이동 중인 노드·선택된 노드·그 주변·화면에 보이는 노드 중 일부를 샘플링**해 계산량을 줄입니다(`utils/graph/graphModel.js`).
- 사용자가 필터 단계를 올리면 `filterMainCharacters`가 주요 인물 위주로만 그래프를 표시해 렌더링 대상 노드 수를 직접 줄일 수 있습니다.
- 엣지 툴팁(`UnifiedEdgeTooltip`)은 지연 로딩(`lazy`)되어 실제로 열기 전까지 번들에 포함되지 않습니다.

### 뷰어 분할 그래프 vs 전체 관계도

같은 그래프 컴포넌트를 쓰지만 두 화면은 목적이 다릅니다.

| | 뷰어 분할 그래프 (`GraphSplitArea`, `/user/viewer/:filename`) | 전체 관계도 (`RelationGraphWrapper`, `/user/graph/:filename`) |
| --- | --- | --- |
| 위치 | 뷰어 내부(본문과 분할 또는 확대) | 별도 풀스크린 페이지 |
| 범위 | **현재 읽는 이벤트까지만** 누적 (읽기 진행에 따라 자동 갱신) | **챕터 사이드바**로 원하는 챕터까지 자유 탐색 (책 전체 범위) |
| 챕터 이동 | 불가 — 읽는 위치에 고정 | 가능 — `ChapterSidebar`에서 챕터 선택 |
| 용도 | 읽으면서 지금까지 드러난 관계를 바로 확인 | 책 전체 관계망을 훑어보거나 특정 챕터 시점의 스냅샷 분석 |

## 인증(Auth)

Google OAuth 로그인 후 세션은 다음과 같이 유지됩니다(`utils/security/authTokenStorage.js`, `utils/api/authApi.js`).

- **액세스 토큰**: 메모리 + `sessionStorage`에 저장 (같은 탭 새로고침 시 복원, `localStorage`에는 저장하지 않음)
- **리프레시 토큰**: `localStorage`에 저장 (여러 탭·재방문 시에도 유지)
- **자동 갱신**: 모든 API 요청 전 액세스 토큰 만료가 임박했는지 확인(`isTokenExpiringSoon`)하고, 임박했으면 `POST /api/auth/refresh`로 선제적으로 재발급받습니다(`refreshAccessTokenIfExpiringSoon`). 그럼에도 서버가 401을 반환하면 한 번 더 `refreshToken()`으로 재발급을 시도한 뒤 원래 요청을 재시도합니다(`authorizedFetch`). 리프레시 토큰까지 만료되면 재로그인이 필요합니다.
- 코드 주석에 명시된 한계: 완전한 XSS 방어를 위해서는 httpOnly·Secure 쿠키 기반 세션이 필요하며, 현재는 그 대안으로 저장 위치를 분리(액세스=세션, 리프레시=로컬)한 상태입니다.

## 프로젝트 구조

```
src/
├── App.jsx              # 라우팅 및 최상위 에러 바운더리
├── main.jsx             # 앱 엔트리 포인트
├── pages/                # HomePage, AdminPage, MyPage, BookmarksPage
├── components/
│   ├── auth/             # OAuth 콜백 등 인증 관련 컴포넌트
│   ├── library/           # 서재, 파일 업로드, 도서 상세 모달
│   ├── viewer/             # EPUB 뷰어, 툴바, 설정
│   └── graph/              # 관계 그래프 (Cytoscape 기반)
├── hooks/
│   ├── auth/              # useAuth (로그인 상태·토큰)
│   ├── books/              # 도서 목록 조회/프리페치
│   ├── bookmarks/           # 북마크 CRUD
│   ├── graph/                # 그래프 API 데이터, 뷰 상태, Cytoscape 인스턴스 제어
│   ├── viewer/                # 뷰어 페이지 상태, 읽기 진행률, 뷰어-그래프 연동
│   ├── ui/                     # 툴팁 등 범용 UI 훅
│   └── common/                  # 공용 훅(요청 가드 등)
└── utils/
    ├── api/                # authApi, booksApi, graphApi — 백엔드 HTTP 클라이언트
    ├── security/            # 토큰 저장(authTokenStorage), OAuth 보안(oauthSecurity)
    ├── common/
    │   ├── cache/            # cacheManager, manifestCache, progressCache (TTL 캐시)
    │   ├── urlUtils.js        # 환경 URL·OAuth·에러 로깅
    │   └── valueUtils.js       # 숫자/문자열/locator 공통 유틸
    ├── graph/               # graphCore/graphCy/graphFetch/graphModel — 그래프 데이터·렌더링 로직
    ├── viewer/               # viewerCore/viewerGraph/viewerLocator/viewerSession
    ├── library/              # 서재/EPUB 업로드 유틸
    ├── bookmarks/             # 북마크 유틸
    └── styles/                # 그래프 스타일시트, 색상 등
```

## 라우트

| 경로 | 설명 | 인증 필요 |
| --- | --- | --- |
| `/` | 홈(랜딩/로그인) | - |
| `/auth/callback` | OAuth 콜백 처리 | - |
| `/admin` | 관리자 콘솔(도서 데이터 관리) | O |
| `/mypage` | 서재(마이페이지) | O |
| `/user/viewer/:filename/*` | EPUB 뷰어 | O |
| `/user/viewer/:filename/bookmarks` | 북마크 페이지 | O |
| `/user/graph/:filename` | 관계 그래프 | O |

## 시작하기

### 요구 사항

- Node.js 및 npm

### 설치

```bash
npm install
```

### 환경 변수

`.env.example`을 참고해 `.env` 파일을 생성합니다. 실제 시크릿 값은 커밋하지 않습니다.

```bash
cp .env.example .env
```

| 변수 | 필수 | 기본값(미설정 시) | 설명 |
| --- | --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | **필수** | 없음 — 미설정 시 Google 로그인 버튼 동작 안 함 | Google OAuth 클라이언트 ID |
| `VITE_API_BASE_URL` | 선택 | 프로덕션 빌드: `https://readwith-be.onrender.com` / `npm run dev`: 빈 값(Vite 프록시로 요청) | 백엔드 API 베이스 URL. 예: `https://api.readwith.cloud` |
| `VITE_DEV_PROXY_TARGET` | 선택 | `http://read-with-dev-env.eba-wuzcb2s6.ap-northeast-2.elasticbeanstalk.com` | `npm run dev` 프록시 대상 서버(`VITE_API_BASE_URL`보다 우선) |
| `VITE_CDN_BASE_URL` | 선택 | `https://cdn.readwith.cloud` | 정적 자산 CDN 베이스 URL |
| `VITE_APP_ORIGIN` | 선택 | 런타임에 `window.location.origin` 사용, 서버 렌더 등 window 없는 상황엔 `https://readwith-frontend.vercel.app` | 앱 자체 origin(OAuth 리다이렉트 계산 등에 사용) |
| `VITE_GOOGLE_REDIRECT_URI` | 선택 | 미설정 시 `{현재 origin}/auth/callback`을 자동 생성 | Google OAuth 콜백 URI를 명시적으로 고정하고 싶을 때만 설정 |

`.env.example`에는 없지만 코드에서 참조하는 선택 변수도 있습니다: `VITE_POST_LOGIN_HOME_URL`(로그인 후 이동할 홈 URL, 미설정 시 `VITE_APP_ORIGIN` → 현재 origin 순으로 fallback).

### 개발 서버 실행

```bash
npm run dev
```

### 빌드 / 미리보기

```bash
npm run build
npm run preview
```

### 기타 스크립트

```bash
npm run lint        # ESLint 검사
npm run clean       # Vite/캐시 정리
npm run dev:clean   # 캐시 정리 후 개발 서버 실행
```

## 기여 가이드

현재 저장소의 git 히스토리에서 관찰되는 관례는 다음과 같습니다.

- **커밋 메시지**: `<타입> : <설명>` 형식 — 예: `fix : AdminPage.jsx 중복 컴포넌트 제거로 빌드 오류 해결`, `refactor : viewer 개선`. 타입은 `fix`, `refactor` 등이 사용됨
- **워크플로**: GitHub([Read-With/Frontend](https://github.com/Read-With/Frontend))에서 기능 브랜치를 만들어 PR로 `main`에 병합
- JS/JSX 코드 스타일은 `eslint.config.js`로 강제되며, PR 전 `npm run lint`(ESLint)로 확인하는 것을 권장합니다.
- **prop-types**: TS 전환 계획이 없으므로, props를 받는 컴포넌트는 정의 바로 아래에 `Component.propTypes = {...}`를 둡니다.
- **스타일 규칙 (새 코드부터 적용)**:
  - 스타일은 컴포넌트/페이지 옆 CSS 파일에 클래스로 작성합니다. 새 Tailwind 유틸리티 클래스는 쓰지 않습니다.
  - 색·폰트·반경 등은 `src/index.css`의 `:root` 토큰(`var(--brand-*)` 등)을 사용하고 hex를 새로 하드코딩하지 않습니다.
  - 인라인 `style={{}}`은 런타임 계산 값(예: `--pos-color`, `left: pct%`)에만 씁니다.
  - 기존 Tailwind 사용처 중 `App.jsx` 로딩 스피너는 해당 파일을 수정할 때 CSS로 옮깁니다. `AdminPage.jsx`는 이 규칙에서 제외하며 수정하지 않습니다.

## 브라우저 지원 & 접근성

- **빌드 타겟**: `vite.config.js`에서 `build.target: 'esnext'`로 설정되어 있어 트랜스파일/폴리필 없이 최신 문법을 그대로 사용합니다. **최근 버전의 Chrome/Edge/Firefox/Safari 같은 evergreen 브라우저**를 기준으로 합니다.
- **접근성**: 그래프 캔버스에 키보드 내비게이션(`useGraphCanvasKeyboard`)과 스크린리더용 `aria-live` 상태 알림(`GraphA11yStatus`)이 구현되어 있고, 코드 전반에 `aria-*`/`role` 속성이 다수 적용되어 있습니다(모달의 포커스 트랩용 `FOCUSABLE_SELECTOR` 등).

## 배포

`vercel.json`을 통해 Vercel에 배포됩니다. `/public/*` 경로는 CDN(`cdn.readwith.cloud`)으로 리라이트되고, 그 외 경로는 SPA 라우팅을 위해 `index.html`로 리라이트됩니다.
