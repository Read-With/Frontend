import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
  useCallback,
} from 'react';
import { loadCombinedXhtml, loadBookMeta } from '../../../utils/normalizedContent';
import { defaultSettings, settingsUtils } from '../../../utils/common/settingsUtils';

const BLOCK_SELECTOR = '[data-chapter-index][data-block-index]';

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
    const [slideOffset, setSlideOffset] = useState(0);
    const isSlidingRef = useRef(false);
    const slideDirectionRef = useRef(0);
    const blocksRef = useRef([]);
    const lastAnchorRef = useRef(null);
    const metaRef = useRef(null);

    const totalPages = Math.max(1, pageHeight ? Math.ceil(contentHeight / pageHeight) : 1);
    const currentPage = Math.min(totalPages, currentPageIndex + 1);
    const progress = totalPages <= 1 ? 0 : Math.round((currentPageIndex / (totalPages - 1)) * 100);

    const bid = bookId || book?.id || book?.filename || '';

    const emitAnchor = useCallback(
      (anchor) => {
        if (!anchor || JSON.stringify(anchor) === JSON.stringify(lastAnchorRef.current)) return;
        lastAnchorRef.current = anchor;
        const { chapterIndex } = anchor.start || anchor;
        onCurrentChapterChange?.(chapterIndex + 1);
        onCurrentLineChange?.(0, 0, { anchor });
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

    useEffect(() => {
      onTotalPagesChange?.(totalPages);
      onCurrentPageChange?.(currentPage);
      onProgressChange?.(progress);
    }, [totalPages, currentPage, progress, onTotalPagesChange, onCurrentPageChange, onProgressChange]);

    useEffect(() => {
      if (!xhtmlContent || !contentRef.current) return;

      const content = contentRef.current;
      const blocks = content.querySelectorAll(BLOCK_SELECTOR);
      if (blocks.length === 0) return;

      const visibleMap = new Map();
      const io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            const el = entry.target;
            const ci = el.getAttribute('data-chapter-index');
            const bi = el.getAttribute('data-block-index');
            if (ci == null || bi == null) return;
            const key = `${ci}-${bi}`;
            const ratio = entry.intersectionRatio;
            const prev = visibleMap.get(key) || 0;
            visibleMap.set(key, Math.max(prev, ratio));
          });
        },
        { root: containerRef.current, rootMargin: '0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
      );

      blocks.forEach((b) => io.observe(b));

      const interval = setInterval(() => {
        let bestKey = null;
        let bestRatio = 0;
        visibleMap.forEach((r, k) => {
          if (r > bestRatio) {
            bestRatio = r;
            bestKey = k;
          }
        });
        if (bestKey) {
          const [ci, bi] = bestKey.split('-').map(Number);
          emitAnchor({
            start: { chapterIndex: ci, blockIndex: bi, offset: 0 },
            end: { chapterIndex: ci, blockIndex: bi, offset: 0 },
          });
        }
      }, 300);

      return () => {
        io.disconnect();
        clearInterval(interval);
      };
    }, [xhtmlContent, emitAnchor]);

    useEffect(() => {
      if (!xhtmlContent || !initialAnchor || !rulerRef.current || !pageHeight) return;
      const { chapterIndex: c, blockIndex: b } = initialAnchor.start || initialAnchor;
      const el = rulerRef.current.querySelector(`[data-chapter-index="${c}"][data-block-index="${b}"]`);
      if (el) {
        const top = el.offsetTop;
        const idx = Math.min(totalPages - 1, Math.max(0, Math.floor(top / pageHeight)));
        setCurrentPageIndex(idx);
      }
    }, [xhtmlContent, initialAnchor, totalPages, pageHeight]);

    const handleSlideEnd = useCallback(() => {
      const dir = slideDirectionRef.current;
      if (dir === -1) setCurrentPageIndex((i) => Math.min(totalPages - 1, i + 1));
      else if (dir === 1) setCurrentPageIndex((i) => Math.max(0, i - 1));
      setSlideOffset(0);
      slideDirectionRef.current = 0;
      isSlidingRef.current = false;
    }, [totalPages]);

    const prevPage = useCallback(() => {
      if (isSlidingRef.current || currentPageIndex <= 0) return;
      isSlidingRef.current = true;
      slideDirectionRef.current = 1;
      setSlideOffset(1);
    }, [currentPageIndex]);

    const nextPage = useCallback(() => {
      if (isSlidingRef.current || currentPageIndex >= totalPages - 1) return;
      isSlidingRef.current = true;
      slideDirectionRef.current = -1;
      setSlideOffset(-1);
    }, [currentPageIndex, totalPages]);

    useEffect(() => {
      if (!xhtmlContent || initialAnchor || initialProgress == null || initialProgress <= 0) return;
      const pct = Math.min(100, Math.max(0, initialProgress)) / 100;
      setCurrentPageIndex((i) => Math.min(totalPages - 1, Math.round(pct * (totalPages - 1))));
    }, [xhtmlContent, initialProgress, totalPages]);

    useImperativeHandle(ref, () => ({
      prevPage,
      nextPage,
      getCurrentAnchor: () => lastAnchorRef.current,
      getCurrentCfi: () => {
        const a = lastAnchorRef.current;
        return a ? JSON.stringify(a) : null;
      },
      moveToProgress: (pct) => {
        const pages = Math.max(1, pageHeight ? Math.ceil(contentHeight / pageHeight) : 1);
        const idx = Math.min(pages - 1, Math.max(0, Math.round((pct / 100) * (pages - 1))));
        setCurrentPageIndex(idx);
      },
      displayAt: () => {},
      applySettings: () => {},
    }), [prevPage, nextPage, pageHeight, contentHeight]);

    const handleKeyDown = useCallback((e) => {
      if (e.target.closest('input, textarea, [contenteditable]')) return;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        return;
      }
      if (e.key === 'ArrowLeft') { e.preventDefault(); prevPage(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); nextPage(); }
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

    const sliceStyle = (offsetY) => ({ transform: `translateY(-${offsetY}px)` });
    const colStyle = { width: '33.333%', flexShrink: 0, height: '100%', overflow: 'hidden' };
    const wrapperStyle = {
      display: 'flex',
      width: '300%',
      height: '100%',
      transform: `translateX(calc(-33.333% + ${slideOffset * 33.333}%))`,
      transition: slideOffset !== 0 ? 'transform 0.18s cubic-bezier(0.33, 1, 0.68, 1)' : 'none',
    };

    return (
      <div ref={containerRef} className="w-full h-full overflow-hidden bg-white relative" tabIndex={0} onKeyDown={handleKeyDown} onWheel={(e) => e.preventDefault()} style={{ touchAction: 'none' }}>
        <style>{styleHTML}</style>
        <style>{`
          .xhtml-viewer-content {
            padding: 24px;
            box-sizing: border-box;
            font-size: ${baseFontSize}%;
            line-height: ${lineHeight};
            font-family: ${settings?.fontFamily || 'Noto Serif KR'}, serif;
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
        <div ref={rulerRef} className="xhtml-viewer-ruler xhtml-viewer-content" dangerouslySetInnerHTML={{ __html: bodyHTML }} aria-hidden />
        <div
          style={wrapperStyle}
          onTransitionEnd={(e) => e.propertyName === 'transform' && handleSlideEnd()}
        >
          {[-1, 0, 1].map((delta) => {
            const pageIdx = currentPageIndex + delta;
            const offsetY = Math.max(0, pageIdx * pageHeight);
            const isCenter = delta === 0;
            return (
              <div key={delta} style={colStyle}>
                <div style={{ height: '100%', overflow: 'hidden' }}>
                  <div style={sliceStyle(offsetY)} ref={isCenter ? contentRef : undefined} className="xhtml-viewer-content" dangerouslySetInnerHTML={{ __html: bodyHTML }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
);

XhtmlViewer.displayName = 'XhtmlViewer';
export default XhtmlViewer;
