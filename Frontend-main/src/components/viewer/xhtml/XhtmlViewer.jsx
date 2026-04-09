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

const BLOCK_SELECTOR = '[data-chapter-index][data-block-index]';
const xhtmlLoadCache = new Map();
const XHTML_LOAD_CACHE_VERSION = 'v2';

const getBlockLocator = (el, offset = 0) => {
  const ci = el.getAttribute('data-chapter-index');
  const bi = el.getAttribute('data-block-index');
  if (ci == null || bi == null) return null;
  return {
    chapterIndex: Number(ci),
    blockIndex: Number(bi),
    offset: Number.isFinite(offset) ? offset : 0,
  };
};

const resolveChapterFromMetaByPage = (meta, currentPageIndex, totalPages) => {
  const chapters = Array.isArray(meta?.chapters) ? meta.chapters : [];
  if (!chapters.length) return null;

  const totalCodePoints = chapters.reduce((sum, chapter) => {
    const len = Number(chapter?.totalCodePoints ?? 0);
    return sum + (Number.isFinite(len) && len > 0 ? len : 0);
  }, 0);
  if (!Number.isFinite(totalCodePoints) || totalCodePoints <= 0) return null;

  const ratio =
    totalPages <= 1
      ? 0
      : Math.min(1, Math.max(0, Number(currentPageIndex) / Math.max(1, totalPages - 1)));
  const absolutePos = Math.floor(totalCodePoints * ratio);

  let cumulative = 0;
  for (const chapter of chapters) {
    const len = Number(chapter?.totalCodePoints ?? 0);
    const safeLen = Number.isFinite(len) && len > 0 ? len : 0;
    const chapterIndex = Number(chapter?.chapterIndex ?? chapter?.chapterIdx ?? chapter?.idx);
    const start = cumulative;
    const end = cumulative + safeLen;
    if (absolutePos >= start && absolutePos < end && Number.isFinite(chapterIndex) && chapterIndex > 0) {
      return chapterIndex;
    }
    cumulative = end;
  }

  const lastChapter = chapters[chapters.length - 1];
  const lastChapterIndex = Number(lastChapter?.chapterIndex ?? lastChapter?.chapterIdx ?? lastChapter?.idx);
  return Number.isFinite(lastChapterIndex) && lastChapterIndex > 0 ? lastChapterIndex : null;
};

const resolveChapterFromManifestByPage = (manifest, currentPageIndex, totalPages) => {
  const chapterLengths = Array.isArray(manifest?.progressMetadata?.chapterLengths)
    ? manifest.progressMetadata.chapterLengths
    : [];
  if (!chapterLengths.length) return null;

  const normalized = chapterLengths
    .map((item) => {
      const chapterIdx = Number(item?.chapterIdx ?? item?.chapterIndex ?? item?.idx ?? item?.chapter);
      const length = Number(item?.length ?? item?.codePointLength ?? 0);
      if (!Number.isFinite(chapterIdx) || chapterIdx < 1) return null;
      return { chapterIdx, length: Number.isFinite(length) && length > 0 ? length : 0 };
    })
    .filter(Boolean)
    .sort((a, b) => a.chapterIdx - b.chapterIdx);

  if (!normalized.length) return null;
  const totalLength = normalized.reduce((sum, item) => sum + item.length, 0);
  if (!Number.isFinite(totalLength) || totalLength <= 0) return null;

  const ratio =
    totalPages <= 1
      ? 0
      : Math.min(1, Math.max(0, Number(currentPageIndex) / Math.max(1, totalPages - 1)));
  const absolutePos = Math.floor(totalLength * ratio);

  let cumulative = 0;
  for (const item of normalized) {
    const start = cumulative;
    const end = cumulative + item.length;
    if (absolutePos >= start && absolutePos < end) return item.chapterIdx;
    cumulative = end;
  }
  return normalized[normalized.length - 1]?.chapterIdx ?? null;
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
    const blocks = doc.querySelectorAll('[data-chapter-index][data-block-index]');
    if (!blocks.length) return null;

    const byChapter = new Map();
    blocks.forEach((el) => {
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
      initialChapter,
      initialProgress,
      initialAnchor,
      initialPage,
      manifestReady = true,
    },
    ref
  ) => {
    const containerRef = useRef(null);
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
    const metaRef = useRef(null);
    const initialAnchorAppliedRef = useRef(false);
    const prevBidForInitialRef = useRef(null);
    const prevInitialChapterRef = useRef(initialChapter);
    const prevInitialPageRef = useRef(initialPage);
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

    const bid = bookId || book?.id || book?.filename || '';

    useEffect(() => {
      if (prevBidForInitialRef.current === bid) return;
      prevBidForInitialRef.current = bid;
      prevInitialChapterRef.current = initialChapter;
      prevInitialPageRef.current = initialPage;
      initialSeekAppliedRef.current = false;
      initialPositionAppliedRef.current = false;
      initialAnchorAppliedRef.current = false;
    }, [bid]);

    const emitLocator = useCallback(
      (loc) => {
        if (!loc?.startLocator || JSON.stringify(loc) === JSON.stringify(lastLocatorRef.current)) return;
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
      if (!xhtmlContent || !contentRef.current || !containerRef.current) return;
      const content = contentRef.current;
      const container = containerRef.current;
      const blocks = Array.from(content.querySelectorAll(BLOCK_SELECTOR));

      const serverBookId = Number(book?.id);
      const manifest = Number.isFinite(serverBookId) && serverBookId > 0
        ? getManifestFromCache(serverBookId)
        : null;
      const chapterFromMeta = resolveChapterFromMetaByPage(metaRef.current, currentPageIndex, totalPages);
      const chapterFromManifest = resolveChapterFromManifestByPage(manifest, currentPageIndex, totalPages);
      const resolvedChapter = chapterFromManifest ?? chapterFromMeta;
      const emitResolvedFallback = () => {
        if (Number.isFinite(resolvedChapter) && resolvedChapter > 0) {
          emitLocator(createFallbackLocator(resolvedChapter));
        }
      };

      if (!blocks.length) {
        emitResolvedFallback();
        return;
      }

      const root = container.getBoundingClientRect();
      const visible = blocks
        .map((el) => {
          const rect = el.getBoundingClientRect();
          const top = rect.top - root.top;
          const bottom = rect.bottom - root.top;
          const overlap = Math.min(bottom, root.height) - Math.max(top, 0);
          return { el, top, bottom, overlap };
        })
        .filter((item) => item.overlap > 0)
        .sort((a, b) => a.top - b.top);

      if (!visible.length) {
        emitResolvedFallback();
        return;
      }

      const startBlock = visible[0].el;
      const endBlock = visible[visible.length - 1].el;
      const startLoc = getBlockLocator(startBlock, 0);
      const endLoc = getBlockLocator(endBlock, Math.max(0, (endBlock.textContent || '').length));
      if (!startLoc || !endLoc) return;

      if (Number.isFinite(resolvedChapter) && resolvedChapter > 0) {
        startLoc.chapterIndex = resolvedChapter;
        endLoc.chapterIndex = resolvedChapter;
      }

      emitLocator({
        startLocator: startLoc,
        endLocator: endLoc,
      });
    }, [xhtmlContent, currentPageIndex, totalPages, book?.id, emitLocator]);

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

    const findChapterBlockElement = useCallback(
      (root, chapter, block = 0) =>
        root.querySelector(`[data-chapter-index="${chapter}"][data-block-index="${block}"]`) ||
        root.querySelector(`[data-chapter-index="${chapter}"]`),
      []
    );

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
      if (!target || !rulerRef.current || !pageHeight) return;
      let locator = null;
      if (typeof target === 'string' && target.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(target);
          locator = parsed?.start ?? parsed?.startLocator ?? (Number.isFinite(parsed?.chapterIndex) ? parsed : null);
        } catch (_) {}
      } else if (target && typeof target === 'object') {
        locator = target.start ?? target.startLocator ?? (Number.isFinite(target.chapterIndex) ? target : null);
      }
      if (!locator) return;
      const el = findChapterBlockElement(rulerRef.current, locator.chapterIndex, locator.blockIndex ?? 0);
      if (el) {
        setCurrentPageIndex(getPageIndexFromTop(el.offsetTop));
      }
    }, [pageHeight, findChapterBlockElement, getPageIndexFromTop]);

    useEffect(() => {
      if (!xhtmlContent || !rulerRef.current || !pageHeight || !totalPages) return;
      if (initialSeekAppliedRef.current) return;

      const ruler = rulerRef.current;
      let applied = false;

      // 1) initialAnchor 우선
      const initLoc = initialAnchor?.startLocator ?? initialAnchor?.start ?? initialAnchor;
      if (initLoc?.chapterIndex != null || initLoc?.chapterIdx != null) {
        const chapter = Number(initLoc.chapterIndex ?? initLoc.chapterIdx);
        const block = Number(initLoc.blockIndex ?? 0);
        const el = findChapterBlockElement(ruler, chapter, block);
        if (el) {
          setCurrentPageIndex(getPageIndexFromTop(el.offsetTop));
          applied = true;
        }
      }

      // 2) initialProgress
      if (!applied) {
        const pct = Number(initialProgress);
        if (Number.isFinite(pct) && pct > 0) {
          const ratio = Math.min(1, Math.max(0, pct / 100));
          const idx = Math.min(totalPages - 1, Math.max(0, Math.round(ratio * (totalPages - 1))));
          setCurrentPageIndex(idx);
          applied = true;
        }
      }

      // 3) initialPage
      if (!applied && Number.isFinite(initialPage) && initialPage >= 1) {
        const idx = Math.min(totalPages - 1, Math.max(0, initialPage - 1));
        setCurrentPageIndex(idx);
        applied = true;
      }

      // 4) initialChapter
      if (!applied && initialChapter != null && Number.isFinite(Number(initialChapter))) {
        const el = ruler.querySelector(`[data-chapter-index="${initialChapter}"]`);
        if (el) {
          setCurrentPageIndex(getPageIndexFromTop(el.offsetTop));
          applied = true;
        }
      }

      initialAnchorAppliedRef.current = applied;
      initialPositionAppliedRef.current = applied;
      initialSeekAppliedRef.current = true;
      prevInitialChapterRef.current = initialChapter;
      prevInitialPageRef.current = initialPage;
    }, [
      xhtmlContent,
      totalPages,
      pageHeight,
      initialAnchor,
      initialProgress,
      initialPage,
      initialChapter,
      findChapterBlockElement,
      getPageIndexFromTop,
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
        <div style={viewportStyle}>
          <div ref={contentRef} className="xhtml-viewer-content" style={contentStyle} dangerouslySetInnerHTML={contentHtml} />
        </div>
      </div>
    );
  }
);

XhtmlViewer.displayName = 'XhtmlViewer';
export default XhtmlViewer;
