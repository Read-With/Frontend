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
import { errorUtils } from '../../utils/common/valueUtils';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { absoluteOffsetFromReadingProgressPercent, locatorFromBookAbsoluteOffset } from '../../utils/common/readingProgress';
import {
  toReadingLocatorKey,
  viewerFontStack,
} from '../../utils/viewer/viewerSession';
import { resolveServerBookId, resolveViewerBookKey } from '../../utils/common/bookNormalize';
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
} from '../../utils/viewer/viewerLocator';
import './XhtmlViewer.css';

const SWIPE_THRESHOLD = 50;
const TAP_SLOP_PX = 12;
const TAP_ZONE_EDGE = 1 / 3;
const WHEEL_COOLDOWN_MS = 280;
const PAGE_KEYS = { ArrowUp: -1, PageUp: -1, ArrowLeft: -1, ArrowDown: 1, PageDown: 1, ArrowRight: 1 };

/**
 * 페이지 시작·끝을 줄 경계에 맞춤 (줄이 잘려 보이지 않게).
 * 시작: targetY 이하 마지막 줄 top / 보이는 높이: 끝 이하 마지막 줄 bottom까지
 */
function snapPageToLineBounds(lines, pageIdx, pageHeightPx) {
  const targetY = pageIdx * pageHeightPx;
  if (!lines.length) return { offsetY: Math.max(0, targetY), visibleHeight: pageHeightPx };
  const offsetY = lines.findLast((l) => l.top <= targetY)?.top ?? 0;
  const endY = offsetY + pageHeightPx;
  const visibleEnd = lines.findLast((l) => l.bottom <= endY)?.bottom ?? endY;
  const visibleHeight = Math.min(pageHeightPx, Math.max(0, visibleEnd - offsetY)) || pageHeightPx;
  return { offsetY, visibleHeight };
}

/**
 * 페이지 넘김 입력: 키보드(↑↓←→·PageUp/Down), 휠(쿨다운), 스와이프, 탭 영역(좌 1/3 이전·우 1/3 다음·가운데 메뉴).
 * suppressViewport 중에는 휠·탭 무시 (키보드·스와이프는 유지)
 */
function usePagingInput({ containerRef, prevPage, nextPage, suppressViewport, onToggleChrome, xhtmlContent }) {
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const suppressClickRef = useRef(false);
  const wheelLockRef = useRef(false);

  const handleKeyDown = useCallback((e) => {
    if (e.target.closest('input, textarea, [contenteditable]')) return;
    const go = PAGE_KEYS[e.key];
    if (!go) return;
    e.preventDefault();
    if (go < 0) prevPage();
    else nextPage();
  }, [prevPage, nextPage]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      if (suppressViewport || wheelLockRef.current) return;
      const absY = Math.abs(e.deltaY);
      const absX = Math.abs(e.deltaX);
      if (absY < 8 && absX < 8) return;
      const delta = absY >= absX ? e.deltaY : e.deltaX;
      if (!delta) return;
      wheelLockRef.current = true;
      if (delta > 0) nextPage();
      else prevPage();
      window.setTimeout(() => {
        wheelLockRef.current = false;
      }, WHEEL_COOLDOWN_MS);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [containerRef, nextPage, prevPage, suppressViewport, xhtmlContent]);

  /** 탭 위치(가로 비율)에 따라 이전/다음/메뉴 토글 */
  const runTapAction = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const ratio = rect?.width > 0 ? (clientX - rect.left) / rect.width : 0.5;
    if (ratio < TAP_ZONE_EDGE) prevPage();
    else if (ratio > 1 - TAP_ZONE_EDGE) nextPage();
    else onToggleChrome?.();
  }, [containerRef, nextPage, onToggleChrome, prevPage]);

  const handleTouchStart = useCallback((e) => {
    const t = e.touches?.[0];
    if (!t) return;
    touchStartX.current = t.clientX;
    touchStartY.current = t.clientY;
  }, []);

  const handleTouchEnd = useCallback((e) => {
    const t = e.changedTouches?.[0];
    if (!t) return;
    const dx = t.clientX - touchStartX.current;
    const dy = t.clientY - touchStartY.current;
    if (Math.abs(dx) >= SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      suppressClickRef.current = true;
      if (dx > 0) prevPage();
      else nextPage();
      return;
    }
    if (Math.abs(dx) <= TAP_SLOP_PX && Math.abs(dy) <= TAP_SLOP_PX) {
      suppressClickRef.current = true;
      if (suppressViewport) return;
      runTapAction(t.clientX);
    }
  }, [nextPage, prevPage, runTapAction, suppressViewport]);

  // 터치 직후 합성 click은 무시 (touchEnd에서 이미 처리)
  const handleClick = useCallback((e) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (suppressViewport) return;
    runTapAction(e.clientX);
  }, [runTapAction, suppressViewport]);

  return { handleKeyDown, handleClick, handleTouchStart, handleTouchEnd };
}

const NOT_FOUND_MESSAGE = '정규화 본문을 찾을 수 없습니다. 잠시 후 다시 시도하거나 재정규화가 필요할 수 있습니다.';

/** bid·manifest 준비 시 본문(XHTML) 로드 */
function useXhtmlContent(bid, manifestReady) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [xhtmlContent, setXhtmlContent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!bid) {
        setError('책 정보가 없습니다.');
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      if (!manifestReady) return;
      try {
        const parsed = await loadCachedXhtmlContent(bid, loadCombinedXhtml, parseXhtmlBody);
        if (!cancelled) setXhtmlContent(parsed);
      } catch (e) {
        if (cancelled) return;
        errorUtils.logError('XhtmlViewer', e, { bookId: bid });
        setError(
          e?.status === 404
            ? NOT_FOUND_MESSAGE
            : errorUtils.getUserFriendlyMessage(e) || e?.message || '로드 실패'
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [bid, manifestReady]);

  return { loading, error, xhtmlContent };
}

/**
 * 페이지 높이(컨테이너)·본문 높이(ruler)·줄 경계 측정.
 * typographyKey(여백·글꼴 크기·줄 간격·글꼴)가 바뀌면 다시 잰다.
 */
function usePageMetrics(containerRef, rulerRef, xhtmlContent, typographyKey) {
  const [pageHeight, setPageHeight] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const lineBoundsRef = useRef([]);
  const [lineBoundsVersion, setLineBoundsVersion] = useState(0);

  const recomputeLineBounds = useCallback(() => {
    if (!rulerRef.current) return;
    lineBoundsRef.current = computeLineBoundsFromRuler(rulerRef.current);
    setLineBoundsVersion((v) => v + 1);
  }, [rulerRef]);

  // 같은 값이면 React가 재렌더를 건너뜀
  const refreshContentHeight = useCallback(() => {
    if (rulerRef.current) setContentHeight(rulerRef.current.offsetHeight);
  }, [rulerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const measure = () => setPageHeight(container.clientHeight);
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    measure();
    return () => ro.disconnect();
  }, [containerRef, xhtmlContent]);

  useEffect(() => {
    const ruler = rulerRef.current;
    if (!ruler) return undefined;
    refreshContentHeight();
    const ro = new ResizeObserver(refreshContentHeight);
    ro.observe(ruler);
    return () => ro.disconnect();
  }, [rulerRef, xhtmlContent, typographyKey, refreshContentHeight]);

  useLayoutEffect(() => {
    if (xhtmlContent && rulerRef.current) recomputeLineBounds();
  }, [rulerRef, xhtmlContent, contentHeight, typographyKey, recomputeLineBounds]);

  const refreshLayout = useCallback(() => {
    recomputeLineBounds();
    refreshContentHeight();
  }, [recomputeLineBounds, refreshContentHeight]);

  return { pageHeight, contentHeight, lineBoundsRef, lineBoundsVersion, refreshLayout };
}

/** 총 페이지·현재 페이지가 바뀐 경우만 상위에 알림 */
function useReportPaging(layoutReady, totalPages, currentPage, onTotalPagesChange, onCurrentPageChange) {
  const lastReportedRef = useRef({ totalPages: null, currentPage: null });

  useEffect(() => {
    if (!layoutReady) return;
    const prev = lastReportedRef.current;
    if (prev.totalPages !== totalPages) onTotalPagesChange?.(totalPages);
    if (prev.currentPage !== currentPage) onCurrentPageChange?.(currentPage);
    lastReportedRef.current = { totalPages, currentPage };
  }, [totalPages, currentPage, layoutReady, onTotalPagesChange, onCurrentPageChange]);
}

/**
 * 보이는 영역의 첫·끝 블록 → reading locator. 같은 위치는 다시 보내지 않음.
 * 반환하는 lastLocatorRef는 getCurrentLocator용
 */
function useViewportLocator({
  bid,
  xhtmlContent,
  layoutReady,
  contentRef,
  viewportRef,
  rulerRef,
  manifest,
  pageIndex,
  totalPages,
  pageHeight,
  snap,
  lineBoundsVersion,
  onCurrentLineChange,
}) {
  const lastLocatorRef = useRef(null);
  const lastEmittedKeyRef = useRef(null);
  const prevBidRef = useRef(null);
  // 본문 DOM은 xhtmlContent가 바뀔 때만 교체됨 — 페이지마다 블록 전체를 다시 querySelectorAll 하지 않음
  const blockEntriesCacheRef = useRef({ root: null, content: null, entries: [] });

  useEffect(() => {
    if (prevBidRef.current === bid) return;
    prevBidRef.current = bid;
    lastEmittedKeyRef.current = null;
    lastLocatorRef.current = null;
  }, [bid]);

  useEffect(() => {
    if (xhtmlContent) lastEmittedKeyRef.current = null;
  }, [xhtmlContent]);

  const emitLocator = useCallback((loc) => {
    if (!loc?.startLocator) return;
    const key = toReadingLocatorKey(loc.startLocator, loc.endLocator ?? loc.startLocator);
    if (key === lastEmittedKeyRef.current) return;
    lastEmittedKeyRef.current = key;
    lastLocatorRef.current = loc;
    onCurrentLineChange?.({ anchor: loc });
  }, [onCurrentLineChange]);

  useEffect(() => {
    const root = contentRef.current;
    if (!xhtmlContent || !root || !viewportRef.current || !layoutReady) return;

    const cache = blockEntriesCacheRef.current;
    if (cache.root !== root || cache.content !== xhtmlContent) {
      blockEntriesCacheRef.current = { root, content: xhtmlContent, entries: collectBlockEntries(root) };
    }

    const result = resolveViewportLocatorEmit({
      blockEntries: blockEntriesCacheRef.current.entries,
      viewportRect: viewportRef.current.getBoundingClientRect(),
      rulerRoot: rulerRef.current,
      manifest,
      currentPageIndex: pageIndex,
      totalPages,
      pageHeight,
      snapOffsetY: snap.offsetY,
      snapVisibleHeight: snap.visibleHeight,
      prevStartLocator: lastLocatorRef.current?.startLocator ?? null,
    });
    if (result.kind === 'emit') emitLocator(result.loc);
  }, [
    contentRef,
    viewportRef,
    rulerRef,
    xhtmlContent,
    pageIndex,
    totalPages,
    emitLocator,
    layoutReady,
    pageHeight,
    snap.offsetY,
    snap.visibleHeight,
    lineBoundsVersion,
    manifest,
  ]);

  return lastLocatorRef;
}

/**
 * 현재 페이지 인덱스 · 이전/다음 · locator로 이동(displayAt).
 * 레이아웃이 아직 없을 때 들어온 displayAt은 기억해 두었다가 준비되면 다시 시도
 */
function usePageNavigation({ containerRef, rulerRef, metrics, manifest, xhtmlContent }) {
  const { pageHeight, contentHeight, lineBoundsVersion } = metrics;
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const pendingDisplayRef = useRef(null);

  const layoutReady = pageHeight > 0;
  const totalPages = Math.max(1, layoutReady ? Math.ceil(contentHeight / pageHeight) : 1);
  // 레이아웃 붕괴(전체화면 그래프 등) 시 페이지 인덱스를 0으로 클램프하지 않음
  const pageIndex = layoutReady
    ? Math.min(Math.max(0, currentPageIndex), totalPages - 1)
    : currentPageIndex;

  useEffect(() => {
    if (layoutReady && currentPageIndex !== pageIndex) setCurrentPageIndex(pageIndex);
  }, [currentPageIndex, pageIndex, layoutReady]);

  const goPageByDelta = useCallback((delta) => {
    setCurrentPageIndex((i) => {
      const next = i + delta;
      return next < 0 || next >= totalPages ? i : next;
    });
  }, [totalPages]);
  const prevPage = useCallback(() => goPageByDelta(-1), [goPageByDelta]);
  const nextPage = useCallback(() => goPageByDelta(1), [goPageByDelta]);

  const displayAt = useCallback((target) => {
    if (!target) return false;
    pendingDisplayRef.current = target;

    const ruler = rulerRef.current;
    const pageHeightPx = layoutReady ? pageHeight : containerRef.current?.clientHeight ?? 0;
    const locator = normalizeLocatorTarget(target);
    if (!ruler || !(pageHeightPx > 0) || !locator) return false;

    const pageIdx = resolvePageIndexFromLocator({ locator, ruler, manifest, totalPages, pageHeightPx });
    if (pageIdx == null) return false;

    pendingDisplayRef.current = null;
    setCurrentPageIndex(pageIdx);
    return true;
  }, [containerRef, rulerRef, layoutReady, pageHeight, totalPages, manifest]);

  // 레이아웃(ruler·pageHeight) 준비되면 대기 중이던 resume displayAt 재시도
  useLayoutEffect(() => {
    if (pendingDisplayRef.current) displayAt(pendingDisplayRef.current);
  }, [xhtmlContent, pageHeight, contentHeight, lineBoundsVersion, totalPages, manifest, displayAt]);

  return { layoutReady, totalPages, pageIndex, currentPage: pageIndex + 1, prevPage, nextPage, displayAt };
}

/** 책 자체 CSS(@scope로 본문에 한정) + 뷰어 설정(여백·글꼴 크기·줄 간격·글꼴) */
function ViewerContentStyle({ styleCss, settings, padding }) {
  return (
    <>
      {styleCss ? <style>{`@scope (.xhtml-viewer-content) {\n${styleCss}\n}`}</style> : null}
      <style>{`
          .xhtml-viewer-content {
            padding: ${padding.padding}px;
            padding-bottom: ${padding.paddingBottom}px;
            font-size: ${settings.fontSize}%;
            line-height: ${settings.lineHeight};
            font-family: ${viewerFontStack(settings.fontFamily)};
          }
        `}</style>
    </>
  );
}

/** settings는 normalizeSettings를 거친 값 (ViewerPage) */
const XhtmlViewer = forwardRef(
  (
    {
      book,
      bookKey,
      onCurrentPageChange,
      onTotalPagesChange,
      onCurrentLineChange,
      settings,
      manifestReady,
      /** resume 점프 전 본문 깜빡임 방지(레이아웃·ruler는 유지) */
      suppressViewport,
      suppressMessage,
      onToggleChrome,
    },
    ref
  ) => {
    const containerRef = useRef(null);
    const viewportRef = useRef(null);
    const contentRef = useRef(null);
    const rulerRef = useRef(null);

    const bid = useMemo(() => resolveViewerBookKey(book, bookKey), [book, bookKey]);
    const manifest = useMemo(() => {
      const cacheId = resolveServerBookId(book, bid);
      return cacheId ? getManifestFromCache(cacheId) : null;
    }, [book, bid]);
    const contentPadding = useMemo(() => contentPaddingFromMargin(settings.margin), [settings.margin]);
    const typographyKey =
      `${contentPadding.padding}|${settings.fontSize}|${settings.lineHeight}|${settings.fontFamily}`;

    const { loading, error, xhtmlContent } = useXhtmlContent(bid, manifestReady);
    const metrics = usePageMetrics(containerRef, rulerRef, xhtmlContent, typographyKey);
    const { pageHeight, lineBoundsRef, lineBoundsVersion, refreshLayout } = metrics;
    const nav = usePageNavigation({ containerRef, rulerRef, metrics, manifest, xhtmlContent });
    const { layoutReady, totalPages, pageIndex, currentPage, prevPage, nextPage, displayAt } = nav;

    const currentSnap = useMemo(
      () => snapPageToLineBounds(lineBoundsRef.current, pageIndex, pageHeight || 1),
      // lineBoundsVersion: ref로 읽는 줄 경계가 바뀌면 재계산
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [pageIndex, pageHeight, lineBoundsVersion]
    );

    const contentHtml = useMemo(() => ({ __html: xhtmlContent?.bodyHTML ?? '' }), [xhtmlContent]);

    useReportPaging(layoutReady, totalPages, currentPage, onTotalPagesChange, onCurrentPageChange);

    const lastLocatorRef = useViewportLocator({
      bid,
      xhtmlContent,
      layoutReady,
      contentRef,
      viewportRef,
      rulerRef,
      manifest,
      pageIndex,
      totalPages,
      pageHeight,
      snap: currentSnap,
      lineBoundsVersion,
      onCurrentLineChange,
    });

    useImperativeHandle(ref, () => ({
      prevPage,
      nextPage,
      getCurrentLocator: () => lastLocatorRef.current,
      moveToProgress: (pct) => {
        const numericBid = Number(bid);
        if (!(numericBid > 0)) return false;
        const loc = locatorFromBookAbsoluteOffset(
          numericBid,
          absoluteOffsetFromReadingProgressPercent(numericBid, pct),
        );
        return loc ? displayAt({ startLocator: loc, endLocator: loc }) : false;
      },
      displayAt,
      refreshLayout,
    }), [prevPage, nextPage, displayAt, refreshLayout, bid, lastLocatorRef]);

    const pagingHandlers = usePagingInput({
      containerRef,
      prevPage,
      nextPage,
      suppressViewport,
      onToggleChrome,
      xhtmlContent,
    });

    if (loading) {
      return (
        <div className="xhtml-viewer-status" role="status" aria-live="polite">
          로딩 중…
        </div>
      );
    }
    if (error) {
      return (
        <div className="xhtml-viewer-status xhtml-viewer-status--error" role="alert">
          {error}
        </div>
      );
    }
    if (!xhtmlContent) return null;

    return (
      <div
        ref={containerRef}
        className="xhtml-viewer"
        tabIndex={0}
        role="region"
        aria-label={`책 본문 뷰어, ${currentPage} / ${totalPages} 페이지`}
        aria-busy={suppressViewport || undefined}
        onKeyDown={pagingHandlers.handleKeyDown}
        onClick={pagingHandlers.handleClick}
        onTouchStart={pagingHandlers.handleTouchStart}
        onTouchEnd={pagingHandlers.handleTouchEnd}
      >
        <ViewerContentStyle styleCss={xhtmlContent.styleCss} settings={settings} padding={contentPadding} />
        <div ref={rulerRef} className="xhtml-viewer-ruler xhtml-viewer-content" dangerouslySetInnerHTML={contentHtml} aria-hidden />
        <div
          ref={viewportRef}
          style={{
            height: currentSnap.visibleHeight || '100%',
            overflow: 'hidden',
            visibility: suppressViewport ? 'hidden' : undefined,
          }}
        >
          <div
            ref={contentRef}
            className="xhtml-viewer-content"
            style={{ transform: `translateY(-${currentSnap.offsetY}px)` }}
            dangerouslySetInnerHTML={contentHtml}
          />
        </div>
        {suppressViewport ? (
          <div className="xhtml-viewer-suppress" role="status" aria-live="polite">
            {suppressMessage}
          </div>
        ) : null}
      </div>
    );
  }
);

XhtmlViewer.displayName = 'XhtmlViewer';

export default XhtmlViewer;
