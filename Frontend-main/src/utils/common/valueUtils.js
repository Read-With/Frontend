/** 숫자·문자열·locator 공통 값 유틸 */

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

export const toStringOrNull = (value) => (value == null ? null : String(value));

/** 책 제목 비교용 정규화 (대소문자·공백·특수문자 제거) */
export const normalizeTitle = (title) => {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s/g, '');
};

/** 저자 비교용 정규화 */
export const normalizeAuthor = (author) =>
  (author || '').toLowerCase().trim().replace(/\s+/g, ' ');

export const toFiniteNumber = (value) => {
  if (value === undefined || value === null) return NaN;
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(converted) ? converted : NaN;
};

export const toPositiveNumberOrNull = (value) => {
  const num = toNumberOrNull(value);
  return num && num > 0 ? num : null;
};

export const toPositiveInt = (value, fallback = null) => {
  const parsed = toFiniteNumber(value);
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

export const isPositiveFiniteNumber = (value) => {
  const num = toNumberOrNull(value);
  return num !== null && num > 0;
};

/** locator·manifest·payload 공통 1-based 챕터 번호 해석 */
export const resolveChapterIndex = (row) =>
  toNumberOrNull(row?.chapterIndex ?? row?.chapterIdx ?? row?.idx);

/** URL·쿼리·상태에서 온 1-based 챕터 번호: trim 후 유한·정수·>= 1 만 통과 */
export const toOneBasedChapterIndexOrNull = (value) => {
  if (value === null || value === undefined) return null;
  let v = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    v = s;
  }
  const num = Number(v);
  if (!Number.isFinite(num) || num < 1) return null;
  const t = Math.trunc(num);
  return t === num ? t : null;
};

export const clampPercent = (value, fallback = null) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
};

export const deepClone = (value) => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (error) {
    console.warn('structuredClone 실패, JSON 직렬화로 대체합니다.', error);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('deepClone 실패:', error);
    return value;
  }
};

// --- locator (merged from locatorUtils) ---

const toNumber = toNumberOrNull;

const hasPositiveChapterHint = (locator) => isPositiveFiniteNumber(resolveChapterIndex(locator));

const firstLocator = (...candidates) => {
  for (const candidate of candidates) {
    const loc = toLocator(candidate);
    if (loc) return loc;
  }
  return null;
};

const extractLocationHint = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  return (
    payload.startLocator ??
    payload.locator ??
    payload.anchor?.startLocator ??
    payload.anchor?.start ??
    payload.start ??
    null
  );
};

export const toLocator = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const chapterIndex = resolveChapterIndex(obj);
  const blockIndex = toNumber(obj.blockIndex);
  const offset = toNumber(obj.offset);
  if (chapterIndex == null || chapterIndex < 1) return null;
  return {
    chapterIndex: Number(chapterIndex),
    blockIndex: Number.isFinite(blockIndex) ? blockIndex : 0,
    offset: Number.isFinite(offset) ? offset : 0,
  };
};

export const locatorsEqual = (a, b) => {
  const A = toLocator(a);
  const B = toLocator(b);
  if (!A || !B) return false;
  return A.chapterIndex === B.chapterIndex && A.blockIndex === B.blockIndex && A.offset === B.offset;
};

export const anchorToLocators = (anchor) => {
  if (!anchor) return { startLocator: null, endLocator: null };
  const start =
    firstLocator(anchor.startLocator, anchor.start) ??
    (hasPositiveChapterHint(anchor) ? toLocator(anchor) : null);
  const end =
    firstLocator(anchor.endLocator, anchor.end, anchor.startLocator, anchor.start) ??
    start;
  return {
    startLocator: start,
    endLocator: end ?? start,
  };
};

/**
 * 그래프 패널 위치 힌트 여부.
 * requireEventNum: true면 chapterIdx+eventNum 폴백(캐시), false면 locator만(resume).
 */
export function hasGraphPanelLocationHint(payload, { requireEventNum = false } = {}) {
  const loc = extractLocationHint(payload);
  if (loc && typeof loc === 'object' && hasPositiveChapterHint(loc)) {
    return true;
  }
  if (!requireEventNum || !payload || typeof payload !== 'object') {
    return false;
  }
  if (!isPositiveFiniteNumber(resolveChapterIndex(payload))) {
    return false;
  }
  return isPositiveFiniteNumber(Number(payload.eventNum ?? 0));
}

/** progress·캐시 payload에서 단일 reading locator 해석 */
export const resolveProgressLocator = (data) => {
  if (!data || typeof data !== 'object') return null;
  const a = data.anchor;
  const candidate =
    data.startLocator ??
    firstLocator(data.locator, data) ??
    (a && firstLocator(a.startLocator, a.start, a));
  if (candidate == null) return null;
  return toLocator(candidate) ?? candidate;
};

/** 뷰어 displayAt / preferred resume용 앵커 (진도·북마크 공용) */
export const toViewerResumeAnchor = (payload) => {
  if (!payload || typeof payload !== 'object') return null;
  const { startLocator, endLocator } = anchorToLocators(payload);
  if (!startLocator) return null;
  return { startLocator, endLocator: endLocator ?? startLocator };
};

/** progress payload → 뷰어용 { startLocator, endLocator } (동일 위치) */
export const progressResultToViewerAnchor = (data) => {
  const loc = resolveProgressLocator(data);
  if (!loc) return null;
  return { startLocator: loc, endLocator: loc };
};

/** 동일 resume 위치 중복 적용 방지 키 */
export const viewerResumeAnchorKey = (anchor) => {
  if (!anchor || typeof anchor !== 'object') return '';
  const loc = toLocator(anchor.startLocator ?? anchor.start ?? null);
  if (!loc) return '';
  return `${loc.chapterIndex}:${loc.blockIndex}:${loc.offset}`;
};

/** POST /api/v2/progress 및 캐시 병합용 payload 생성 */
export const progressPayloadFromData = (data) => {
  if (data?.bookId == null || data.bookId === '') return null;
  const locator = resolveProgressLocator(data);
  if (!locator) return null;

  const rawId = data.bookId;
  const numId = Number(rawId);
  const bookId =
    String(rawId).trim() !== '' && Number.isFinite(numId) && numId > 0 ? numId : rawId;

  const endLocator =
    data.endLocator != null || data.end != null
      ? toLocator(data.endLocator ?? data.end) ?? { ...locator }
      : { ...locator };

  const version =
    typeof data.locatorVersion === 'string' && data.locatorVersion.trim()
      ? data.locatorVersion.trim()
      : 'v2';

  return {
    bookId,
    startLocator: { ...locator },
    endLocator,
    locator: { ...locator },
    locatorVersion: version,
  };
};
