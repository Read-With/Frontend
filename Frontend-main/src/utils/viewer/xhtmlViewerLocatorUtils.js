import {
  collectSanitizedStyleCssFromDocument,
  sanitizeXhtmlBodyHtml,
} from './sanitizeXhtml';
import {
  getChapterDataFromManifest,
  getEffectiveChapterLengthForProgress,
  locatorFromChapterLocalOffset,
  chapterLocalOffsetFromLocator,
} from '../common/cache/manifestCache';
import { resolveChapterIndex } from '../common/valueUtils';

function clamp01(n) {
  return Math.min(1, Math.max(0, Number(n) || 0));
}

function safePageTotal(totalPages) {
  return Math.max(1, Number(totalPages) || 1);
}

function pageIndexFromScrollY(scrollY, pageHeightPx, totalPages) {
  const total = safePageTotal(totalPages);
  return Math.min(total - 1, Math.max(0, Math.floor(scrollY / pageHeightPx)));
}

/** 챕터(요소) 로컬 비율 → 해당 요소 offsetTop 기준 페이지 (책 전체 ratio 매핑 금지) */
function pageIndexFromElementLocalRatio(el, ratio, pageHeightPx, totalPages) {
  const ph = Number(pageHeightPx);
  if (!el || !(ph > 0)) return null;
  const maxScroll = Math.max(0, Number(el.offsetHeight) - ph);
  const scrollY = Number(el.offsetTop) + clamp01(ratio) * maxScroll;
  if (!Number.isFinite(scrollY)) return null;
  return pageIndexFromScrollY(scrollY, ph, totalPages);
}

function offsetFromRatio(totalCp, ratio) {
  if (!Number.isFinite(totalCp) || totalCp <= 1) return 0;
  return Math.min(totalCp - 1, Math.max(0, Math.floor((totalCp - 1) * clamp01(ratio))));
}

function hasBlockIndexAttr(el) {
  const v = el?.getAttribute?.('data-block-index');
  return v != null && v !== '';
}

function hasParagraphStarts(chapterData) {
  return Array.isArray(chapterData?.paragraphStarts) && chapterData.paragraphStarts.length > 0;
}

function positiveWeight(value) {
  const w = Number(value ?? 0);
  return Number.isFinite(w) && w > 0 ? w : 0;
}

/** 챕터당 단일 마커 노드(data-block-index 없음) 여부 */
function isSingleChapterMarkerBlob(el, rulerRoot) {
  if (!el || !rulerRoot?.querySelectorAll || hasBlockIndexAttr(el)) return false;
  const ch = el.getAttribute('data-chapter-index');
  if (ch == null) return false;
  return rulerRoot.querySelectorAll(`[data-chapter-index="${ch}"]`).length === 1;
}

/** 단일 마커·다페이지일 때 blockIndex에 페이지 인덱스 인코딩 */
function shouldEncodePageInBlockIndex(el, rulerRoot, totalPages, pageHeightPx) {
  if (totalPages <= 1 || !isSingleChapterMarkerBlob(el, rulerRoot)) return false;
  if (!(pageHeightPx > 0)) return true;
  return el.offsetHeight > pageHeightPx * 1.12;
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

function getBlockLocator(el, offset = 0, syntheticBlock = null) {
  const ci = el.getAttribute('data-chapter-index');
  if (ci == null || !Number.isFinite(Number(ci))) return null;

  const rawBi = el.getAttribute('data-block-index');
  let blockIndex = 0;
  if (rawBi != null && rawBi !== '') blockIndex = Number(rawBi);
  else if (syntheticBlock != null) blockIndex = syntheticBlock;
  if (!Number.isFinite(blockIndex)) blockIndex = 0;

  return {
    chapterIndex: Number(ci),
    blockIndex,
    offset: Number.isFinite(offset) ? offset : 0,
  };
}

/** 페이지 비율 → chapterIdx (weightedChapters 가중치 기준) */
function resolveChapterPagePositionByWeightedPageRatio(
  weightedChapters,
  currentPageIndex,
  totalPages
) {
  if (!Array.isArray(weightedChapters) || !weightedChapters.length) return null;

  const totalWeight = weightedChapters.reduce((sum, row) => sum + positiveWeight(row?.weight), 0);
  if (!(totalWeight > 0)) return null;

  const ratio =
    totalPages <= 1
      ? 0
      : clamp01(Number(currentPageIndex) / Math.max(1, totalPages - 1));
  const absolutePos = Math.floor(totalWeight * ratio);

  let cumulative = 0;
  for (const row of weightedChapters) {
    const safeW = positiveWeight(row?.weight);
    const chapterIdx = Number(row.chapterIdx);
    const start = cumulative;
    const end = cumulative + safeW;
    if (absolutePos >= start && absolutePos < end && Number.isFinite(chapterIdx) && chapterIdx >= 0) {
      return {
        chapterIdx,
        localRatio:
          safeW > 1
            ? clamp01((absolutePos - start) / Math.max(1, safeW - 1))
            : 0,
      };
    }
    cumulative = end;
  }

  const lastIdx = Number(weightedChapters[weightedChapters.length - 1]?.chapterIdx);
  return Number.isFinite(lastIdx) && lastIdx >= 0 ? { chapterIdx: lastIdx, localRatio: 1 } : null;
}

function resolveChapterPagePositionFromManifestByPage(manifest, currentPageIndex, totalPages) {
  const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];
  if (!chapters.length) return null;

  const weighted = chapters
    .map((ch) => {
      const chapterIdx = resolveChapterIndex(ch);
      if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
      const weight = getEffectiveChapterLengthForProgress(manifest, ch);
      return weight > 0 ? { chapterIdx, weight } : null;
    })
    .filter(Boolean);

  return resolveChapterPagePositionByWeightedPageRatio(weighted, currentPageIndex, totalPages);
}

function createFallbackLocator(chapterIndex, offset = 0) {
  const loc = { chapterIndex, blockIndex: 0, offset };
  return {
    startLocator: loc,
    endLocator: loc,
  };
}

function resolveChapterCodePointLength(manifest, chapterIndex) {
  const ch = Number(chapterIndex);
  if (!Number.isFinite(ch) || ch < 1) return 0;

  const mHit = (Array.isArray(manifest?.chapters) ? manifest.chapters : []).find(
    (row) => resolveChapterIndex(row) === ch
  );
  return mHit ? getEffectiveChapterLengthForProgress(manifest, mHit) : 0;
}

export function parseXhtmlBody(xhtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, 'text/html');
  const styleCss = collectSanitizedStyleCssFromDocument(doc);
  const rawBody = doc.body ? doc.body.innerHTML : xhtml;
  return { styleCss, bodyHTML: sanitizeXhtmlBodyHtml(rawBody) };
}

function findChapterBlockElement(root, chapter, block = 0) {
  const ch = Number(chapter);
  const safeB = Number.isFinite(Number(block)) ? Number(block) : 0;
  if (!Number.isFinite(ch) || !root?.querySelector) return null;

  const tryChapter = (c) => {
    const byBoth = root.querySelector(
      `[data-chapter-index="${c}"][data-block-index="${safeB}"]`
    );
    if (byBoth) return byBoth;

    const list = Array.from(root.querySelectorAll(`[data-chapter-index="${c}"]`));
    if (!list.length) return null;
    if (list.some(hasBlockIndexAttr)) {
      return list.find((el) => Number(el.getAttribute('data-block-index')) === safeB) ?? null;
    }
    return list[safeB] ?? list[0] ?? null;
  };

  return tryChapter(ch) ?? (ch >= 1 ? tryChapter(ch - 1) : null);
}

function unwrapLocatorObject(obj) {
  if (!obj || typeof obj !== 'object') return null;
  return obj.start ?? obj.startLocator ?? (resolveChapterIndex(obj) != null ? obj : null);
}

export function normalizeLocatorTarget(target) {
  if (!target || typeof target !== 'object') return null;
  return unwrapLocatorObject(target);
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

  const chapter = resolveChapterIndex(locator);
  const block = Number(locator.blockIndex ?? 0);
  if (!Number.isFinite(chapter)) return null;

  const ph = pageHeightPx;
  const total = safePageTotal(totalPages);
  if (!(ph > 0)) return null;

  const chapterData = getChapterDataFromManifest(manifest, chapter);
  const totalCp = resolveChapterCodePointLength(manifest, chapter);
  const el0 = findChapterBlockElement(ruler, chapter, 0);
  const elBlock = findChapterBlockElement(ruler, chapter, block);

  // 단일 blob / 블록 미매칭: 챕터 로컬 비율을 해당 챕터 요소 구간으로 매핑
  if (totalCp > 1 && el0 && (isSingleChapterMarkerBlob(el0, ruler) || !elBlock)) {
    let ratio = null;
    if (hasParagraphStarts(chapterData)) {
      ratio = chapterLocalOffsetFromLocator(chapterData, locator) / (totalCp - 1);
    } else {
      const offset = Number(locator.offset ?? 0);
      const textLen = (el0.textContent || '').length;
      if (textLen > 1) ratio = clamp01(offset / (textLen - 1));
    }
    if (ratio != null) {
      return pageIndexFromElementLocalRatio(el0, ratio, ph, total);
    }
    return pageIndexFromScrollY(el0.offsetTop, ph, total);
  }

  const el = elBlock ?? el0;
  if (!el) return null;

  if (el.offsetHeight > ph) {
    let ratio = null;
    if (hasParagraphStarts(chapterData) && totalCp > 1) {
      ratio = chapterLocalOffsetFromLocator(chapterData, locator) / (totalCp - 1);
    } else {
      const offset = Number(locator.offset ?? 0);
      const textLen = (el.textContent || '').length;
      if (offset > 0 && textLen > 1) ratio = offset / (textLen - 1);
    }
    if (ratio != null) {
      return pageIndexFromElementLocalRatio(el, ratio, ph, total);
    }
  }

  return pageIndexFromScrollY(el.offsetTop, ph, total);
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
 * @returns {{ kind: 'emit', loc: object } | { kind: 'skip' }}
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
    ? clamp01(chapterPagePosition.localRatio)
    : 0;
  const chapterCodePointLength = resolveChapterCodePointLength(manifest, resolvedChapter);

  const shouldEmitFallbackLocator = (chapterIndex, fallbackOffset) => {
    if (!Number.isFinite(chapterIndex) || chapterIndex < 0) return false;
    if (!prevStartLocator) return true;
    const prevChapter = resolveChapterIndex(prevStartLocator);
    if (!Number.isFinite(prevChapter) || prevChapter !== chapterIndex) return true;
    return Number(prevStartLocator.offset ?? 0) !== fallbackOffset;
  };

  const buildFallbackResult = () => {
    const fallbackOffset = offsetFromRatio(chapterCodePointLength, chapterLocalPageRatio);
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
      : createFallbackLocator(resolvedChapter, fallbackOffset);
    return { kind: 'emit', loc };
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

  if (!visible.length) return buildFallbackResult();

  const startRow = visible[0];
  const endRow = visible[visible.length - 1];
  const pageInBlock =
    Boolean(rulerRoot) &&
    visible.length === 1 &&
    shouldEncodePageInBlockIndex(startRow.el, rulerRoot, totalPages, phForBlob);

  let singleBlobOffset = 0;
  if (pageInBlock && Number.isFinite(chapterCodePointLength) && chapterCodePointLength > 1) {
    const elementTop = Number(startRow.el.offsetTop);
    const elementHeight = Number(startRow.el.offsetHeight);
    const viewportHeight = Number(snapVisibleHeight || pageHeight || 0);
    const viewportStartInElement = Number(snapOffsetY) - elementTop;
    const ratio =
      Number.isFinite(elementTop) &&
      Number.isFinite(elementHeight) &&
      elementHeight > 0 &&
      Number.isFinite(viewportStartInElement)
        ? clamp01(viewportStartInElement / Math.max(1, elementHeight - viewportHeight))
        : chapterLocalPageRatio;
    singleBlobOffset = offsetFromRatio(chapterCodePointLength, ratio);
  }

  const startOffset = pageInBlock ? singleBlobOffset : 0;
  const endOffset = pageInBlock
    ? singleBlobOffset
    : Math.max(0, (endRow.el.textContent || '').length);
  const logicalStartLoc = getBlockLocator(
    startRow.el,
    startOffset,
    pageInBlock ? 0 : startRow.syntheticBlock
  );
  const logicalEndLoc = getBlockLocator(
    endRow.el,
    endOffset,
    pageInBlock ? 0 : endRow.syntheticBlock
  );
  if (!logicalStartLoc || !logicalEndLoc) return { kind: 'skip' };

  return {
    kind: 'emit',
    loc: { startLocator: logicalStartLoc, endLocator: logicalEndLoc },
  };
}
