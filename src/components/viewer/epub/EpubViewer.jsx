import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
} from 'react';
import ePub from 'epubjs';

const EpubViewer = forwardRef(
  (
    { book, onProgressChange, onCurrentPageChange, onTotalPagesChange },
    ref
  ) => {
    const viewerRef = useRef(null);
    const bookRef = useRef(null);
    const renditionRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [reloading, setReloading] = useState(false);
    const [error, setError] = useState(null);
    const [currentPath, setCurrentPath] = useState(null);

    const rawPath = book.path || book.filename;
    const epubPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    const cleanPath = rawPath.replace(/^\/+/, '');

    const LOCAL_STORAGE_KEY = `readwith_${cleanPath}_lastCFI`;
    const NEXT_PAGE_FLAG = `readwith_nextPagePending`;
    const PREV_PAGE_FLAG = `readwith_prevPagePending`;

    const smoothReload = (type = 'next') => {
      setReloading(type);
      setTimeout(() => {
        window.location.reload();
      }, 300);
    };

    const fallbackDisplay = async (direction = 'next') => {
      try {
        const book = bookRef.current;
        const rendition = renditionRef.current;
        if (!book || !rendition) return;

        const location = await rendition.currentLocation();
        const cfi = location?.start?.cfi;
        const currentPercent = book.locations.percentageFromCfi(cfi);
        const targetPercent = direction === 'next'
          ? Math.min(currentPercent + 0.02, 1.0)
          : Math.max(currentPercent - 0.02, 0.0);

        const targetCfi = book.locations.cfiFromPercentage(targetPercent);
        console.warn(`📍 fallback: ${Math.round(currentPercent * 100)}% → ${Math.round(targetPercent * 100)}% 이동`);

        if (targetCfi) {
          await rendition.display(targetCfi);
        } else {
          console.error("❌ fallback 실패 → 새로고침");
          localStorage.setItem(
            direction === 'next' ? NEXT_PAGE_FLAG : PREV_PAGE_FLAG,
            'true'
          );
          smoothReload(direction);
        }
      } catch (e) {
        console.error('❌ fallbackDisplay 실패', e);
        smoothReload(direction);
      } finally {
        setReloading(false);
      }
    };

    const safeNavigate = async (action, direction = 'next') => {
      if (!renditionRef.current || !bookRef.current) return;

      const rendition = renditionRef.current;

      try {
        const currentLocation = await rendition.currentLocation?.();
        const currentCfi = currentLocation?.start?.cfi;

        if (!currentCfi) {
          await fallbackDisplay(direction);
          return;
        }

        let relocatedTriggered = false;

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            if (!relocatedTriggered) {
              console.warn('❗️relocated 이벤트 없음 → fallback');
              fallbackDisplay(direction);
              reject();
            }
          }, 700);

          const onRelocated = (location) => {
            if (relocatedTriggered) return;
            relocatedTriggered = true;
            clearTimeout(timeout);
            rendition.off('relocated', onRelocated);

            const newCfi = location?.start?.cfi;
            if (newCfi && newCfi !== currentCfi) {
              setReloading(false);
              resolve();
            } else {
              console.warn('❗️relocated 됐지만 동일 CFI → fallback');
              fallbackDisplay(direction);
              reject();
            }
          };

          rendition.on('relocated', onRelocated);
          setReloading(true);
          action(); // next() 또는 prev()
        });
      } catch {
        await fallbackDisplay(direction);
      }
    };

    useImperativeHandle(ref, () => ({
      prevPage: () => safeNavigate(() => renditionRef.current.prev(), 'prev'),
      nextPage: () => safeNavigate(() => renditionRef.current.next(), 'next'),
      getCurrentCfi: async () => {
        if (!renditionRef.current?.currentLocation) return null;
        const location = await renditionRef.current.currentLocation();
        return location?.start?.cfi || null;
      },
      displayAt: (cfi) => {
        if (renditionRef.current && cfi) {
          setTimeout(() => {
            renditionRef.current.display(cfi);
          }, 0);
        }
      },
      showLastPage: async () => {
        const book = bookRef.current;
        const rendition = renditionRef.current;
        if (!book || !rendition) return;
        try {
          if (!book.locations?.length()) {
            await book.locations.generate(2000);
          }
          const lastCfi = book.locations.cfiFromPercentage(1.0);
          await rendition.display(lastCfi || book.spine.last()?.href);
        } catch (e) {
          console.error("❌ 마지막 페이지 이동 실패", e);
        }
      },
      moveToProgress: async (percentage) => {
        const book = bookRef.current;
        const rendition = renditionRef.current;
        if (!book || !rendition) return;

        if (!book.locations || !book.locations.length()) {
          await book.locations.generate(3000);
        }
        const percent = Math.min(Math.max(percentage, 0), 100) / 100;
        const targetCfi = book.locations.cfiFromPercentage(percent);
        await rendition.display(targetCfi || (percent < 0.5 ? 0 : book.spine.last()?.href));
      },
    }));

    useEffect(() => {
      const loadBook = async () => {
        if (!epubPath || !viewerRef.current || epubPath === currentPath) return;

        setLoading(true);
        setError(null);

        if (bookRef.current) bookRef.current.destroy();
        viewerRef.current.innerHTML = '';

        try {
          const response = await fetch(epubPath);
          if (!response.ok) throw new Error("EPUB fetch 실패");

          const blob = await response.blob();
          const bookInstance = ePub(blob);
          await bookInstance.ready;
          await bookInstance.locations.generate(1800);
          onTotalPagesChange?.(bookInstance.locations.total);

          const rendition = bookInstance.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: 'always',
          });

          rendition.on('relocated', (location) => {
            setLoading(false);
            const cfi = location?.start?.cfi;
            const locIdx = bookInstance.locations.locationFromCfi(cfi);
            const totalPages = bookInstance.locations.total;
            const pageNum = Math.min(locIdx + 1, totalPages);

            onCurrentPageChange?.(pageNum);
            onProgressChange?.(Math.round((locIdx / totalPages) * 100));
            localStorage.setItem(LOCAL_STORAGE_KEY, cfi);
          });

          const savedCfi = localStorage.getItem(LOCAL_STORAGE_KEY);
          const displayTarget = savedCfi || bookInstance.locations.cfiFromLocation(0);
          await rendition.display(displayTarget);

          if (localStorage.getItem(NEXT_PAGE_FLAG) === 'true') {
            localStorage.removeItem(NEXT_PAGE_FLAG);
            setTimeout(() => rendition.next(), 200);
          }
          if (localStorage.getItem(PREV_PAGE_FLAG) === 'true') {
            localStorage.removeItem(PREV_PAGE_FLAG);
            setTimeout(() => rendition.prev(), 200);
          }

          bookRef.current = bookInstance;
          renditionRef.current = rendition;
          setCurrentPath(epubPath);
        } catch (e) {
          console.error(e);
          setError("EPUB 로드 오류");
        } finally {
          setLoading(false);
        }
      };

      loadBook();
      return () => {
        if (bookRef.current) bookRef.current.destroy();
      };
    }, [epubPath, currentPath]);

    return (
      <div className="w-full h-full relative flex items-center justify-center">
        <div className="flex flex-col items-center justify-center space-y-2 absolute inset-0 z-50 pointer-events-none">
          {!reloading && loading && (
            <p className="text-center text-base text-white bg-black bg-opacity-60 px-4 py-2 rounded">
              로딩 중...
            </p>
          )}
          {!reloading && error && (
            <p className="text-center text-base text-red-300 bg-black bg-opacity-60 px-4 py-2 rounded">
              {error}
            </p>
          )}
        </div>
        <div
          ref={viewerRef}
          style={{
            width: '100%',
            height: '100%',
            minHeight: '400px',
            backgroundColor: 'white',
            overflow: 'hidden',
          }}
        />
      </div>
    );
  }
);

export default EpubViewer;
