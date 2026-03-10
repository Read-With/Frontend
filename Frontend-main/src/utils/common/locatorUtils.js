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

const toNumber = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export const anchorToLocators = (anchor) => {
  if (!anchor) return { startLocator: null, endLocator: null };
  const start = toLocator(anchor.start ?? anchor);
  const end = toLocator(anchor.end ?? anchor.start ?? anchor);
  return {
    startLocator: start,
    endLocator: end ?? start,
  };
};

export const progressPayloadFromData = (data) => {
  if (!data?.bookId) return null;
  const start = data.startLocator ?? (data.anchor && (toLocator(data.anchor.start) ?? toLocator(data.anchor)));
  const end = data.endLocator ?? (data.anchor && (toLocator(data.anchor.end) ?? toLocator(data.anchor.start) ?? toLocator(data.anchor)));
  if (!start) return null;
  return {
    bookId: data.bookId,
    startLocator: start,
    endLocator: end ?? start,
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
