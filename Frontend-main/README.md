# ReadWith 📚

EPUB 파일을 읽고, 인물 관계도를 시각화하며, 북마크와 메모를 관리할 수 있는 React 기반 스마트 독서 플랫폼입니다.

## ✨ 주요 기능

### 📖 EPUB 뷰어
- 고성능 EPUB 뷰어
- 분할/단일 화면 모드 지원
- 읽기 진행률 추적 및 자동 저장
- 페이지 네비게이션

### 🗺️ 인물 관계도 시각화
- Cytoscape.js 기반 인터랙티브 그래프
- 실시간 관계 업데이트
- 인물 검색 및 필터링
- 관계 라벨 표시/숨기기

### 🔖 스마트 북마크
- CFI 기반 정확한 위치 저장
- 북마크별 메모 작성
- 색상별 중요도 구분
- 서버 동기화

### 📚 나의 서재
- 개인 도서 라이브러리 관리
- EPUB 파일 업로드 및 저장
- 도서 메타데이터 표시

## 🚀 시작하기

### 1. 설치
```bash
npm install
```

### 2. 환경 변수 설정
`.env` 파일을 생성하고 Google OAuth 설정을 추가하세요:

```env
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here
```

### 3. Google Cloud Console 설정
1. [Google Cloud Console](https://console.cloud.google.com/) 접속
2. OAuth 2.0 Client ID 생성
3. 승인된 JavaScript 원본에 `http://localhost:5173` 추가

### 4. 개발 서버 실행
```bash
npm run dev
```

## 🛠 기술 스택

| 영역 | 기술 |
|------|------|
| **프론트엔드** | React 19, React Router, Recoil |
| **뷰어** | epub.js |
| **그래프** | Cytoscape.js |
| **스타일링** | Tailwind CSS, 반응형 디자인 |
| **상태관리** | React Hooks, Recoil |
| **빌드 도구** | Vite |

## 📁 프로젝트 구조

```
src/
├── components/
│   ├── viewer/           # EPUB 뷰어
│   ├── graph/            # 관계도 시각화
│   ├── library/          # 도서 라이브러리
│   └── common/           # 공통 컴포넌트
├── hooks/                # 커스텀 훅
├── utils/                # 유틸리티 함수
└── pages/               # 페이지 컴포넌트
```

## 📝 라이선스

이 프로젝트는 MIT 라이선스 하에 배포됩니다.

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 🐛 문제 해결

### 일반적인 문제들

**Q: Google OAuth 로그인이 안 돼요**
A: Google Cloud Console에서 승인된 JavaScript 원본에 `http://localhost:5173`이 추가되었는지 확인하세요.

**Q: EPUB 파일이 로드되지 않아요**
A: 파일이 올바른 EPUB 형식인지 확인하고, 브라우저 콘솔에서 오류 메시지를 확인하세요.

**Q: 그래프가 표시되지 않아요**
A: 데이터 파일이 올바른 위치에 있는지 확인하고, 네트워크 탭에서 API 호출 상태를 확인하세요.