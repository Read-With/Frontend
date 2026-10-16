import { errorUtils } from '../valueUtils';

function getStorage(storageType = 'localStorage') {
  if (typeof window === 'undefined') return null;
  try {
    // 쿠키/사이트 데이터 차단 시 접근만으로 SecurityError
    return storageType === 'sessionStorage' ? sessionStorage : localStorage;
  } catch {
    return null;
  }
}

/** 문자열 그대로 읽기 (JSON 아님). 실패 시 null */
export function readRaw(key, storageType = 'localStorage') {
  try {
    return getStorage(storageType)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** 문자열 그대로 쓰기. null/''이면 제거. 성공 여부 반환 */
export function writeRaw(key, value, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return false;
  try {
    if (value == null || value === '') storage.removeItem(key);
    else storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** 여러 키 제거. 성공 여부 반환 */
export function removeKeys(storageType, ...keys) {
  const storage = getStorage(storageType);
  if (!storage) return false;
  try {
    keys.forEach((key) => storage.removeItem(key));
    return true;
  } catch {
    return false;
  }
}

/** 크기 제한 Map 쓰기 — 다시 쓰면 최신으로 이동, 넘치면 가장 오래된 항목 제거 */
export function setBounded(map, key, value, maxSize) {
  map.delete(key);
  map.set(key, value);
  if (map.size > maxSize) map.delete(map.keys().next().value);
}

/** inflight 등록 후 완료 시 해제 (forceRefresh 등으로 덮어쓴 다른 요청의 등록은 지우지 않음) */
export const awaitTracked = async (map, key, promise, entry = promise) => {
  map.set(key, entry);
  try {
    return await promise;
  } finally {
    if (map.get(key) === entry) map.delete(key);
  }
};

/** 같은 key 동시 요청은 진행 중 promise에 합류, 끝나면 map에서 제거 */
export function withInflight(map, cacheKey, run) {
  if (!cacheKey) return Promise.resolve().then(run);
  return map.get(cacheKey) ?? awaitTracked(map, cacheKey, Promise.resolve().then(run));
}

export function loadFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return null;
  
  try {
    const stored = storage.getItem(storageKey);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') {
      storage.removeItem(storageKey);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(storageKey);
    return null;
  }
}

export function saveToStorage(storageKey, data, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return false;

  try {
    storage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch (error) {
    errorUtils.logDebug('cacheManager', `스토리지 저장 실패 (${storageKey})`, { message: error?.message });
    return false;
  }
}

export function removeFromStorage(storageKey, storageType = 'localStorage') {
  const storage = getStorage(storageType);
  if (!storage) return;
  
  try {
    storage.removeItem(storageKey);
  } catch (error) {
    errorUtils.logDebug('cacheManager', `스토리지 삭제 실패 (${storageKey})`, { message: error?.message });
  }
}

/** timestamp 기반 TTL 검사 후 만료 시 스토리지 항목 제거 */
export function loadTtlStorage(storageKey, maxAgeMs, storageType = 'localStorage') {
  const data = loadFromStorage(storageKey, storageType);
  if (!data) return null;

  const age = Date.now() - (data.timestamp || 0);
  if (maxAgeMs > 0 && age > maxAgeMs) {
    removeFromStorage(storageKey, storageType);
    return null;
  }

  return data;
}

/** timestamp를 보장하며 스토리지에 저장 */
export function saveTtlStorage(storageKey, data, storageType = 'localStorage') {
  const payload = {
    ...data,
    timestamp: data?.timestamp ?? Date.now(),
  };
  saveToStorage(storageKey, payload, storageType);
  return payload;
}
