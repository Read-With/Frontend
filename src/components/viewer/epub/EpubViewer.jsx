import React, { useRef, useImperativeHandle, forwardRef, useEffect, useState } from 'react';
import ePub from 'epubjs';

const EpubViewer = forwardRef(({ book, onProgressChange }, ref) => {
  const viewerRef = useRef(null);
  const bookRef = useRef(null);
  const renditionRef = useRef(null);

  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false); // 'next' | 'prev' | false
  const [error, setError] = useState(null);
  const [currentPath, setCurrentPath] = useState(null);

  const LOCAL_STORAGE_KEY = `readwith_${book?.path}_lastCFI`;
  const NEXT_PAGE_FLAG = `readwith_nextPagePending`;
  const PREV_PAGE_FLAG = `readwith_prevPagePending`;

  // 페이지 새로고침 (최대한 빠르게)
  const smoothReload = (type = 'next') => {
    setReloading(type);
    setTimeout(() => {
      window.location.reload();
    }, 300); // 더 빠르게!
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
  
    // 1초 뒤에 오버레이 띄울 타이머
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
      
        // 0.5초 내에 onRelocated가 안 오면 오버레이를 켬
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
      if (!renditionRef.current || !renditionRef.current.currentLocation) {
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
      console.log('moveToProgress 내부 진입!', percentage);
      if (bookRef.current && renditionRef.current) {
        if (
          !bookRef.current.locations ||
          !bookRef.current.locations.length() ||
          typeof bookRef.current.locations.cfiFromPercentage !== "function"
        ) {
          console.log('locations generate 시도');
          await bookRef.current.locations.generate(3000); // 페이지 분해 더 세분화
        }
        const percent = Math.min(Math.max(percentage, 0), 100) / 100;
        console.log('percent(0~1)', percent);
        const targetCfi = bookRef.current.locations.cfiFromPercentage(percent);
        console.log('targetCfi:', targetCfi);
        if (!targetCfi) {
          if (percent < 0.5) {
            await renditionRef.current.display(0);
            console.warn('targetCfi가 없어 맨 처음으로 이동');
          } else {
            await renditionRef.current.display(bookRef.current.spine.last().href);
            console.warn('targetCfi가 없어 맨 끝으로 이동');
          }
          return;
        }
        await renditionRef.current.display(targetCfi);
        console.log('display 호출됨');
      } else {
        console.warn('bookRef.current 또는 renditionRef.current 없음');
      }
    }
    
    
  }));

  useEffect(() => {
    const loadBook = async () => {
      if (!book?.path || !viewerRef.current || book.path === currentPath) return;

      setLoading(true);
      setError(null);

      if (bookRef.current) {
        bookRef.current.destroy();
      }

      viewerRef.current.innerHTML = '';

      try {
        const response = await fetch(book.path);
        if (!response.ok) throw new Error();

        const blob = await response.blob();
        const bookInstance = ePub(blob);
        await bookInstance.ready;
        await bookInstance.locations.generate(3000);

        const rendition = bookInstance.renderTo(viewerRef.current, {
          width: '100%',
          height: '100%',
        });

        rendition.on('rendered', () => {
          setLoading(false);
        });
        rendition.on('relocated', (location) => {
          setLoading(false);
        
        const currentCfi = location?.start?.cfi;
      if (currentCfi) {
        localStorage.setItem(LOCAL_STORAGE_KEY, currentCfi);
      }

      // 퍼센트 전달
      if (location?.start?.percentage !== undefined && typeof onProgressChange === 'function') {
        const percent = Math.round(location.start.percentage * 100);
        onProgressChange(percent);
      }});


        const savedCfi = localStorage.getItem(LOCAL_STORAGE_KEY);
        await rendition.display(savedCfi || undefined);
        if (rendition && typeof onProgressChange === 'function') {
          const location = await rendition.currentLocation();
          if (location?.start?.percentage !== undefined) {
            const percent = Math.round(location.start.percentage * 100);
            onProgressChange(percent);
          }
        }

        // 새로고침 후 자동 페이지 이동
        const nextPageFlag = localStorage.getItem(NEXT_PAGE_FLAG);
        if (nextPageFlag === 'true') {
          localStorage.removeItem(NEXT_PAGE_FLAG);
          setTimeout(() => {
            rendition.next();
          }, 200);
        }
        const prevPageFlag = localStorage.getItem(PREV_PAGE_FLAG);
        if (prevPageFlag === 'true') {
          localStorage.removeItem(PREV_PAGE_FLAG);
          setTimeout(() => {
            rendition.prev();
          }, 200);
        }

        // 위치 저장
        rendition.on('relocated', (location) => {
          const currentCfi = location?.start?.cfi;
          if (currentCfi) {
            localStorage.setItem(LOCAL_STORAGE_KEY, currentCfi);
          }
        });

        bookRef.current = bookInstance;
        renditionRef.current = rendition;
        setCurrentPath(book.path);
      } catch {
        setError(`EPUB 로드 오류`);
      } finally {
        setLoading(false); // 안전!
      }
    };

    
    loadBook();

    return () => {
      if (bookRef.current) {
        bookRef.current.destroy();
      }
    };
  }, [book?.path, currentPath]);

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
});

export default EpubViewer;
