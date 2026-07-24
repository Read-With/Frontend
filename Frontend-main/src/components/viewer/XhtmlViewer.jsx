import {
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
import { errorUtils } from '../../utils/common/urlUtils';
import {
  absoluteOffsetFromReadingProgressPercent,
  locatorFromBookAbsoluteOffset,
  getManifestFromCache,
} from '../../utils/common/cache/manifestCache';
import {
  toReadingLocatorKey,
  defaultSettings,
} from '../../utils/viewer/viewerSession';
import { resolveServerBookIdOrFallback } from '../../hooks/common/hooksShared';
import { resolveViewerBookKey } from '../../utils/viewer/viewerCore';
import {
  collectBlockEntries,
  computeLineBoundsFromRuler,
  contentPaddingFromMargin,
  loadCombinedXhtml,
  normalizeLocatorTarget,
  parseXhtmlBody,
  resolvePageIndexFromLocator,
  resolveViewportLocatorEmit,
  loadCachedXhtmlContent,
  XHTML_CACHE_INVALIDATED_EVENT,
} from '../../utils/viewer/viewerLocator';

const XhtmlViewer = forwardRef(
  (
    {
      book,
      bookId,
      onCurrentPageChange,
      onTotalPagesChange,
      onCurrentLineChange,
      settings = defaultSettings,
      manifestReady = true,
      /** resume 점프 전 본문 깜빡임 방지(레이아웃·ruler는 유지) */
      suppressViewport = false,
      suppressMessage = '로딩 중...',
    },
    ref
  ) => {
    const containerRef = useRef(null);
    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const rulerRef = useRef(null);
    const pendingDisplayRef = useRef(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [xhtmlContent, setXhtmlContent] = useState(null);
    const [pageHeight, setPageHeight] = useState(0);
    const [contentHeight, setContentHeight] = useState(0);
    const [currentPageIndex, setCurrentPageIndex] = useState(0);
    const [reloadNonce, setReloadNonce] = useState(0);
    const touchStartX = useRef(0);
    const lastLocatorRef = useRef(null);
    const lastEmittedViewportLocatorJsonRef = useRef(null);
    const prevBidRef = useRef(null);
    const lineBoundsRef = useRef([]);
    const [lineBoundsVersion, setLineBoundsReady] = useState(0);
    const lastReportedPagingRef = useRef({
      totalPages: null,
      currentPage: null,
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

    const layoutReady = typeof pageHeight === 'number' && pageHeight > 0;
    const totalPages = Math.max(1, layoutReady ? Math.ceil(contentHeight / pageHeight) : 1);
    // 레이아웃 붕괴(전체화면 그래프 등) 시 페이지 인덱스를 0으로 클램프하지 않음
    const safePageIndex = layoutReady
      ? Math.min(Math.max(0, currentPageIndex), Math.max(0, totalPages - 1))
      : currentPageIndex;
    const currentPage = safePageIndex + 1;

    const currentSnap = useMemo(
      () => getSnappedOffsetAndHeight(safePageIndex, pageHeight || 1),
      [safePageIndex, pageHeight, lineBoundsVersion, getSnappedOffsetAndHeight]
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

    const bid = useMemo(() => resolveViewerBookKey(book, bookId), [book, bookId]);

    const manifest = useMemo(() => {
      const cacheId = resolveServerBookIdOrFallback(book, bid);
      if (!cacheId) return null;
      return getManifestFromCache(cacheId);
    }, [book, bid]);

    const contentPadding = useMemo(
      () => contentPaddingFromMargin(settings?.margin ?? defaultSettings.margin),
      [settings?.margin]
    );

    const recomputeLineBounds = useCallback(() => {
      const ruler = rulerRef.current;
      if (!ruler) return;
      lineBoundsRef.current = computeLineBoundsFromRuler(ruler);
      setLineBoundsReady((v) => v + 1);
    }, []);

    const refreshContentHeight = useCallback(() => {
      const ruler = rulerRef.current;
      if (!ruler) return;
      setContentHeight((prev) => {
        const next = ruler.offsetHeight;
        return prev === next ? prev : next;
      });
    }, []);

    useEffect(() => {
      if (prevBidRef.current === bid) return;
      prevBidRef.current = bid;
      lastEmittedViewportLocatorJsonRef.current = null;
      lastLocatorRef.current = null;
    }, [bid]);

    useEffect(() => {
      if (!xhtmlContent) return;
      lastEmittedViewportLocatorJsonRef.current = null;
    }, [xhtmlContent]);

    useEffect(() => {
      if (currentPageIndex === safePageIndex) return;
      if (!layoutReady) return;
      setCurrentPageIndex(safePageIndex);
    }, [currentPageIndex, safePageIndex, layoutReady]);

    const emitLocator = useCallback(
      (loc) => {
        if (!loc?.startLocator) return;
        const endForKey = loc.endLocator ?? loc.startLocator;
        const viewportKey = toReadingLocatorKey(loc.startLocator, endForKey);
        if (viewportKey === lastEmittedViewportLocatorJsonRef.current) return;

        lastEmittedViewportLocatorJsonRef.current = viewportKey;
        lastLocatorRef.current = loc;
        onCurrentLineChange?.({ anchor: loc });
      },
      [onCurrentLineChange]
    );

    useEffect(() => {
      if (!bid || typeof window === 'undefined') return undefined;
      const onInvalidate = (e) => {
        if (String(e?.detail?.bookId) !== String(bid)) return;
        setReloadNonce((n) => n + 1);
      };
      window.addEventListener(XHTML_CACHE_INVALIDATED_EVENT, onInvalidate);
      return () => window.removeEventListener(XHTML_CACHE_INVALIDATED_EVENT, onInvalidate);
    }, [bid]);

    useEffect(() => {
      let cancelled = false;
      const load = async () => {
        if (!bid) {
          setError('책 정보가 없습니다.');
          setLoading(false);
          return;
        }
        if (!manifestReady) {
          setLoading(true);
          setError(null);
          return;
        }
        setLoading(true);
        setError(null);
        try {
          const parsed = await loadCachedXhtmlContent(bid, loadCombinedXhtml, parseXhtmlBody);
          if (cancelled) return;
          setXhtmlContent(parsed);
        } catch (e) {
          if (!cancelled) {
            setError(
              e?.status === 404
                ? '정규화 본문을 찾을 수 없습니다. 잠시 후 다시 시도하거나 재정규화가 필요할 수 있습니다.'
                : errorUtils.getUserFriendlyMessage(e) || e?.message || '로드 실패'
            );
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      };
      load();
      return () => { cancelled = true; };
    }, [bid, manifestReady, reloadNonce]);

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
      refreshContentHeight();
      const ro = new ResizeObserver(() => refreshContentHeight());
      ro.observe(ruler);
      return () => ro.disconnect();
    }, [xhtmlContent, contentPadding.padding, settings?.fontSize, settings?.lineHeight, settings?.fontFamily, refreshContentHeight]);

    useLayoutEffect(() => {
      if (!xhtmlContent || !rulerRef.current) return;
      recomputeLineBounds();
    }, [xhtmlContent, contentHeight, settings?.fontSize, settings?.lineHeight, settings?.fontFamily, contentPadding.padding, recomputeLineBounds]);

    useEffect(() => {
      if (!layoutReady) return;
      const prev = lastReportedPagingRef.current;
      if (prev.totalPages !== totalPages) {
        onTotalPagesChange?.(totalPages);
      }
      if (prev.currentPage !== currentPage) {
        onCurrentPageChange?.(currentPage);
      }
      lastReportedPagingRef.current = { totalPages, currentPage };
    }, [
      totalPages,
      currentPage,
      layoutReady,
      onTotalPagesChange,
      onCurrentPageChange,
    ]);

    useEffect(() => {
      if (!xhtmlContent || !contentRef.current || !viewportRef.current) return;
      if (!layoutReady) return;

      const result = resolveViewportLocatorEmit({
        blockEntries: collectBlockEntries(contentRef.current),
        viewportRect: viewportRef.current.getBoundingClientRect(),
        rulerRoot: rulerRef.current,
        manifest,
        currentPageIndex: safePageIndex,
        totalPages,
        pageHeight,
        snapOffsetY: currentSnap.offsetY,
        snapVisibleHeight: currentSnap.visibleHeight,
        prevStartLocator: lastLocatorRef.current?.startLocator ?? null,
      });

      if (result.kind !== 'emit') return;
      emitLocator(result.loc);
    }, [
      xhtmlContent,
      safePageIndex,
      totalPages,
      emitLocator,
      layoutReady,
      pageHeight,
      currentSnap.offsetY,
      currentSnap.visibleHeight,
      lineBoundsVersion,
      manifest,
    ]);

    const resolvePageHeight = useCallback(() => {
      if (layoutReady) return pageHeight;
      return containerRef.current?.clientHeight ?? 0;
    }, [layoutReady, pageHeight]);

    const goPageByDelta = useCallback((delta) => {
      if (!delta) return;
      flushSync(() => {
        setCurrentPageIndex((i) => {
          const next = i + delta;
          if (next < 0 || next >= totalPages) return i;
          return next;
        });
      });
    }, [totalPages]);

    const prevPage = useCallback(() => goPageByDelta(-1), [goPageByDelta]);
    const nextPage = useCallback(() => goPageByDelta(1), [goPageByDelta]);

    const displayAt = useCallback((target) => {
      if (!target) return false;
      pendingDisplayRef.current = target;

      const ruler = rulerRef.current;
      if (!ruler) return false;

      const ph = resolvePageHeight();
      if (!(ph > 0)) return false;

      const locator = normalizeLocatorTarget(target);
      if (!locator) return false;

      const pageIdx = resolvePageIndexFromLocator({
        locator,
        ruler,
        manifest,
        totalPages,
        pageHeightPx: ph,
      });
      if (pageIdx == null) return false;

      pendingDisplayRef.current = null;
      setCurrentPageIndex(pageIdx);
      return true;
    }, [resolvePageHeight, totalPages, manifest]);

    // 레이아웃(ruler·pageHeight) 준비되면 대기 중이던 resume displayAt 재시도
    useLayoutEffect(() => {
      const pending = pendingDisplayRef.current;
      if (!pending) return;
      displayAt(pending);
    }, [xhtmlContent, pageHeight, contentHeight, lineBoundsVersion, totalPages, manifest, displayAt]);

    const refreshLayout = useCallback(() => {
      recomputeLineBounds();
      refreshContentHeight();
    }, [recomputeLineBounds, refreshContentHeight]);

    useImperativeHandle(ref, () => ({
      prevPage,
      nextPage,
      getCurrentLocator: () => lastLocatorRef.current,
      moveToProgress: (pct) => {
        const numericBid = Number(bid);
        if (!Number.isFinite(numericBid) || numericBid <= 0) return false;
        const abs = absoluteOffsetFromReadingProgressPercent(numericBid, pct);
        const loc = locatorFromBookAbsoluteOffset(numericBid, abs);
        if (!loc) return false;
        return displayAt({ startLocator: loc, endLocator: loc });
      },
      displayAt,
      refreshLayout,
    }), [prevPage, nextPage, displayAt, refreshLayout, bid]);

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
        <div className="flex items-center justify-center w-full h-full text-gray-600" role="status" aria-live="polite">
          로딩 중...
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex items-center justify-center w-full h-full text-red-600" role="alert">
          {error}
        </div>
      );
    }
    if (!xhtmlContent) return null;

    const { styleCss } = xhtmlContent;
    const baseFontSize = settings?.fontSize ?? 100;
    const lineHeight = settings?.lineHeight ?? 1.5;

    return (
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden bg-white relative"
        tabIndex={0}
        role="region"
        aria-label={`책 본문 뷰어, ${currentPage} / ${totalPages} 페이지`}
        aria-busy={suppressViewport || undefined}
        onKeyDown={handleKeyDown}
        onWheel={(e) => e.preventDefault()}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        style={{ touchAction: 'pan-y' }}
      >
        {styleCss ? <style>{styleCss}</style> : null}
        <style>{`
          .xhtml-viewer-content {
            padding: ${contentPadding.padding}px;
            padding-bottom: ${contentPadding.paddingBottom}px;
            box-sizing: border-box;
            width: 100%;
            max-width: 100%;
            min-width: 0;
            font-size: ${baseFontSize}%;
            line-height: ${lineHeight};
            font-family: ${settings?.fontFamily || 'Noto Serif KR'}, 'Noto Serif', Georgia, serif;
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
        <div
          ref={viewportRef}
          style={{
            ...viewportStyle,
            visibility: suppressViewport ? 'hidden' : undefined,
          }}
        >
          <div ref={contentRef} className="xhtml-viewer-content" style={contentStyle} dangerouslySetInnerHTML={contentHtml} />
        </div>
        {suppressViewport ? (
          <div
            className="absolute inset-0 flex items-center justify-center bg-white text-gray-600"
            role="status"
            aria-live="polite"
          >
            {suppressMessage}
          </div>
        ) : null}
      </div>
    );
  }
);

XhtmlViewer.displayName = 'XhtmlViewer';
export default XhtmlViewer;
