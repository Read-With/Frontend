import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
} from 'react';
import { flushSync } from 'react-dom';
import { loadCombinedXhtml, loadBookMeta } from '../../../utils/normalizedContent';
import { defaultSettings } from '../../../utils/common/settingsUtils';
import {
  sanitizeXhtmlBodyHtml,
  collectSanitizedStyleCssFromDocument,
} from '../../../utils/viewer/sanitizeXhtml';
import { getManifestFromCache } from '../../../utils/common/cache/manifestCache';
import { isXhtmlBlocksDebug } from '../../../utils/viewer/xhtmlBlockDebug';

const xhtmlLoadCache = new Map();
const XHTML_LOAD_CACHE_VERSION = 'v2';

/** 챕터당 data-chapter-index 노드가 하나뿐이고 data-block-index 없음 → transform 페이징만으로는 항상 같은 노드만 겹침 */
function isSingleChapterMarkerBlob(el, rulerRoot) {
  if (!el || !rulerRoot?.querySelectorAll) return false;
  if (el.getAttribute('data-block-index') != null && el.getAttribute('data-block-index') !== '') {
    return false;
  }
  const ch = el.getAttribute('data-chapter-index');
  if (ch == null) return false;
  return rulerRoot.querySelectorAll(`[data-chapter-index="${ch}"]`).length === 1;
}

/** 이런 DOM에서는 blockIndex에 뷰어 페이지 인덱스를 넣어 저장·복원 (서버 v2 locator 재사용) */
function shouldEncodePageInBlockIndex(el, rulerRoot, totalPages, pageHeightPx) {
  if (totalPages <= 1 || !isSingleChapterMarkerBlob(el, rulerRoot)) return false;
  const ph = pageHeightPx;
  if (!(ph > 0)) return true;
  return el.offsetHeight > ph * 1.12;
}

/** data-block-index 없으면 챕터별 문서 순서로 0,1,2… 합성 (정규화 산출물 편차 대응) */
function collectBlockEntries(root) {
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

/** 숫자 서버 id가 있으면 매니페스트·API 캐시 키와 맞춤 (폴더명만 쓰면 combined 경로 영구 실패하는 책 방지) */
function resolveLoaderBookId(book, bookIdProp) {
  const candidates = [bookIdProp, book?.id, book?._bookId];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return String(n);
  }
  const raw = bookIdProp ?? book?.id ?? book?.filename ?? '';
  return String(raw).trim();
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

/** 페이지 비율 → 챕터 idx (가중치 배열: { chapterIdx, weight }) */
const resolveChapterByWeightedPageRatio = (weightedChapters, currentPageIndex, totalPages) => {
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
      return chapterIdx;
    }
    cumulative = end;
  }

  const last = weightedChapters[weightedChapters.length - 1];
  const lastIdx = Number(last?.chapterIdx);
  return Number.isFinite(lastIdx) && lastIdx >= 0 ? lastIdx : null;
};

const resolveChapterFromMetaByPage = (meta, currentPageIndex, totalPages) => {
  const chapters = Array.isArray(meta?.chapters) ? meta.chapters : [];
  if (!chapters.length) return null;

  const weighted = chapters
    .map((chapter) => {
      const len = Number(chapter?.totalCodePoints ?? 0);
      const chapterIdx = Number(chapter?.chapterIndex ?? chapter?.chapterIdx ?? chapter?.idx);
      if (!Number.isFinite(chapterIdx)) return null;
      return {
        chapterIdx,
        weight: Number.isFinite(len) && len > 0 ? len : 0,
      };
    })
    .filter(Boolean);

  return resolveChapterByWeightedPageRatio(weighted, currentPageIndex, totalPages);
};

const resolveChapterFromManifestByPage = (manifest, currentPageIndex, totalPages) => {
  const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];
  if (!chapters.length) return null;

  const lengths = Array.isArray(manifest?.progressMetadata?.chapterLengths)
    ? manifest.progressMetadata.chapterLengths
    : [];

  const resolveLengthFromTable = (ch, listIndex) => {
    const title = String(ch?.title ?? ch?.chapterTitle ?? '').trim();
    if (title) {
      const hit = lengths.find((e) => String(e?.chapterTitle ?? e?.title ?? '').trim() === title);
      if (hit) {
        const len = Number(hit.length ?? hit.codePointLength ?? 0);
        if (Number.isFinite(len) && len > 0) return len;
      }
    }
    const idx = Number(ch?.idx ?? ch?.chapterIdx);
    const hit = lengths.find((e) => Number(e?.chapterIdx ?? e?.chapterIndex ?? e?.idx) === idx);
    if (hit) {
      const len = Number(hit.length ?? hit.codePointLength ?? 0);
      if (Number.isFinite(len) && len > 0) return len;
    }
    if (
      lengths.length === chapters.length &&
      listIndex >= 0 &&
      listIndex < lengths.length &&
      lengths[listIndex]
    ) {
      const len = Number(lengths[listIndex].length ?? lengths[listIndex].codePointLength ?? 0);
      if (Number.isFinite(len) && len > 0) return len;
    }
    return 0;
  };

  const fromTable = chapters
    .map((ch, i) => {
      const chapterIdx = Number(ch?.idx ?? ch?.chapterIdx);
      if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
      const length = lengths.length ? resolveLengthFromTable(ch, i) : 0;
      return { chapterIdx, weight: length };
    })
    .filter(Boolean);

  if (lengths.length > 0 && fromTable.length) {
    const totalFromTable = fromTable.reduce((s, r) => s + r.weight, 0);
    if (totalFromTable > 0) {
      const hit = resolveChapterByWeightedPageRatio(fromTable, currentPageIndex, totalPages);
      if (hit != null) return hit;
    }
  }

  const fromCodePoints = chapters
    .map((ch) => {
      const chapterIdx = Number(ch?.idx ?? ch?.chapterIdx);
      if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
      const len = Number(ch?.totalCodePoints ?? 0);
      return {
        chapterIdx,
        weight: Number.isFinite(len) && len > 0 ? len : 0,
      };
    })
    .filter(Boolean);

  return resolveChapterByWeightedPageRatio(fromCodePoints, currentPageIndex, totalPages);
};

const createFallbackLocator = (chapterIndex) => ({
  startLocator: { chapterIndex, blockIndex: 0, offset: 0 },
  endLocator: { chapterIndex, blockIndex: 0, offset: 0 },
});

function parseXhtmlBody(xhtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, 'text/html');
  const styleCss = collectSanitizedStyleCssFromDocument(doc);
  const rawBody = doc.body ? doc.body.innerHTML : xhtml;
  const bodyHTML = sanitizeXhtmlBodyHtml(rawBody);
  return { styleCss, bodyHTML };
}

function buildFallbackMetaFromXhtml(xhtml) {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xhtml, 'text/html');
    const root = doc.body || doc.documentElement;
    const entries = collectBlockEntries(root);
    if (!entries.length) return null;

    const byChapter = new Map();
    entries.forEach(({ el }) => {
      const chapterIndex = Number(el.getAttribute('data-chapter-index'));
      if (!Number.isFinite(chapterIndex)) return;
      const textLen = (el.textContent || '').length;
      const prev = byChapter.get(chapterIndex) || 0;
      byChapter.set(chapterIndex, prev + Math.max(0, textLen));
    });

    const chapters = [...byChapter.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([chapterIndex, totalCodePoints]) => ({
        chapterIndex,
        paragraphStarts: [],
        paragraphLengths: [],
        totalCodePoints,
      }));

    return chapters.length ? { chapters } : null;
  } catch {
    return null;
  }
}

const XhtmlViewer = forwardRef(
  (
    {
      book,
      bookId,
      onProgressChange,
      onCurrentPageChange,
      onTotalPagesChange,
      onCurrentChapterChange,
      onCurrentLineChange,
      settings = defaultSettings,
      initialAnchor,
      manifestReady = true,
    },
    ref
  ) => {
    const containerRef = useRef(null);
    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const rulerRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [xhtmlContent, setXhtmlContent] = useState(null);
    const [pageHeight, setPageHeight] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const touchStartX = useRef(0);
    const lastLocatorRef = useRef(null);
    const lastEmittedStartLocatorJsonRef = useRef(null);
    const metaRef = useRef(null);
    const initialAnchorAppliedRef = useRef(false);
    const prevBidForInitialRef = useRef(null);
    const initialPositionAppliedRef = useRef(false);
    const initialSeekAppliedRef = useRef(false);
    const lineBoundsRef = useRef([]);
    const [lineBoundsVersion, setLineBoundsReady] = useState(0);
    const lastReportedPagingRef = useRef({
      totalPages: null,
      currentPage: null,
      progress: null,
    });

    const getSnappedOffsetAndHeight = useCallback((pageIdx, pH) => {
      const targetY = pageIdx * pH;
      const lines = lineBoundsRef.current;
      if (!lines.length) return { offsetY: Math.max(0, targetY), visibleHeight: pH };
      let offsetY = 0;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].top <= targetY) {
          offsetY = lines[i].top;
          break;
        }
      }
      const endY = offsetY + pH;
      let visibleEnd = endY;
      for (let j = lines.length - 1; j >= 0; j--) {
        if (lines[j].bottom <= endY) {
          visibleEnd = lines[j].bottom;
          break;
        }
      }
      const visibleHeight = Math.min(pH, Math.max(0, visibleEnd - offsetY)) || pH;
      return { offsetY, visibleHeight };
    }, []);

    const currentSnap = useMemo(
      () => getSnappedOffsetAndHeight(currentPageIndex, pageHeight || 1),
      [currentPageIndex, pageHeight, lineBoundsVersion, getSnappedOffsetAndHeight]
    );

    const contentHtml = useMemo(() => (xhtmlContent ? { __html: xhtmlContent.bodyHTML } : { __html: '' }), [xhtmlContent]);
    const viewportStyle = useMemo(
      () => ({ height: currentSnap.visibleHeight || '100%', overflow: 'hidden' }),
      [currentSnap.visibleHeight]
    );
    const contentStyle = useMemo(
      () => ({ transform: `translateY(-${currentSnap.offsetY}px)` }),
      [currentSnap.offsetY]
    );

    const totalPages = Math.max(1, pageHeight ? Math.ceil(contentHeight / pageHeight) : 1);
    const currentPage = Math.min(totalPages, currentPageIndex + 1);
    const progress = totalPages <= 1 ? 0 : Math.round((currentPageIndex / (totalPages - 1)) * 100);

    const bid = useMemo(() => resolveLoaderBookId(book, bookId), [book, bookId]);

    useEffect(() => {
      if (prevBidForInitialRef.current === bid) return;
      prevBidForInitialRef.current = bid;
      initialSeekAppliedRef.current = false;
      initialPositionAppliedRef.current = false;
      initialAnchorAppliedRef.current = false;
      lastEmittedStartLocatorJsonRef.current = null;
      lastLocatorRef.current = null;
    }, [bid]);

    const emitLocator = useCallback(
      (loc) => {
        if (!loc?.startLocator) return;
        const startKey = JSON.stringify(loc.startLocator);
        if (startKey === lastEmittedStartLocatorJsonRef.current) return;
        lastEmittedStartLocatorJsonRef.current = startKey;
        lastLocatorRef.current = loc;
        const { chapterIndex } = loc.startLocator;
        onCurrentChapterChange?.(chapterIndex);
        onCurrentLineChange?.(0, 0, { anchor: loc });
      },
      [onCurrentChapterChange, onCurrentLineChange]
    );

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        if (!bid) {
          setError('책 정보가 없습니다.');
          setLoading(false);
          return;
        }
        if (
          !manifestReady &&
          !(typeof book?.combinedXhtmlContent === 'string' && book.combinedXhtmlContent.trim()) &&
          !(typeof book?.combinedXhtmlUrl === 'string' && book.combinedXhtmlUrl.trim())
        ) {
          setLoading(true);
          setError(null);
          return;
        }
        setLoading(true);
        setError(null);
        initialAnchorAppliedRef.current = false;
        try {
          const hasInline = typeof book?.combinedXhtmlContent === 'string' && book.combinedXhtmlContent.trim().length > 0;
          const hasUrl = typeof book?.combinedXhtmlUrl === 'string' && book.combinedXhtmlUrl.trim().length > 0;
          const cacheKey = `${XHTML_LOAD_CACHE_VERSION}::${bid}::${hasInline ? 'inline' : 'no-inline'}::${hasUrl ? 'url' : 'no-url'}`;
          let loadPromise = xhtmlLoadCache.get(cacheKey);
          if (!loadPromise) {
            loadPromise = Promise.all([
              loadCombinedXhtml(bid, book || {}),
              loadBookMeta(bid),
            ]);
            xhtmlLoadCache.set(cacheKey, loadPromise);
          }
          const [raw, meta] = await loadPromise;
          if (cancelled) return;
          const fallbackMeta = meta || buildFallbackMetaFromXhtml(raw);
          metaRef.current = fallbackMeta;
          const { styleCss, bodyHTML } = parseXhtmlBody(raw);
          setXhtmlContent({ styleCss, bodyHTML });
        } catch (e) {
          if (!cancelled) {
            setError(e?.message || '로드 실패');
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      load();
      return () => { cancelled = true; };
    }, [bid, book?.combinedXhtmlContent, book?.combinedXhtmlUrl, manifestReady]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const ro = new ResizeObserver(() => {
        const next = container.clientHeight;
        setPageHeight((prev) => (prev === next ? prev : next));
      });
      ro.observe(container);
      setPageHeight((prev) => {
        const next = container.clientHeight;
        return prev === next ? prev : next;
      });
      return () => ro.disconnect();
    }, [xhtmlContent]);

    useEffect(() => {
      const ruler = rulerRef.current;
      if (!ruler) return;
      setContentHeight((prev) => {
        const next = ruler.offsetHeight;
        return prev === next ? prev : next;
      });
      const ro = new ResizeObserver(() => {
        const next = ruler.offsetHeight;
        setContentHeight((prev) => (prev === next ? prev : next));
      });
      ro.observe(ruler);
      return () => ro.disconnect();
    }, [xhtmlContent]);

    useLayoutEffect(() => {
      const ruler = rulerRef.current;
      if (!xhtmlContent || !ruler || !ruler.firstChild) return;
      try {
        const range = document.createRange();
        range.selectNodeContents(ruler);
        const rects = range.getClientRects();
        const rulerRect = ruler.getBoundingClientRect();
        const bounds = Array.from(rects)
          .map((r) => ({ top: r.top - rulerRect.top, bottom: r.bottom - rulerRect.top }))
          .filter((b) => b.bottom > b.top)
          .sort((a, b) => a.top - b.top);
        lineBoundsRef.current = bounds;
        setLineBoundsReady((v) => v + 1);
      } catch {
        lineBoundsRef.current = [];
      }
    }, [xhtmlContent, contentHeight, settings?.fontSize, settings?.lineHeight]);

    useEffect(() => {
      const prev = lastReportedPagingRef.current;
      if (prev.totalPages !== totalPages) {
        onTotalPagesChange?.(totalPages);
      }
      if (prev.currentPage !== currentPage) {
        onCurrentPageChange?.(currentPage);
      }
      if (prev.progress !== progress) {
        onProgressChange?.(progress);
      }
      lastReportedPagingRef.current = { totalPages, currentPage, progress };
    }, [totalPages, currentPage, progress, onTotalPagesChange, onCurrentPageChange, onProgressChange]);

    useEffect(() => {
      if (!xhtmlContent || !contentRef.current || !viewportRef.current) return;
      const content = contentRef.current;
      const viewport = viewportRef.current;
      const blockEntries = collectBlockEntries(content);

      const cacheId = Number(bid);
      const manifest =
        Number.isFinite(cacheId) && cacheId > 0 ? getManifestFromCache(cacheId) : null;
      const chapterFromMeta = resolveChapterFromMetaByPage(metaRef.current, currentPageIndex, totalPages);
      const chapterFromManifest = resolveChapterFromManifestByPage(manifest, currentPageIndex, totalPages);
      const resolvedChapter = chapterFromManifest ?? chapterFromMeta;
      const emitResolvedFallback = () => {
        if (Number.isFinite(resolvedChapter) && resolvedChapter >= 0) {
          emitLocator(createFallbackLocator(resolvedChapter));
        }
      };

      if (!blockEntries.length) {
        if (isXhtmlBlocksDebug()) {
          console.warn('[XhtmlBlocks]', {
            bid,
            currentPageIndex,
            totalPages,
            reason: 'DOM에 data-chapter-index 마커 없음',
          });
        }
        emitResolvedFallback();
        return;
      }

      const root = viewport.getBoundingClientRect();
      if (root.height < 8) {
        if (isXhtmlBlocksDebug()) {
          console.warn('[XhtmlBlocks]', {
            bid,
            currentPageIndex,
            totalPages,
            reason: '뷰포트 높이 미측정 — 레이아웃 후 재실행 대기',
            viewportH: Math.round(root.height),
          });
        }
        return;
      }

      const rulerRoot = rulerRef.current;
      const phForBlob = typeof pageHeight === 'number' && pageHeight > 0 ? pageHeight : 0;
      const visible = blockEntries
        .map(({ el, syntheticBlock }) => {
          const rect = el.getBoundingClientRect();
          const top = rect.top - root.top;
          const bottom = rect.bottom - root.top;
          const overlap = Math.min(bottom, root.height) - Math.max(top, 0);
          return { el, syntheticBlock, top, bottom, overlap };
        })
        .filter((item) => item.overlap > 0)
        .sort((a, b) => a.top - b.top);

      if (!visible.length) {
        if (isXhtmlBlocksDebug()) {
          console.warn('[XhtmlBlocks]', {
            bid,
            currentPageIndex,
            totalPages,
            reason: '뷰포트와 겹치는 블록 없음(폴백 locator)',
            totalBlocks: blockEntries.length,
            viewportH: Math.round(root.height),
          });
        }
        emitResolvedFallback();
        return;
      }

      const startRow = visible[0];
      const endRow = visible[visible.length - 1];
      const pageInBlock =
        rulerRoot &&
        visible.length === 1 &&
        shouldEncodePageInBlockIndex(startRow.el, rulerRoot, totalPages, phForBlob);
      const startBlockIdx = pageInBlock ? currentPageIndex : startRow.syntheticBlock;
      const endBlockIdx = pageInBlock ? currentPageIndex : endRow.syntheticBlock;
      const startLoc = getBlockLocator(startRow.el, 0, startBlockIdx);
      const endLoc = getBlockLocator(
        endRow.el,
        pageInBlock ? 0 : Math.max(0, (endRow.el.textContent || '').length),
        endBlockIdx
      );
      if (!startLoc || !endLoc) return;

      emitLocator({
        startLocator: startLoc,
        endLocator: endLoc,
      });
    }, [xhtmlContent, currentPageIndex, totalPages, bid, emitLocator, pageHeight]);

    useEffect(() => {
      if (!bid) {
        initialAnchorAppliedRef.current = false;
        initialPositionAppliedRef.current = false;
        initialSeekAppliedRef.current = false;
      }
    }, [bid]);

    const getPageIndexFromTop = useCallback(
      (top) => {
        if (!pageHeight) return 0;
        return Math.min(totalPages - 1, Math.max(0, Math.floor(top / pageHeight)));
      },
      [pageHeight, totalPages]
    );

    const findChapterBlockElement = useCallback((root, chapter, block = 0) => {
      const ch = Number(chapter);
      const b = Number(block);
      const safeB = Number.isFinite(b) ? b : 0;
      if (!Number.isFinite(ch)) return null;

      const tryChapter = (c) => {
        const byBoth = root.querySelector(
          `[data-chapter-index="${c}"][data-block-index="${safeB}"]`
        );
        if (byBoth) return byBoth;
        const list = Array.from(root.querySelectorAll(`[data-chapter-index="${c}"]`));
        if (!list.length) return null;
        const anyBlockAttr = list.some(
          (el) =>
            el.getAttribute('data-block-index') != null && el.getAttribute('data-block-index') !== ''
        );
        if (anyBlockAttr) {
          return (
            list.find((el) => Number(el.getAttribute('data-block-index')) === safeB) ?? null
          );
        }
        return list[safeB] ?? list[0] ?? null;
      };

      let el = tryChapter(ch);
      if (!el && ch >= 1) el = tryChapter(ch - 1);
      return el;
    }, []);

    const goPage = useCallback((direction) => {
      if (direction === 1 && currentPageIndex <= 0) return;
      if (direction === -1 && currentPageIndex >= totalPages - 1) return;
      flushSync(() => {
        setCurrentPageIndex((i) =>
          direction === -1 ? Math.min(totalPages - 1, i + 1) : Math.max(0, i - 1)
        );
      });
    }, [currentPageIndex, totalPages]);

    const prevPage = useCallback(() => goPage(1), [goPage]);
    const nextPage = useCallback(() => goPage(-1), [goPage]);

    const displayAt = useCallback((target) => {
      if (!target || !rulerRef.current) return false;
      const ph =
        typeof pageHeight === 'number' && pageHeight > 0
          ? pageHeight
          : containerRef.current?.clientHeight ?? 0;
      if (!(ph > 0)) return false;
      let locator = null;
      if (typeof target === 'string' && target.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(target);
          locator = parsed?.start ?? parsed?.startLocator ?? (Number.isFinite(parsed?.chapterIndex) ? parsed : null);
        } catch (_) {}
      } else if (target && typeof target === 'object') {
        locator = target.start ?? target.startLocator ?? (Number.isFinite(target.chapterIndex) ? target : null);
      }
      if (!locator) return false;
      const ruler = rulerRef.current;
      const el = findChapterBlockElement(ruler, locator.chapterIndex, locator.blockIndex ?? 0);
      if (el) {
        const bi = Number(locator.blockIndex ?? 0);
        if (
          ruler &&
          shouldEncodePageInBlockIndex(el, ruler, totalPages, ph) &&
          Number.isFinite(bi)
        ) {
          setCurrentPageIndex(Math.min(totalPages - 1, Math.max(0, bi)));
          return true;
        }
        const pageIdx = Math.min(totalPages - 1, Math.max(0, Math.floor(el.offsetTop / ph)));
        setCurrentPageIndex(pageIdx);
        return true;
      }
      return false;
    }, [pageHeight, totalPages, findChapterBlockElement]);

    useLayoutEffect(() => {
      if (!xhtmlContent || !rulerRef.current || !totalPages) return;
      const container = containerRef.current;
      const ph =
        typeof pageHeight === 'number' && pageHeight > 0
          ? pageHeight
          : container?.clientHeight ?? 0;
      if (!(ph > 0)) return;
      if (initialSeekAppliedRef.current) return;

      const ruler = rulerRef.current;
      let applied = false;
      const pageIdxFromTop = (top) =>
        Math.min(totalPages - 1, Math.max(0, Math.floor(Number(top) / ph)));

      const initLoc = initialAnchor?.startLocator ?? initialAnchor?.start ?? initialAnchor;
      if (initLoc?.chapterIndex != null || initLoc?.chapterIdx != null) {
        const chapter = Number(initLoc.chapterIndex ?? initLoc.chapterIdx);
        const block = Number(initLoc.blockIndex ?? 0);
        const el = findChapterBlockElement(ruler, chapter, block);
        if (el) {
          const pageIdx =
            shouldEncodePageInBlockIndex(el, ruler, totalPages, ph) && Number.isFinite(block)
              ? Math.min(totalPages - 1, Math.max(0, block))
              : pageIdxFromTop(el.offsetTop);
          setCurrentPageIndex(pageIdx);
          applied = true;
        }
      }

      initialAnchorAppliedRef.current = applied;
      initialPositionAppliedRef.current = applied;
      initialSeekAppliedRef.current = true;
    }, [
      xhtmlContent,
      totalPages,
      pageHeight,
      initialAnchor,
      findChapterBlockElement,
    ]);

    useImperativeHandle(ref, () => ({
      prevPage,
      nextPage,
      getCurrentLocator: () => lastLocatorRef.current,
      moveToProgress: (pct) => {
        const idx = Math.min(totalPages - 1, Math.max(0, Math.round((pct / 100) * (totalPages - 1))));
        setCurrentPageIndex(idx);
      },
      displayAt,
      applySettings: () => {},
    }), [prevPage, nextPage, totalPages, displayAt]);

    const handleKeyDown = useCallback((e) => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevPage(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nextPage(); }
    }, [prevPage, nextPage]);

    const SWIPE_THRESHOLD = 50;
    const handleTouchStart = useCallback((e) => {
      const t = e.touches?.[0];
      if (t) touchStartX.current = t.clientX;
    }, []);
    const handleTouchEnd = useCallback((e) => {
      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - touchStartX.current;
      if (Math.abs(dx) < SWIPE_THRESHOLD) return;
      if (dx > 0) prevPage();
      else nextPage();
    }, [prevPage, nextPage]);

    if (loading) {
      return (
        <div className="flex items-center justify-center w-full h-full text-gray-600">
          로딩 중...
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center w-full h-full text-red-600">
          {error}
        </div>
      );
    }
    if (!xhtmlContent) return null;

    const { styleCss } = xhtmlContent;
    const baseFontSize = settings?.fontSize ?? 100;
    const lineHeight = settings?.lineHeight ?? 1.5;

    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden bg-white relative" tabIndex={0} onKeyDown={handleKeyDown} onWheel={(e) => e.preventDefault()} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ touchAction: 'pan-y' }}>
        {styleCss ? <style>{styleCss}</style> : null}
        <style>{`
          .xhtml-viewer-content {
            padding: 24px;
            padding-bottom: 32px;
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            font-size: ${baseFontSize}%;
            line-height: ${lineHeight};
            font-family: ${settings?.fontFamily || 'Noto Serif KR'}, serif;
            overflow-wrap: break-word;
            word-break: break-word;
          }
          .xhtml-viewer-ruler {
            position: absolute;
            visibility: hidden;
            pointer-events: none;
            left: 0;
            top: 0;
            width: 100%;
          }
        `}</style>
        <div ref={rulerRef} className="xhtml-viewer-ruler xhtml-viewer-content" dangerouslySetInnerHTML={contentHtml} aria-hidden />
        <div ref={viewportRef} style={viewportStyle}>
          <div ref={contentRef} className="xhtml-viewer-content" style={contentStyle} dangerouslySetInnerHTML={contentHtml} />
        </div>
      </div>
    );
  }
);

XhtmlViewer.displayName = 'XhtmlViewer';
export default XhtmlViewer;
