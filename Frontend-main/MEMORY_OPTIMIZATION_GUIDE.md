# 🚀 ReadWith 프로젝트 메모리 최적화 가이드

## 📋 즉시 적용 가능한 해결책

### 1단계: 환경 설정 (5분)
```bash
# 1. 최적화 스크립트 실행
node optimization-script.js

# 2. 메모리 최적화된 개발 서버 시작
npm run dev:memory

# 3. 메모리 사용량 모니터링
npm run monitor
```

### 2단계: IDE 설정 (10분)

#### Visual Studio Code
1. `.vscode/settings.json` 파일 적용
2. 불필요한 확장 프로그램 비활성화
3. 파일 감시 제외 설정 적용

#### IntelliJ IDEA/WebStorm
1. VM 옵션 설정: `Help` > `Edit Custom VM Options`
2. 인덱싱 제외: `src/data/**` 폴더 제외
3. 불필요한 플러그인 비활성화

### 3단계: 프로젝트 최적화 (15분)

#### 빌드 설정 최적화
```bash
# 기존 설정 백업
cp vite.config.js vite.config.js.backup
cp package.json package.json.backup

# 최적화된 설정 적용
cp vite.config.optimized.js vite.config.js
cp package.optimized.json package.json
```

#### 데이터 파일 최적화
- `src/data/` 폴더의 289개 JSON 파일을 별도 처리
- 필요시에만 로드하는 지연 로딩 구현

## 🔧 고급 최적화 방안

### 1. 컴포넌트 최적화
현재 `RelationshipRadarChart.jsx`에서 확인된 최적화 포인트:

```javascript
// ✅ 이미 적용된 최적화
- React.memo() 사용
- useMemo()로 데이터 처리 최적화
- useCallback()으로 함수 메모이제이션
- Map을 사용한 빠른 데이터 검색

// 🔄 추가 최적화 가능
- 가상화(Virtualization) 적용
- 이미지 지연 로딩
- 불필요한 리렌더링 방지
```

### 2. 번들 최적화
```javascript
// vite.config.js에서 청크 분할 최적화
manualChunks: {
  vendor: ['react', 'react-dom'],
  charts: ['recharts'],
  epub: ['epubjs'],
  graph: ['cytoscape'],
  ui: ['@ant-design/pro-components']
}
```

### 3. 메모리 모니터링
```bash
# 개발 중 메모리 사용량 체크
npm run monitor

# 빌드 시 메모리 사용량 체크
npm run build:memory
```

## 🚨 문제 해결 체크리스트

### 메모리 사용량이 여전히 높은 경우:
- [ ] `src/data/` 폴더가 인덱싱에서 제외되었는지 확인
- [ ] 불필요한 확장 프로그램이 비활성화되었는지 확인
- [ ] IDE를 재시작했는지 확인
- [ ] 캐시가 정리되었는지 확인

### 빌드 실패 시:
- [ ] Node.js 메모리 제한 증가: `NODE_OPTIONS="--max-old-space-size=8192"`
- [ ] 청크 크기 제한 조정
- [ ] 소스맵 비활성화

### 개발 서버 느림:
- [ ] 파일 감시 제외 설정 확인
- [ ] HMR 포트 충돌 확인
- [ ] 백그라운드 프로세스 종료

## 📊 예상 성능 개선 효과

| 항목 | 개선 전 | 개선 후 | 개선률 |
|------|---------|---------|--------|
| IDE 메모리 사용량 | 2-4GB | 1-2GB | 50% ↓ |
| 빌드 시간 | 3-5분 | 1-2분 | 60% ↓ |
| 개발 서버 시작 시간 | 30-60초 | 10-20초 | 70% ↓ |
| 파일 감시 CPU 사용량 | 높음 | 낮음 | 80% ↓ |

## 🆘 긴급 상황 대처법

### IDE가 완전히 멈춘 경우:
1. **강제 종료**: `Ctrl+Alt+Del` (Windows) 또는 `Force Quit` (Mac)
2. **작업 관리자에서 프로세스 종료**
3. **캐시 완전 삭제**: `npm run clean:memory`
4. **IDE 재시작**

### 메모리 부족 오류 발생 시:
```bash
# Node.js 메모리 제한 증가
export NODE_OPTIONS="--max-old-space-size=8192"

# 또는 Windows에서
set NODE_OPTIONS=--max-old-space-size=8192
```

## 📞 추가 지원

문제가 지속되는 경우:
1. 시스템 사양 확인 (RAM 8GB 이상 권장)
2. 백그라운드 프로그램 종료
3. 가상 메모리 설정 확인
4. SSD 사용 권장 (HDD보다 빠름)
