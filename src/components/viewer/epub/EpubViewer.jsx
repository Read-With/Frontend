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
    const [currentPageLocal, setCurrentPageLocal] = useState(1);
    const [totalPagesLocal, setTotalPagesLocal] = useState(1);
    const [progressLocal, setProgressLocal] = useState(0);

    // 파일 경로: path 있으면 path, 없으면 filename 기반으로 생성
    const epubPath = book.path || (book.filename ? "/" + book.filename : null);

    const LOCAL_STORAGE_KEY = `readwith_${epubPath}_lastCFI`;
    const NEXT_PAGE_FLAG = `readwith_nextPagePending`;
    const PREV_PAGE_FLAG = `readwith_prevPagePending`;

    // 페이지 새로고침 (최대한 빠르게)
    const smoothReload = (type = 'next') => {
      setReloading(type);
      setTimeout(() => {
        window.location.reload();
      }, 300);
    };

    // 페이지 위치 복구 + fallback
    const fallbackDisplay = async (direction = 'next') => {
      let timeoutForOverlay;
      try {
        const location = await renditionRef.current?.currentLocation();
        const cfi = location?.start?.cfi || undefined;

        await renditionRef.current.display(cfi);

        await new Promise((resolve, reject) => {
          setReloading(direction);
          timeoutForOverlay = setTimeout(() => {
            renditionRef.current.display(1);
            localStorage.setItem(
              direction === 'next' ? NEXT_PAGE_FLAG : PREV_PAGE_FLAG,
              'true'
            );
            smoothReload(direction);
            reject();
          }, 1000);

          const onRelocated = () => {
            clearTimeout(timeoutForOverlay);
            renditionRef.current?.off('relocated', onRelocated);
            setReloading(false);
            resolve();
          };

          renditionRef.current?.on('relocated', onRelocated);
        });
      } catch {
        localStorage.setItem(
          direction === 'next' ? NEXT_PAGE_FLAG : PREV_PAGE_FLAG,
          'true'
        );
        smoothReload(direction);
        setReloading(false);
      }
    };

    // 안전 페이지 이동
    const safeNavigate = async (action, direction = 'next') => {
      if (!renditionRef.current) return;

      let timeoutForOverlay;
      let relocatedFinished = false;

      timeoutForOverlay = setTimeout(() => {
        if (!relocatedFinished) setReloading(direction);
      }, 1000);

      try {
        const currentLocation = await renditionRef.current.currentLocation?.();
        const currentCfi = currentLocation?.start?.cfi;

        if (!currentCfi) {
          clearTimeout(timeoutForOverlay);
          await fallbackDisplay(direction);
          return;
        }

        await new Promise((resolve, reject) => {
          let showOverlay = false;

          const timeout = setTimeout(() => {
            setReloading(direction);
            showOverlay = true;
            fallbackDisplay(direction);
            reject();
          }, 500);

          const onRelocated = (location) => {
            clearTimeout(timeout);
            relocatedFinished = true;
            if (showOverlay) setReloading(false);
            renditionRef.current?.off('relocated', onRelocated);

            const newCfi = location?.start?.cfi;
            if (newCfi && newCfi !== currentCfi) {
              resolve();
            } else {
              setReloading(direction);
              fallbackDisplay(direction);
              reject();
            }
          };

          renditionRef.current?.on('relocated', onRelocated);
          action();
        });
      } catch {
        setReloading(direction);
        await fallbackDisplay(direction);
      }
    };

    // imperative handle
    useImperativeHandle(ref, () => ({
      prevPage: () => safeNavigate(() => renditionRef.current.prev(), 'prev'),
      nextPage: () => safeNavigate(() => renditionRef.current.next(), 'next'),
      getCurrentCfi: async () => {
        if (
          !renditionRef.current ||
          !renditionRef.current.currentLocation
        ) {
          return null;
        }
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
      moveToProgress: async (percentage) => {
        if (bookRef.current && renditionRef.current) {
          if (
            !bookRef.current.locations ||
            !bookRef.current.locations.length() ||
            typeof bookRef.current.locations.cfiFromPercentage !== "function"
          ) {
            await bookRef.current.locations.generate(3000);
          }
          const percent = Math.min(Math.max(percentage, 0), 100) / 100;
          const targetCfi = bookRef.current.locations.cfiFromPercentage(percent);
          if (!targetCfi) {
            if (percent < 0.5) {
              await renditionRef.current.display(0);
            } else {
              await renditionRef.current.display(bookRef.current.spine.last().href);
            }
            return;
          }
          await renditionRef.current.display(targetCfi);
        }
      }
    }));

    useEffect(() => {
      console.log('EpubViewer useEffect 진입!', book, epubPath, currentPath);

      const loadBook = async () => {
        if (!epubPath || !viewerRef.current || epubPath === currentPath) {
          console.log('useEffect 조건 미충족', epubPath, viewerRef.current, epubPath, currentPath);
          return;
        }

        setLoading(true);
        setError(null);

        if (bookRef.current) bookRef.current.destroy();
        viewerRef.current.innerHTML = '';

        try {
          console.log('epub fetch path:', epubPath);
          const response = await fetch(epubPath);
          if (!response.ok) throw new Error();

          const blob = await response.blob();
          const bookInstance = ePub(blob);
          await bookInstance.ready;
          await bookInstance.locations.generate(1800); 
          setTotalPagesLocal(bookInstance.locations.total);
          if (onTotalPagesChange) onTotalPagesChange(bookInstance.locations.total);

          const rendition = bookInstance.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: 'always',
          });

          rendition.on('relocated', (location) => {
            setLoading(false);
            if (location && location.start) {
              const locIdx = bookInstance.locations.locationFromCfi(location.start.cfi);
              const totalPages = bookInstance.locations.total;
              let pageNum = locIdx + 1;
              if (pageNum > totalPages) pageNum = totalPages;
          
              setCurrentPageLocal(pageNum);
              if (onCurrentPageChange) onCurrentPageChange(pageNum);
              setTotalPagesLocal(totalPages);
              if (onTotalPagesChange) onTotalPagesChange(totalPages);
          
              const percent = Math.round((locIdx / totalPages) * 100);
              setProgressLocal(percent);
              if (typeof onProgressChange === 'function') {
                onProgressChange(percent);
              }
              localStorage.setItem(LOCAL_STORAGE_KEY, location.start.cfi);
            }
          });

          // 최초 표시
          let displayTarget = undefined;
          const savedCfi = localStorage.getItem(LOCAL_STORAGE_KEY);
          if (savedCfi) {
            displayTarget = savedCfi;
          } else {
            let savedPage = 0;
            displayTarget = bookInstance.locations.cfiFromLocation(savedPage);
          }
          await rendition.display(displayTarget);

          // 새로고침 후 자동 페이지 이동
          const nextPageFlag = localStorage.getItem(NEXT_PAGE_FLAG);
          if (nextPageFlag === 'true') {
            localStorage.removeItem(NEXT_PAGE_FLAG);
            setTimeout(() => rendition.next(), 200);
          }
          const prevPageFlag = localStorage.getItem(PREV_PAGE_FLAG);
          if (prevPageFlag === 'true') {
            localStorage.removeItem(PREV_PAGE_FLAG);
            setTimeout(() => rendition.prev(), 200);
          }

          bookRef.current = bookInstance;
          renditionRef.current = rendition;
          setCurrentPath(epubPath);
        } catch {
          setError(`EPUB 로드 오류`);
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
