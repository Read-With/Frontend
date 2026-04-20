/**
 * v2 표준 Locator: { chapterIndex (1-based), blockIndex (0-based), offset (0-based 코드포인트) }
 */

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

const toNumber = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const anchorToLocators = (anchor) => {
  if (!anchor) return { startLocator: null, endLocator: null };
  const start =
    toLocator(anchor.startLocator) ??
    toLocator(anchor.start) ??
    (Number.isFinite(Number(anchor.chapterIndex)) || Number.isFinite(Number(anchor.chapterIdx)) ? toLocator(anchor) : null);
  const end =
    toLocator(anchor.endLocator) ??
    toLocator(anchor.end) ??
    toLocator(anchor.startLocator) ??
    toLocator(anchor.start) ??
    start;
  return {
    startLocator: start,
    endLocator: end ?? start,
  };
};

/**
 * 뷰어 getCurrentLocator 등에서 온 래퍼를 그래프 placeholder용 anchor로 직렬화.
 * 원본에 startLocator 키가 있으면 { startLocator, endLocator }, 없으면 { start, end }.
 */
export const toEventAnchorPayload = (anchor) => {
  const { startLocator, endLocator } = anchorToLocators(anchor);
  if (!startLocator) return null;
  if (anchor?.startLocator) return { startLocator, endLocator };
  return { start: startLocator, end: endLocator };
};

/**
 * 그래프 분할 패널 로딩 게이트: 서버 재진입 resume 앵커에 유효 챕터 힌트가 있는지.
 * (resolveProgressLocator와 달리 엄격한 toLocator 정규화 없이 기존 뷰어와 동일 조건만 사용)
 */
export function graphPanelHasResumeLocationHint(resumeAnchor) {
  const loc = resumeAnchor?.startLocator ?? resumeAnchor?.start;
  if (!loc) return false;
  const ch = Number(loc.chapterIndex ?? loc.chapterIdx);
  return Number.isFinite(ch) && ch >= 1;
}

/**
 * 그래프 분할 패널 로딩 게이트: 캐시 진행 payload에 locator 또는 chapterIdx+eventNum 힌트가 있는지.
 */
export function graphPanelHasCachedLocationHint(cachedLocation) {
  const loc =
    cachedLocation?.startLocator ??
    cachedLocation?.locator ??
    cachedLocation?.anchor?.startLocator ??
    cachedLocation?.anchor?.start;
  if (loc && typeof loc === 'object') {
    const ch = Number(loc.chapterIndex ?? loc.chapterIdx);
    if (Number.isFinite(ch) && ch >= 1) {
      return true;
    }
  }
  if (!cachedLocation) {
    return false;
  }
  const cachedChapter = Number(cachedLocation.chapterIdx);
  if (!Number.isFinite(cachedChapter) || cachedChapter < 1) {
    return false;
  }
  const cachedEvent = Number(cachedLocation.eventNum ?? 0);
  return Number.isFinite(cachedEvent) && cachedEvent > 0;
}

/** GET /api/v2/graph/* — 이벤트의 anchor에서 읽기 위치 locator 추출 */
export const readingLocatorFromGraphEvent = (currentEvent) => {
  if (!currentEvent?.anchor) return null;
  const { startLocator } = anchorToLocators(currentEvent.anchor);
  return toLocator(startLocator);
};

/** 서버 v2 progress·캐시 공통: 단일 reading 위치(locator) 해석 */
export const resolveProgressLocator = (data) => {
  if (!data || typeof data !== 'object') return null;
  const a = data.anchor;
  const candidate =
    data.startLocator ??
    toLocator(data.locator) ??
    toLocator(data) ??
    (a && (toLocator(a.startLocator) ?? toLocator(a.start) ?? toLocator(a)));
  if (candidate == null) return null;
  return toLocator(candidate) ?? candidate;
};

/** 서버/로컬 progress payload → 뷰어 displayAt·initialAnchor용 대칭 앵커 */
export const progressResultToViewerAnchor = (data) => {
  const loc = resolveProgressLocator(data);
  if (!loc) return null;
  return { startLocator: loc, endLocator: loc };
};

/** 재진입 시 동일 위치 중복 적용(displayAt 폴링 등) 방지용 키 */
export const viewerResumeAnchorKey = (anchor) => {
  if (!anchor || typeof anchor !== 'object') return '';
  const loc = anchor.startLocator ?? anchor.start ?? null;
  if (!loc || typeof loc !== 'object') return '';
  return JSON.stringify(loc);
};

/** POST /api/v2/progress 본문 및 캐시 병합용 — bookId, startLocator, endLocator, locator, locatorVersion */
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

/**
 * 블록 요소 내 Range의 start 또는 end 위치까지의 코드포인트 수(0-based) 반환.
 * @param {Element} blockEl - data-chapter-index, data-block-index 있는 블록 요소
 * @param {Range|null} range - 선택 범위. null이면 0 반환
 * @param {{ useEnd?: boolean }} opts - useEnd: true면 range 끝(focus) 기준
 * @returns {number} 0 이상, 블록 텍스트 길이 이하
 */
export const codePointOffsetInBlock = (blockEl, range, opts = {}) => {
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
