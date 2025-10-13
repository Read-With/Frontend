# IntelliJ IDEA / WebStorm 메모리 최적화 가이드

## 1. VM 옵션 최적화
`Help` > `Edit Custom VM Options...`에서 다음 설정 추가:

```
# 메모리 할당 (시스템 RAM의 50-70% 권장)
-Xmx4g
-Xms2g

# 가비지 컬렉션 최적화
-XX:+UseG1GC
-XX:MaxGCPauseMillis=200
-XX:+UnlockExperimentalVMOptions
-XX:+UseStringDeduplication

# 메타스페이스 최적화
-XX:MetaspaceSize=512m
-XX:MaxMetaspaceSize=1g

# 기타 성능 최적화
-XX:+UseCompressedOops
-XX:+OptimizeStringConcat
-XX:+UseCompressedClassPointers
```

## 2. 프로젝트 설정 최적화
- `File` > `Settings` > `Editor` > `General`
  - `Code Completion`: `Autopopup in (ms)` → 1000ms로 증가
  - `Parameter Info`: `Autopopup in (ms)` → 1500ms로 증가

## 3. 인덱싱 최적화
- `File` > `Settings` > `Directories`
  - `src/data/**` 폴더를 `Excluded`로 설정
  - `node_modules` 폴더를 `Excluded`로 설정
  - `dist` 폴더를 `Excluded`로 설정

## 4. 플러그인 관리
불필요한 플러그인 비활성화:
- Database Tools and SQL
- Git Integration
- Mercurial Integration
- Subversion Integration
- CVS Integration
