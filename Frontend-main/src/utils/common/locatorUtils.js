/** v2 locator: chapterIndex(1-based), blockIndex·offset(0-based 코드포인트) */
import { isPositiveFiniteNumber, toNumberOrNull as toNumber } from './numberUtils';

const locatorChapterIndex = (locator) => Number(locator?.chapterIndex ?? locator?.chapterIdx);

const hasPositiveChapterHint = (locator) => isPositiveFiniteNumber(locatorChapterIndex(locator));

const firstLocator = (...candidates) => {
  for (const candidate of candidates) {
    const loc = toLocator(candidate);
    if (loc) return loc;
  }
  return null;
};

export const toLocator = (obj) => {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  const chapterIndex = toNumber(obj.chapterIndex ?? obj.chapterIdx);
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

/** anchor → 그래프 placeholder용 payload (startLocator 키 유무에 따라 키 이름 분기) */export const toEventAnchorPayload = (anchor) => {
  const { startLocator, endLocator } = anchorToLocators(anchor);
  if (!startLocator) return null;
  if (anchor?.startLocator) return { startLocator, endLocator };
  return { start: startLocator, end: endLocator };
};

/** resume 앵커에 유효 chapter 힌트가 있는지 (toLocator 정규화 없이 chapterIndex만 검사) */export function graphPanelHasResumeLocationHint(resumeAnchor) {
  const loc = resumeAnchor?.startLocator ?? resumeAnchor?.start;
  return hasPositiveChapterHint(loc);
}

/** 캐시 progress에 locator 또는 chapterIdx+eventNum 힌트가 있는지 */export function graphPanelHasCachedLocationHint(cachedLocation) {
  const loc =
    cachedLocation?.startLocator ??
    cachedLocation?.locator ??
    cachedLocation?.anchor?.startLocator ??
    cachedLocation?.anchor?.start;
  if (loc && typeof loc === 'object') {
    if (hasPositiveChapterHint(loc)) {
      return true;
    }
  }
  if (!cachedLocation) {
    return false;
  }
  if (!hasPositiveChapterHint({ chapterIdx: cachedLocation.chapterIdx })) {
    return false;
  }
  const cachedEvent = Number(cachedLocation.eventNum ?? 0);
  return isPositiveFiniteNumber(cachedEvent);
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

/** 블록 내 range 시작/끝까지 코드포인트 오프셋 (0-based, opts.useEnd로 끝 기준) */export const codePointOffsetInBlock = (blockEl, range, opts = {}) => {
  if (!blockEl || !range) return 0;
  const useEnd = opts.useEnd === true;
  const doc = blockEl.ownerDocument;
  if (!doc) return 0;
  try {
    const blockRange = doc.createRange();
    blockRange.selectNodeContents(blockEl);
    const container = useEnd ? range.endContainer : range.startContainer;
    const offset = useEnd ? range.endOffset : range.startOffset;
    if (!blockEl.contains(container)) return 0;
    const cmp = blockRange.comparePoint(container, offset);
    if (cmp < 0) return 0;
    if (cmp > 0) return blockCodePointLength(blockEl);
    const prefixRange = doc.createRange();
    prefixRange.setStart(blockRange.startContainer, blockRange.startOffset);
    prefixRange.setEnd(container, offset);
    return blockCodePointLength(prefixRange);
  } catch {
    return 0;
  }
};

const blockCodePointLength = (nodeOrRange) => {
  const text = nodeOrRange.toString?.() ?? (nodeOrRange.textContent || '');
  return [...text].length;
};
