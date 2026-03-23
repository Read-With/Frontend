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
import { codePointOffsetInBlock } from '../../../utils/common/locatorUtils';

const BLOCK_SELECTOR = '[data-chapter-index][data-block-index]';

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

const getSelectionOffsets = (contentEl, startBlock, endBlock) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !contentEl) return { startOffset: 0, endOffset: 0 };
  const range = sel.getRangeAt(0);
  const startOffset = startBlock && contentEl.contains(range.startContainer)
    ? codePointOffsetInBlock(startBlock, range)
    : 0;
  const endOffset = endBlock && contentEl.contains(range.endContainer)
    ? codePointOffsetInBlock(endBlock, range, { useEnd: true })
    : 0;
  return { startOffset, endOffset };
};

function parseXhtmlBody(xhtml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xhtml, 'text/html');
  const styleEl = doc.querySelector('style');
  const styleHTML = styleEl ? styleEl.outerHTML : '';
  const bodyHTML = doc.body ? doc.body.innerHTML : xhtml;
  return { styleHTML, bodyHTML };
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
    const lineBoundsRef = useRef([]);
    const [lineBoundsVersion, setLineBoundsReady] = useState(0);

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
        setLoading(true);
        setError(null);
        initialAnchorAppliedRef.current = false;
        try {
          const [raw, meta] = await Promise.all([
            loadCombinedXhtml(bid, book || {}),
            loadBookMeta(bid),
          ]);
          if (cancelled) return;
          metaRef.current = meta;
          const { styleHTML, bodyHTML } = parseXhtmlBody(raw);
          setXhtmlContent({ styleHTML, bodyHTML });
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
    }, [bid, book?.combinedXhtmlContent, book?.combinedXhtmlUrl]);

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;
      const ro = new ResizeObserver(() => setPageHeight(container.clientHeight));
      ro.observe(container);
      setPageHeight(container.clientHeight);
      return () => ro.disconnect();
    }, [xhtmlContent]);

    useEffect(() => {
      const ruler = rulerRef.current;
      if (!ruler) return;
      setContentHeight(ruler.offsetHeight);
      const ro = new ResizeObserver(() => setContentHeight(ruler.offsetHeight));
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
      onTotalPagesChange?.(totalPages);
      onCurrentPageChange?.(currentPage);
      onProgressChange?.(progress);
    }, [totalPages, currentPage, progress, onTotalPagesChange, onCurrentPageChange, onProgressChange]);

    useEffect(() => {
      if (!xhtmlContent || !contentRef.current || !containerRef.current) return;

      const content = contentRef.current;
      const container = containerRef.current;
      const blocks = content.querySelectorAll(BLOCK_SELECTOR);
      if (blocks.length === 0) return;

      const visibleMap = new Map();
      const io = new IntersectionObserver(
        (entries) => {
          const rootBounds = container.getBoundingClientRect();
          entries.forEach((entry) => {
            const el = entry.target;
            const ci = el.getAttribute('data-chapter-index');
            const bi = el.getAttribute('data-block-index');
            if (ci == null || bi == null) return;
            const key = `${ci}-${bi}`;
            const ratio = entry.intersectionRatio;
            const rect = entry.boundingClientRect;
            const top = rect.top - rootBounds.top;
            const bottom = rect.bottom - rootBounds.top;
            const prev = visibleMap.get(key);
            const prevRatio = prev?.ratio ?? 0;
            visibleMap.set(key, {
              ratio: Math.max(prevRatio, ratio),
              top,
              bottom,
              el,
            });
          });
        },
        { root: container, rootMargin: '0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
      );

      blocks.forEach((b) => io.observe(b));

      const interval = setInterval(() => {
        const visible = Array.from(visibleMap.entries())
          .filter(([, v]) => v.ratio > 0)
          .map(([key, v]) => ({ key, ...v }));
        if (visible.length === 0) return;
        visible.sort((a, b) => a.top - b.top);
        const startEntry = visible[0];
        const endEntry = visible[visible.length - 1];
        const startBlock = startEntry.el;
        const endBlock = endEntry.el;
        const { startOffset, endOffset } = getSelectionOffsets(content, startBlock, endBlock);
        const startLoc = getBlockLocator(startBlock, startOffset);
        const endLoc = getBlockLocator(endBlock, endOffset);
        if (startLoc && endLoc) {
          emitLocator({
            startLocator: startLoc,
            endLocator: endLoc,
          });
        }
      }, 300);

      return () => {
        io.disconnect();
        clearInterval(interval);
      };
    }, [xhtmlContent, emitLocator]);

    useEffect(() => {
      if (!xhtmlContent || !rulerRef.current || !pageHeight || initialAnchorAppliedRef.current) return;
      const ruler = rulerRef.current;
      let el = null;
      const initLoc = initialAnchor?.startLocator ?? initialAnchor?.start ?? initialAnchor;
      if (initLoc?.chapterIndex != null || initLoc?.chapterIdx != null) {
        const { chapterIndex: c, blockIndex: b } = initLoc;
        el = ruler.querySelector(`[data-chapter-index="${c}"][data-block-index="${b ?? 0}"]`);
      } else if (initialChapter != null) {
        el = ruler.querySelector(`[data-chapter-index="${initialChapter}"]`);
      }
      if (el) {
        const top = el.offsetTop;
        const idx = Math.min(totalPages - 1, Math.max(0, Math.floor(top / pageHeight)));
        setCurrentPageIndex(idx);
        initialAnchorAppliedRef.current = true;
      }
    }, [xhtmlContent, initialAnchor, initialChapter, totalPages, pageHeight]);

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
      const el = rulerRef.current.querySelector(
        `[data-chapter-index="${locator.chapterIndex}"][data-block-index="${locator.blockIndex ?? 0}"]`
      );
      if (el) {
        const top = el.offsetTop;
        const idx = Math.min(totalPages - 1, Math.max(0, Math.floor(top / pageHeight)));
        setCurrentPageIndex(idx);
      }
    }, [pageHeight, totalPages]);

    useEffect(() => {
      if (!xhtmlContent || initialAnchor) return;
      if (initialProgress != null && initialProgress > 0) {
        const pct = Math.min(100, Math.max(0, initialProgress)) / 100;
        setCurrentPageIndex((i) => Math.min(totalPages - 1, Math.round(pct * (totalPages - 1))));
        return;
      }
      if (Number.isFinite(initialPage) && initialPage >= 1 && totalPages >= 1) {
        setCurrentPageIndex((i) => Math.min(totalPages - 1, Math.max(0, initialPage - 1)));
      }
    }, [xhtmlContent, initialAnchor, initialProgress, initialPage, totalPages]);

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

    const { styleHTML, bodyHTML } = xhtmlContent;
    const baseFontSize = settings?.fontSize ?? 100;
    const lineHeight = settings?.lineHeight ?? 1.5;

    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden bg-white relative" tabIndex={0} onKeyDown={handleKeyDown} onWheel={(e) => e.preventDefault()} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} style={{ touchAction: 'pan-y' }}>
        <style>{styleHTML}</style>
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
