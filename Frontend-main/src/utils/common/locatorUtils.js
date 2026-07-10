/** v2 locator: chapterIndex(1-based), blockIndex·offset(0-based 코드포인트) */
import {
  isPositiveFiniteNumber,
  resolveChapterIndex,
  toNumberOrNull as toNumber,
} from './valueUtils';

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

/** progress payload → 뷰어용 { startLocator, endLocator } (동일 위치) */
export const progressResultToViewerAnchor = (data) => {
  const loc = resolveProgressLocator(data);
  if (!loc) return null;
  return { startLocator: loc, endLocator: loc };
};

/** 동일 resume 위치 중복 적용 방지 키 */
export const viewerResumeAnchorKey = (anchor) => {
  if (!anchor || typeof anchor !== 'object') return '';
  const loc = anchor.startLocator ?? anchor.start ?? null;
  if (!loc || typeof loc !== 'object') return '';
  return JSON.stringify(loc);
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
