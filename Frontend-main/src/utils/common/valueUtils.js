/** 숫자·문자열 공통 값 유틸 · 공통 로깅(errorUtils) */

const getErrorDetails = (error) => ({
  message: error?.message || error?.toString() || '알 수 없는 오류',
  status: error?.status || error?.statusCode || null,
  code: error?.code || null,
  stack: error?.stack || null,
  name: error?.name || 'Error',
});

/** 하위 모듈(cacheManager 등)도 순환 없이 쓸 수 있도록 valueUtils에 둔다 */
export const errorUtils = {
  logError: (context, error, additionalData = {}) => {
    console.error(`[${context}] error:`, {
      ...getErrorDetails(error),
      ...additionalData,
      timestamp: new Date().toISOString(),
    });
  },

  logWarning: (context, message, additionalData = {}) => {
    console.warn(`[${context}] warn:`, {
      message,
      ...additionalData,
      timestamp: new Date().toISOString(),
    });
  },

  logInfo: (context, message, additionalData = {}) => {
    if (import.meta.env.DEV) {
      console.info(`[${context}] info:`, {
        message,
        ...additionalData,
        timestamp: new Date().toISOString(),
      });
    }
  },

  logDebug: (context, message, additionalData = {}) => {
    if (import.meta.env.DEV) {
      console.debug(`[${context}] debug:`, {
        message,
        ...additionalData,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /** fetch 단계 네트워크 실패 (HTTP 401 등 응답이 있는 에러는 제외) */
  isNetworkError: (error) => {
    if (!error || error.status === 401) return false;
    if (error.name === 'TypeError' || error.code === 'NETWORK_ERROR') return true;
    return /failed to fetch|networkerror|load failed|network request failed/i.test(String(error.message || ''));
  },

  getUserFriendlyMessage: (error) => {
    const status = error?.status || error?.statusCode;
    const statusMessages = {
      400: '잘못된 요청입니다',
      401: '인증이 필요합니다. 다시 로그인해주세요',
      403: '접근 권한이 없습니다',
      404: '요청한 데이터를 찾을 수 없습니다',
      500: '서버 오류가 발생했습니다',
      502: '서버 연결 오류가 발생했습니다',
      503: '서비스를 일시적으로 사용할 수 없습니다',
    };

    if (status && statusMessages[status]) return statusMessages[status];
    if (errorUtils.isNetworkError(error)) return '네트워크 연결을 확인해주세요';
    if (error?.message && !error.message.includes('Error:')) return error.message;
    return '오류가 발생했습니다. 잠시 후 다시 시도해주세요';
  },
};

export const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const trimTrailingSlash = (value) => String(value ?? '').replace(/\/$/, '');

export const toTrimmedStringOrNull = (value) => {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
};

/** 길이 초과 시 말줄임 (레이더 축 라벨 등) */
export function truncateWithEllipsis(text, maxLen) {
  if (!text) return '';
  const s = String(text);
  if (!maxLen || s.length <= maxLen) return s;
  if (maxLen <= 1) return '…';
  return `${s.slice(0, maxLen - 1)}…`;
}

/** 목록 인덱스 이동. 미선택(index < 0)이면 앞으로는 처음, 뒤로는 마지막. wrap이면 끝에서 반대쪽으로 순환 */
function moveIndex(index, length, delta, wrap) {
  if (!length || length < 1) return 0;
  if (!Number.isFinite(index) || index < 0) return delta >= 0 ? 0 : length - 1;
  const next = Math.trunc(index) + delta;
  return wrap ? ((next % length) + length) % length : Math.min(length - 1, Math.max(0, next));
}

/** 순환 인덱스 (화살표·형제 전환) */
export const cycleIndex = (index, length, delta = 1) => moveIndex(index, length, delta, true);

/** 순환하지 않고 [0, length-1]에서 멈춤 (목록 끝 고정) */
export const stepIndex = (index, length, delta = 1) => moveIndex(index, length, delta, false);

/** 상대 시간 표기. withTime=false면 달력 날짜 기준 (오늘·어제·N일 전) */
export function formatRelativeTime(value, { withTime = true } = {}) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  let diffDay;
  if (withTime) {
    const diffMin = Math.floor((Date.now() - date.getTime()) / (1000 * 60));
    if (diffMin < 1) return '방금 전';
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}시간 전`;
    diffDay = Math.floor(diffHour / 24);
  } else {
    // 달력 날짜 기준 차이 (round: DST 23/25시간 보정). 미래(시계 오차)는 오늘로 취급
    const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    diffDay = Math.round((startOfDay(new Date()) - startOfDay(date)) / (1000 * 60 * 60 * 24));
    if (diffDay <= 0) return '오늘';
    if (diffDay === 1) return '어제';
  }
  if (diffDay < 7) return `${diffDay}일 전`;
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
}

export const toStringOrNull = (value) => (value == null ? null : String(value));

/** 문자열이면 그대로, 아니면 '' (강제 변환 없음) */
export const stringOrEmpty = (value) => (typeof value === 'string' ? value : '');

export const asArray = (value) => (Array.isArray(value) ? value : []);

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** number 리터럴이면서 양의 유한수인지 (문자열 강제 변환 없음) */
export function isPositiveFiniteNumberLiteral(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** 0~1로 자름. 비유한 값은 0 */
export const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

/** String#localeCompare와 같은 결과 — 정렬 비교마다 collator를 새로 만들지 않음 */
export const compareLocale = new Intl.Collator().compare;
export const compareKo = new Intl.Collator('ko').compare;

/** 관계 긍정도 −1~+1. 비유한 값은 0 */
export function clampPositivity(positivity) {
  const value = Number(positivity);
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/** 비어 있거나 숫자가 아니면 null(정보 없음), 아니면 −1~+1. clampPositivity와 달리 0과 '없음'을 구분 */
export function toPositivityOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? clampPositivity(n) : null;
}

export const toPositiveNumberOrNull = (value) => {
  const num = toNumberOrNull(value);
  return num && num > 0 ? num : null;
};

export const toPositiveInt = (value, fallback = null) => {
  const parsed = toNumberOrNull(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : fallback;
};

export const toPositiveNumberFromId = (value) => {
  if (value == null) return null;
  const direct = toPositiveNumberOrNull(value);
  if (direct) return direct;

  const text = String(value).trim();
  if (!text) return null;

  const eTail = text.match(/[eE](\d+)\s*$/);
  if (eTail) return toPositiveNumberOrNull(eTail[1]);

  const lastDigits = text.match(/(\d+)\s*$/);
  return lastDigits ? toPositiveNumberOrNull(lastDigits[1]) : null;
};

/** locator·manifest·payload 행의 1-based 챕터 번호 (chapterIndex·chapterIdx·idx 필드만, 검증 없음). 이벤트는 resolveEventChapterIndex */
export const resolveChapterIndex = (row) =>
  toNumberOrNull(row?.chapterIndex ?? row?.chapterIdx ?? row?.idx);

/** URL·쿼리·상태에서 온 1-based 챕터 번호: 유한·정수·>= 1 만 통과 (소수는 null) */
export const toOneBasedChapterIndexOrNull = (value) => {
  const n = toPositiveInt(value);
  return n === toNumberOrNull(value) ? n : null;
};

export const clampPercent = (value, fallback = null) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
};

// --- 이벤트 id·순번 (manifestCache·graphCore eventUtils 공용) ---

function nonEmptyId(value) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s !== '' ? value : null;
}

function normalizeEventIdx(event) {
  if (!event || typeof event !== 'object') return null;
  return (
    toPositiveNumberOrNull(event.eventNum) ??
    toPositiveNumberOrNull(event.eventIdx) ??
    toPositiveNumberOrNull(event.idx) ??
    toPositiveNumberFromId(event.eventId) ??
    toPositiveNumberOrNull(event.originalEventIdx) ??
    toPositiveNumberOrNull(event.event?.eventNum) ??
    toPositiveNumberOrNull(event.event?.eventIdx) ??
    toPositiveNumberOrNull(event.event?.idx) ??
    toPositiveNumberFromId(event.event?.eventId)
  );
}

export const resolveEventId = (event) => {
  if (!event || typeof event !== 'object') return null;
  const direct = nonEmptyId(event.eventId ?? event.id);
  if (direct != null) return direct;
  const nested = event.event;
  if (!nested || typeof nested !== 'object') return null;
  return nonEmptyId(nested.eventId ?? nested.id);
};

/** 이벤트 순번(양수). 숫자는 그대로, 객체는 idx 필드 → eventId 꼬리 숫자 순으로 해석. 없으면 fallback */
export function resolveEventNum(event, fallback = 0) {
  if (typeof event === 'number' && Number.isFinite(event) && event > 0) {
    return Math.trunc(event);
  }
  if (!event || typeof event !== 'object') return fallback;
  const direct = normalizeEventIdx(event);
  if (direct) return direct;

  const inner = event.event;
  if (inner && typeof inner === 'object') {
    const fromInner = normalizeEventIdx(inner) ?? toPositiveNumberFromId(resolveEventId(inner));
    if (fromInner) return fromInner;
  }
  return toPositiveNumberFromId(resolveEventId(event)) ?? fallback;
}

/** 이벤트 순번 오름차순 정렬 (없는 값은 뒤로) */
export function sortEventsByIdx(events) {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => {
    const idxA = resolveEventNum(a, null);
    const idxB = resolveEventNum(b, null);
    if (idxA == null && idxB == null) return 0;
    if (idxA == null) return 1;
    if (idxB == null) return -1;
    return idxA - idxB;
  });
}

/** 이벤트의 챕터 번호(양수): 챕터 필드(resolveChapterIndex) → event.chapter → 중첩 event 순. 없으면 null */
export function resolveEventChapterIndex(event) {
  if (!event || typeof event !== 'object') return null;
  const own = toPositiveNumberOrNull(resolveChapterIndex(event)) ?? toPositiveNumberOrNull(event.chapter);
  if (own) return own;
  const nested = event.event;
  if (!nested || typeof nested !== 'object') return null;
  return toPositiveNumberOrNull(resolveChapterIndex(nested)) ?? toPositiveNumberOrNull(nested.chapter);
}
