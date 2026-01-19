# RelationGraphWrapper.jsx 개선사항

## 1. 컴포넌트 분리 및 구조 개선

### 문제점
- 1364줄의 거대한 단일 컴포넌트
- 너무 많은 책임을 가짐 (데이터 로딩, UI 렌더링, 상태 관리 등)

### 개선안
```javascript
// 컴포넌트를 기능별로 분리
- RelationGraphWrapper (메인 컨테이너)
  - GraphTopBar (상단 바)
  - ChapterSidebar (챕터 사이드바)
  - GraphCanvas (그래프 캔버스 영역)
  - EventControls (이벤트 컨트롤)
  - GraphInfoBar (그래프 정보 표시)
```

## 2. 커스텀 훅 분리

### 문제점
- 데이터 로딩 로직이 컴포넌트 내부에 직접 구현됨
- Manifest, Macro, Fine 그래프 로딩 로직이 중복됨

### 개선안
```javascript
// useApiGraphData.js - API 그래프 데이터 로딩 통합 훅
const useApiGraphData = (serverBookId, currentChapter, currentEvent) => {
  // manifest, macro, fine 데이터 로딩을 하나의 훅으로 통합
  // 캐시 우선순위 로직 통합
  // 에러 처리 통합
  // 로딩 상태 통합
}

// useGraphState.js - 그래프 상태 관리 훅
const useGraphState = () => {
  // sidebar, tooltip, filter 등 UI 상태 통합 관리
}
```

## 3. 상수 및 설정값 분리

### 문제점
- 매직 넘버가 코드 전반에 산재
- 하드코딩된 스타일 값들

### 개선안
```javascript
// constants/graphConstants.js
export const GRAPH_CONSTANTS = {
  SIDEBAR: {
    OPEN_WIDTH: 240,
    CLOSED_WIDTH: 60,
    TOOLTIP_WIDTH: 450,
  },
  LAYOUT: {
    TOP_BAR_HEIGHT: 54,
    CENTER_OFFSET_X: 0.1,
    CENTER_OFFSET_Y: 0.15,
  },
  ANIMATION: {
    DURATION: 800,
    DELAY: 100,
    TOOLTIP_DELAY: 700,
  },
  TIMEOUT: {
    DROPDOWN_RESET: 100,
    FORCE_CLOSE: 100,
    DOCUMENT_CLICK: 10,
  },
  FILTER: {
    ALL: 0,
    MAIN_CHARACTERS: 1,
    MAIN_AND_RELATED: 2,
  },
};
```

## 4. 중복 로직 제거

### 문제점
- 최대 챕터 계산 로직이 여러 곳에 중복 (116-206줄)
- 폴백 데이터 처리 로직 중복 (267-379줄)
- 캐시 확인 로직 패턴 반복

### 개선안
```javascript
// utils/graph/apiGraphLoader.js
export const loadApiGraphData = async (bookId, chapter, event) => {
  // 통합된 캐시 확인 및 API 호출 로직
  // 1. localStorage 캐시
  // 2. Chapter Events 캐시
  // 3. API 호출
  // 4. 폴백 처리
};

// utils/graph/maxChapterResolver.js
export const resolveMaxChapter = (bookId, manifest, graphCache) => {
  // 최대 챕터 계산 로직 통합
};
```

## 5. 에러 처리 개선

### 문제점
- 에러 처리 일관성 부족
- 에러 로깅 없음
- 사용자에게 에러 피드백 부족

### 개선안
```javascript
// hooks/useErrorHandler.js
const useErrorHandler = () => {
  const [error, setError] = useState(null);
  
  const handleError = useCallback((error, context) => {
    console.error(`[${context}]`, error);
    setError({
      message: error.message || '알 수 없는 오류가 발생했습니다',
      context,
      timestamp: Date.now(),
    });
  }, []);
  
  return { error, handleError, clearError: () => setError(null) };
};
```

## 6. 성능 최적화

### 문제점
- 불필요한 리렌더링 가능성
- useMemo/useCallback 의존성 배열 최적화 필요
- 이벤트 리스너 정리 로직 개선

### 개선안
```javascript
// useMemo 최적화
const apiElements = useMemo(() => {
  if (!apiFineData?.characters || !apiFineData?.relations) {
    return [];
  }
  // ... 변환 로직
}, [apiFineData, currentChapter, currentEvent]); // 의존성 명확화

// useCallback 최적화
const handleChapterSelect = useCallback((chapter) => {
  // ... 로직
}, [currentChapter, setCurrentChapter, isApiBook, manifestData, filename, clearAll]);
// clearAll이 매번 새로 생성되지 않도록 확인 필요
```

## 7. 타입 안정성

### 문제점
- PropTypes 또는 TypeScript 없음
- 타입 체크 부족

### 개선안
```javascript
// TypeScript 도입 또는 PropTypes 추가
RelationGraphWrapper.propTypes = {
  // props 타입 정의
};

// 또는 TypeScript 인터페이스
interface GraphData {
  characters: Character[];
  relations: Relation[];
  event?: Event;
}
```

## 8. 코드 가독성 개선

### 문제점
- 긴 조건문 (692-713줄)
- 복잡한 중첩 구조
- 주석 부족

### 개선안
```javascript
// 헬퍼 함수로 분리
const getEventCountForChapter = (chapterInfo) => {
  if (!chapterInfo) return 1;
  
  let eventCount = chapterInfo.eventCount || 
                   chapterInfo.events || 
                   chapterInfo.event_count || 0;
  
  if (Array.isArray(eventCount)) {
    return eventCount.length;
  }
  
  return typeof eventCount === 'number' && !isNaN(eventCount) 
    ? eventCount 
    : 1;
};

// 사용
const lastEventNum = isApiBook
  ? getEventCountForChapter(chapterInfo)
  : getLastEventIndexForChapter(folderKey, chapter) || 1;
```

## 9. 상태 관리 통합

### 문제점
- 관련된 상태들이 분산됨
- 상태 업데이트 로직이 여러 곳에 흩어짐

### 개선안
```javascript
// useReducer로 관련 상태 통합
const graphReducer = (state, action) => {
  switch (action.type) {
    case 'SET_CHAPTER':
      return { ...state, currentChapter: action.payload };
    case 'SET_EVENT':
      return { ...state, currentEvent: action.payload };
    case 'TOGGLE_SIDEBAR':
      return { ...state, isSidebarOpen: !state.isSidebarOpen };
    // ...
  }
};
```

## 10. 테스트 가능성 개선

### 문제점
- 비즈니스 로직이 컴포넌트에 직접 구현
- 테스트하기 어려운 구조

### 개선안
```javascript
// 로직을 순수 함수로 분리
export const calculateMaxChapter = (manifest, graphCache, bookId) => {
  // 테스트 가능한 순수 함수
};

export const processApiGraphData = (apiData, chapter, event) => {
  // 테스트 가능한 데이터 변환 함수
};
```

## 11. 접근성 개선

### 문제점
- ARIA 속성 부족
- 키보드 네비게이션 고려 부족

### 개선안
```javascript
<button
  onClick={toggleSidebar}
  aria-label={isSidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
  aria-expanded={isSidebarOpen}
>
```

## 12. 메모리 누수 방지

### 문제점
- timeout 정리 로직이 복잡함
- 이벤트 리스너 정리 타이밍 이슈 가능

### 개선안
```javascript
// useTimeout 훅 생성
const useTimeout = (callback, delay) => {
  const timeoutRef = useRef(null);
  
  useEffect(() => {
    timeoutRef.current = setTimeout(callback, delay);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [callback, delay]);
  
  return timeoutRef;
};
```

## 우선순위별 개선 계획

### 높은 우선순위
1. 커스텀 훅 분리 (useApiGraphData)
2. 상수 분리
3. 중복 로직 제거

### 중간 우선순위
4. 컴포넌트 분리
5. 에러 처리 개선
6. 성능 최적화

### 낮은 우선순위
7. 타입 안정성
8. 테스트 가능성
9. 접근성
