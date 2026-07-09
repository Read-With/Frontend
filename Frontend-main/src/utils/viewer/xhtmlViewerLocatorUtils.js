import {
  collectSanitizedStyleCssFromDocument,
  sanitizeXhtmlBodyHtml,
} from './sanitizeXhtml';
import {
  getChapterDataFromManifest,
  getEffectiveChapterLengthForProgress,
  locatorFromChapterLocalOffset,
  manifestChapterIndex,
} from '../common/cache/manifestCache';

/** 챕터당 단일 마커 노드(data-block-index 없음) 여부 */
function isSingleChapterMarkerBlob(el, rulerRoot) {
  if (!el || !rulerRoot?.querySelectorAll) return false;
  if (el.getAttribute('data-block-index') != null && el.getAttribute('data-block-index') !== '') {
    return false;
  }
  const ch = el.getAttribute('data-chapter-index');
  if (ch == null) return false;
  return rulerRoot.querySelectorAll(`[data-chapter-index="${ch}"]`).length === 1;
}

/** 단일 마커·다페이지일 때 blockIndex에 페이지 인덱스 인코딩 */
function shouldEncodePageInBlockIndex(el, rulerRoot, totalPages, pageHeightPx) {
  if (totalPages <= 1 || !isSingleChapterMarkerBlob(el, rulerRoot)) return false;
  const ph = pageHeightPx;
  if (!(ph > 0)) return true;
  return el.offsetHeight > ph * 1.12;
}

/** data-block-index 없으면 챕터별 문서 순서로 blockIndex 합성 */
export function collectBlockEntries(root) {
  if (!root?.querySelectorAll) return [];
  const withBlock = Array.from(root.querySelectorAll('[data-chapter-index][data-block-index]'));
  if (withBlock.length > 0) {
    return withBlock.map((el) => ({ el, syntheticBlock: null }));
  }
  const chapterOnly = Array.from(root.querySelectorAll('[data-chapter-index]'));
  if (chapterOnly.length === 0) return [];
  const perChapter = new Map();
  return chapterOnly.map((el) => {
    const ch = Number(el.getAttribute('data-chapter-index'));
    const next = perChapter.get(ch) ?? 0;
    perChapter.set(ch, next + 1);
    return { el, syntheticBlock: next };
  });
}


const getBlockLocator = (el, offset = 0, syntheticBlock = null) => {
  const ci = el.getAttribute('data-chapter-index');
  if (ci == null || !Number.isFinite(Number(ci))) return null;
  const rawBi = el.getAttribute('data-block-index');
  let blockIndex;
  if (rawBi != null && rawBi !== '') {
    blockIndex = Number(rawBi);
  } else if (syntheticBlock != null) {
    blockIndex = syntheticBlock;
  } else {
    blockIndex = 0;
  }
  if (!Number.isFinite(blockIndex)) blockIndex = 0;
  return {
    chapterIndex: Number(ci),
    blockIndex,
    offset: Number.isFinite(offset) ? offset : 0,
  };
};

/** 페이지 비율 → chapterIdx (weightedChapters 가중치 기준) */
const resolveChapterPagePositionByWeightedPageRatio = (
  weightedChapters,
  currentPageIndex,
  totalPages
) => {
  if (!Array.isArray(weightedChapters) || !weightedChapters.length) return null;
  const totalWeight = weightedChapters.reduce((sum, row) => {
    const w = Number(row?.weight ?? 0);
    return sum + (Number.isFinite(w) && w > 0 ? w : 0);
  }, 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;

  const ratio =
    totalPages <= 1
      ? 0
      : Math.min(1, Math.max(0, Number(currentPageIndex) / Math.max(1, totalPages - 1)));
  const absolutePos = Math.floor(totalWeight * ratio);

  let cumulative = 0;
  for (const row of weightedChapters) {
    const w = Number(row?.weight ?? 0);
    const safeW = Number.isFinite(w) && w > 0 ? w : 0;
    const chapterIdx = Number(row.chapterIdx);
    const start = cumulative;
    const end = cumulative + safeW;
    if (absolutePos >= start && absolutePos < end && Number.isFinite(chapterIdx) && chapterIdx >= 0) {
      return {
        chapterIdx,
        localRatio: safeW > 1 ? Math.min(1, Math.max(0, (absolutePos - start) / Math.max(1, safeW - 1))) : 0,
      };
    }
    cumulative = end;
  }

  const last = weightedChapters[weightedChapters.length - 1];
  const lastIdx = Number(last?.chapterIdx);
  return Number.isFinite(lastIdx) && lastIdx >= 0 ? { chapterIdx: lastIdx, localRatio: 1 } : null;
};

const resolveChapterPagePositionFromManifestByPage = (manifest, currentPageIndex, totalPages) => {
  const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];
  if (!chapters.length) return null;

  const weighted = chapters
    .map((ch) => {
      const chapterIdx = manifestChapterIndex(ch);
      if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
      const weight = getEffectiveChapterLengthForProgress(manifest, ch);
      return weight > 0 ? { chapterIdx, weight } : null;
    })
    .filter(Boolean);

  return resolveChapterPagePositionByWeightedPageRatio(weighted, currentPageIndex, totalPages);
};

const createFallbackLocator = (chapterIndex, blockIndex = 0, offset = 0) => ({
  startLocator: { chapterIndex, blockIndex, offset },
  endLocator: { chapterIndex, blockIndex, offset },
});

const resolveChapterCodePointLength = (manifest, chapterIndex) => {
  const ch = Number(chapterIndex);
  if (!Number.isFinite(ch) || ch < 1) return 0;

  const mChapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];
  const mHit = mChapters.find((row) => manifestChapterIndex(row) === ch);
  if (!mHit) return 0;

  return getEffectiveChapterLengthForProgress(manifest, mHit);
};

/** 단일-blob 챕터 locator → 페이지 인덱스 (신규: block=0+offset, 레거시: block=page) */
function pageIndexFromChapterLocator(manifest, locator, totalPages, el, ruler, pageHeightPx) {
  const total = Math.max(1, Number(totalPages) || 1);
  const chapter = Number(locator?.chapterIndex ?? locator?.chapterIdx);
  const block = Number(locator?.blockIndex ?? 0);
  const off = Number(locator?.offset ?? 0);
  if (!Number.isFinite(chapter) || chapter < 1) return null;

  const totalCp = resolveChapterCodePointLength(manifest, chapter);
  const pageEncoded = el && ruler && shouldEncodePageInBlockIndex(el, ruler, total, pageHeightPx);

  if (pageEncoded) {
    if (off > 0 && totalCp > 1) {
      const ratio = off / (totalCp - 1);
      return Math.min(total - 1, Math.max(0, Math.round(ratio * (total - 1))));
    }
    if (block > 0) {
      return Math.min(total - 1, Math.max(0, block));
    }
    return 0;
  }

  return null;
}

export function parseXhtmlBody(xhtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, 'text/html');
  const styleCss = collectSanitizedStyleCssFromDocument(doc);
  const rawBody = doc.body ? doc.body.innerHTML : xhtml;
  const bodyHTML = sanitizeXhtmlBodyHtml(rawBody);
  return { styleCss, bodyHTML };
}

function findChapterBlockElement(root, chapter, block = 0) {
  const ch = Number(chapter);
  const b = Number(block);
  const safeB = Number.isFinite(b) ? b : 0;
  if (!Number.isFinite(ch) || !root?.querySelector) return null;

  const tryChapter = (c) => {
    const byBoth = root.querySelector(`[data-chapter-index="${c}"][data-block-index="${safeB}"]`);
    if (byBoth) return byBoth;
    const list = Array.from(root.querySelectorAll(`[data-chapter-index="${c}"]`));
    if (!list.length) return null;
    const anyBlockAttr = list.some(
      (el) =>
        el.getAttribute('data-block-index') != null && el.getAttribute('data-block-index') !== ''
    );
    if (anyBlockAttr) {
      return list.find((el) => Number(el.getAttribute('data-block-index')) === safeB) ?? null;
    }
    return list[safeB] ?? list[0] ?? null;
  };

  let el = tryChapter(ch);
  if (!el && ch >= 1) el = tryChapter(ch - 1);
  return el;
}

export function normalizeLocatorTarget(target) {
  if (!target) return null;
  if (typeof target === 'string' && target.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(target);
      return parsed?.start ?? parsed?.startLocator ?? (Number.isFinite(parsed?.chapterIndex) ? parsed : null);
    } catch {
      return null;
    }
  }
  if (typeof target === 'object') {
    return target.start ?? target.startLocator ?? (Number.isFinite(target.chapterIndex) ? target : null);
  }
  return null;
}

/** locator → 페이지 인덱스 (displayAt·초기 seek 공용) */
export function resolvePageIndexFromLocator({
  locator,
  ruler,
  manifest,
  totalPages,
  pageHeightPx,
}) {
  if (!locator || !ruler) return null;

  const chapter = Number(locator.chapterIndex ?? locator.chapterIdx);
  const block = Number(locator.blockIndex ?? 0);
  if (!Number.isFinite(chapter)) return null;

  const el = findChapterBlockElement(ruler, chapter, block);
  if (!el) return null;

  const ph = pageHeightPx;
  const total = Math.max(1, Number(totalPages) || 1);
  if (!(ph > 0)) return null;

  const fromLocator = pageIndexFromChapterLocator(manifest, locator, total, el, ruler, ph);
  if (fromLocator != null) return fromLocator;

  const offset = Number(locator.offset ?? 0);
  if (offset > 0 && el.offsetHeight > ph) {
    const textLen = (el.textContent || '').length;
    if (textLen > 1) {
      const ratio = offset / (textLen - 1);
      const scrollInEl = ratio * Math.max(0, el.offsetHeight - ph);
      return Math.min(total - 1, Math.max(0, Math.floor((el.offsetTop + scrollInEl) / ph)));
    }
  }

  return Math.min(total - 1, Math.max(0, Math.floor(el.offsetTop / ph)));
}

export function computeLineBoundsFromRuler(ruler) {
  if (!ruler?.firstChild || typeof document === 'undefined') return [];
  try {
    const range = document.createRange();
    range.selectNodeContents(ruler);
    const rects = range.getClientRects();
    const rulerRect = ruler.getBoundingClientRect();
    return Array.from(rects)
      .map((r) => ({ top: r.top - rulerRect.top, bottom: r.bottom - rulerRect.top }))
      .filter((b) => b.bottom > b.top)
      .sort((a, b) => a.top - b.top);
  } catch {
    return [];
  }
}

export function contentPaddingFromMargin(margin) {
  const m = Number(margin);
  const px = Number.isFinite(m) && m >= 0 ? m : 20;
  return { padding: px, paddingBottom: px + 8 };
}

/**
 * 현재 뷰포트에서 emit할 locator를 계산한다.
 * @returns {{ kind: 'emit', loc: object, persistLoc: object|null, linePosition: number } | { kind: 'skip' }}
 */
export function resolveViewportLocatorEmit({
  blockEntries,
  viewportRect,
  rulerRoot,
  manifest,
  currentPageIndex,
  totalPages,
  pageHeight,
  snapOffsetY,
  snapVisibleHeight,
  prevStartLocator,
}) {
  const chapterPagePosition = resolveChapterPagePositionFromManifestByPage(
    manifest,
    currentPageIndex,
    totalPages
  );
  const resolvedChapter = chapterPagePosition?.chapterIdx ?? null;
  const chapterLocalPageRatio = Number.isFinite(chapterPagePosition?.localRatio)
    ? Math.min(1, Math.max(0, chapterPagePosition.localRatio))
    : 0;
  const chapterCodePointLength = resolveChapterCodePointLength(manifest, resolvedChapter);

  const estimateChapterOffsetByPage = () => {
    if (!Number.isFinite(chapterCodePointLength) || chapterCodePointLength <= 1) return 0;
    return Math.min(
      chapterCodePointLength - 1,
      Math.max(0, Math.floor((chapterCodePointLength - 1) * chapterLocalPageRatio))
    );
  };

  const shouldEmitFallbackLocator = (chapterIndex, fallbackOffset) => {
    if (!Number.isFinite(chapterIndex) || chapterIndex < 0) return false;
    if (!prevStartLocator) return true;
    const prevChapter = Number(prevStartLocator.chapterIndex);
    const prevOffset = Number(prevStartLocator.offset ?? 0);
    if (!Number.isFinite(prevChapter)) return true;
    if (prevChapter !== chapterIndex) return true;
    return prevOffset !== fallbackOffset;
  };

  const buildFallbackResult = () => {
    const fallbackOffset = estimateChapterOffsetByPage();
    if (
      !Number.isFinite(resolvedChapter) ||
      resolvedChapter < 1 ||
      !shouldEmitFallbackLocator(Number(resolvedChapter), fallbackOffset)
    ) {
      return { kind: 'skip' };
    }
    const chapterData = getChapterDataFromManifest(manifest, Number(resolvedChapter));
    const startLoc = chapterData
      ? locatorFromChapterLocalOffset(chapterData, fallbackOffset)
      : null;
    const loc = startLoc
      ? { startLocator: startLoc, endLocator: startLoc }
      : createFallbackLocator(resolvedChapter, 0, fallbackOffset);
    return { kind: 'emit', loc, persistLoc: null, linePosition: currentPageIndex };
  };

  if (!Array.isArray(blockEntries) || !blockEntries.length) {
    return buildFallbackResult();
  }

  if (!viewportRect || viewportRect.height < 8) {
    return { kind: 'skip' };
  }

  const phForBlob = typeof pageHeight === 'number' && pageHeight > 0 ? pageHeight : 0;
  const visible = blockEntries
    .map(({ el, syntheticBlock }) => {
      const rect = el.getBoundingClientRect();
      const top = rect.top - viewportRect.top;
      const bottom = rect.bottom - viewportRect.top;
      const overlap = Math.min(bottom, viewportRect.height) - Math.max(top, 0);
      return { el, syntheticBlock, top, bottom, overlap };
    })
    .filter((item) => item.overlap > 0)
    .sort((a, b) => a.top - b.top);

  if (!visible.length) {
    return buildFallbackResult();
  }

  const startRow = visible[0];
  const endRow = visible[visible.length - 1];
  const pageInBlock =
    rulerRoot &&
    visible.length === 1 &&
    shouldEncodePageInBlockIndex(startRow.el, rulerRoot, totalPages, phForBlob);

  const estimateOffsetInSingleBlob = () => {
    if (!pageInBlock) return 0;
    const totalCp = chapterCodePointLength;
    if (!Number.isFinite(totalCp) || totalCp <= 1) return 0;
    const elementTop = Number(startRow.el.offsetTop);
    const elementHeight = Number(startRow.el.offsetHeight);
    const viewportHeight = Number(snapVisibleHeight || pageHeight || 0);
    const viewportStartInElement = Number(snapOffsetY) - elementTop;
    const ratio =
      Number.isFinite(elementTop) &&
      Number.isFinite(elementHeight) &&
      elementHeight > 0 &&
      Number.isFinite(viewportStartInElement)
        ? Math.min(1, Math.max(0, viewportStartInElement / Math.max(1, elementHeight - viewportHeight)))
        : chapterLocalPageRatio;
    return Math.min(totalCp - 1, Math.max(0, Math.floor((totalCp - 1) * ratio)));
  };

  const singleBlobOffset = estimateOffsetInSingleBlob();
  const startBlockIndex = pageInBlock ? 0 : startRow.syntheticBlock;
  const endBlockIndex = pageInBlock ? 0 : endRow.syntheticBlock;
  const startOffset = pageInBlock ? singleBlobOffset : 0;
  const endOffset = pageInBlock
    ? singleBlobOffset
    : Math.max(0, (endRow.el.textContent || '').length);
  const logicalStartLoc = getBlockLocator(startRow.el, startOffset, startBlockIndex);
  const logicalEndLoc = getBlockLocator(endRow.el, endOffset, endBlockIndex);
  if (!logicalStartLoc || !logicalEndLoc) return { kind: 'skip' };

  const loc = {
    startLocator: logicalStartLoc,
    endLocator: logicalEndLoc,
  };
  return { kind: 'emit', loc, persistLoc: loc, linePosition: currentPageIndex };
}
