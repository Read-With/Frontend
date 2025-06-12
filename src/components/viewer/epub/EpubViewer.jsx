import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
} from 'react';
import ePub from 'epubjs';

// eventRelationModules import 수정 - 프로젝트 루트 기준
const eventRelationModules = import.meta.glob('/src/data/gatsby/c_chapter*_0.json', { eager: true });

// getEventsForChapter 함수 정의
function getEventsForChapter(chapter) {
  const num = String(chapter).padStart(2, '0');
  try {
    const events = Object.entries(eventRelationModules)
      .filter(([path]) => {
        const matches = path.includes(`/${num}/${num}_ev`);
        return matches;
      })
      .map(([path, mod]) => {
        const eventNum = parseInt(path.match(/_ev(\d+)_relations\.json$/)?.[1] || '0');
        return { ...mod.default, eventNum, path };
      })
      .filter(ev => ev.eventNum > 0)
      .sort((a, b) => a.eventNum - b.eventNum);
    
    return events;
  } catch (error) {
    return [];
  }
}

// 글자 수를 정확하게 세는 함수 추가
const countCharacters = (text, element) => {
  if (!text) return 0;
  
  // 불필요한 요소 제외
  if (element) {
    // Project Gutenberg 관련 요소 제외
    if (element.closest('.pg-boilerplate') || 
        element.closest('.pgheader') ||
        element.closest('.toc') ||
        element.closest('.dedication') ||
        element.closest('.epigraph')) {
      return 0;
    }
  }

  // 특수문자, 공백, 줄바꿈 제거하고 영문자만 카운트
  const cleanedText = text
    .replace(/[\s\n\r\t]/g, '')  // 공백, 줄바꿈 등 제거
    .replace(/[^a-zA-Z]/g, '');  // 영문자만 남김

  // 디버깅: 영문자만 남았는지 확인
  if (cleanedText.length > 0) {
    console.log('영문자만 남은 텍스트:', cleanedText);
    console.log('영문자 개수:', cleanedText.length);
  }

  return cleanedText.length;
};

// 단어 수를 정확하게 세는 함수 추가
function countWords(text) {
  return text
    .replace(/[\n\r\t]+/g, ' ')
    .split(/[^가-힣a-zA-Z0-9]+/)
    .filter(word => word.length > 0)
    .length;
}

const EpubViewer = forwardRef(
  (
    { book, onProgressChange, onCurrentPageChange, onTotalPagesChange, onCurrentChapterChange, onCurrentLineChange, settings },
    ref
  ) => {
    const viewerRef = useRef(null);
    const bookRef = useRef(null);
    const renditionRef = useRef(null);
    const styleElementRef = useRef(null);
    const blobUrlRef = useRef(null);
    const [loading, setLoading] = useState(false);
    const [reloading, setReloading] = useState(false);
    const [error, setError] = useState(null);
    const [currentPath, setCurrentPath] = useState(null);
    const [chapterCharCounts, setChapterCharCounts] = useState({});

    // 현재 챕터의 누적 글자 수를 저장
    const currentChapterCharsRef = useRef(0);
    // 현재 챕터 번호 저장
    const currentChapterRef = useRef(1);
    // 챕터별 페이지 글자 수를 저장하는 Map
    const chapterPageCharsRef = useRef(new Map());

    const rawPath = book.path || book.filename;
    const epubPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    const cleanPath = rawPath.replace(/^\/+/, '');

    const LOCAL_STORAGE_KEY = `readwith_${cleanPath}_lastCFI`;
    const NEXT_PAGE_FLAG = `readwith_nextPagePending`;
    const PREV_PAGE_FLAG = `readwith_prevPagePending`;
    const CHAPTER_KEY = `readwith_${cleanPath}_prevChapter`;

    // 페이지 모드와 그래프 표시 여부 확인
    const pageMode = settings?.pageMode || 'double'; // 'single' 또는 'double'
    const showGraph = settings?.showGraph || false; // true 또는 false

    // 스프레드 모드 결정 함수
    const getSpreadMode = () => {
      return pageMode === 'single' ? 'none' : 'always';
    };

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

    // 페이지 이동 시 글자 수 계산 및 표시 함수
    const updatePageCharCount = (direction = 'next') => {
      const rendition = renditionRef.current;
      if (!rendition) return;

      // 현재 CFI를 키로 사용
      const currentCfi = rendition.currentLocation()?.start?.cfi;
      if (!currentCfi) return;

      // CFI에서 현재 단락 번호 추출
      const paragraphMatch = currentCfi.match(/\[chapter-\d+\]\/(\d+)/);
      const currentParagraphNum = paragraphMatch ? parseInt(paragraphMatch[1]) : 0;

      // 현재 페이지의 내용만 가져오기
      const contents = rendition.getContents();
      if (!contents || contents.length === 0) return;

      // 현재 페이지의 글자 수만 계산
      let charCount = 0;
      const currentPage = contents[0];
      const paragraphs = currentPage.document.querySelectorAll('p');

      // 현재 단락과 이전 단락들의 글자 수만 계산
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i];
        const paragraphText = paragraph.textContent;
        const paragraphChars = countCharacters(paragraphText, paragraph);
        
        // 현재 단락까지의 글자 수만 누적
        if (i <= currentParagraphNum) {
          charCount += paragraphChars;
          console.log(`단락 ${i + 1}: ${paragraphChars}자 (누적: ${charCount}자)`);
        }
      }

      // 현재 페이지의 글자 수를 저장
      chapterPageCharsRef.current.set(currentCfi, charCount);

      // 현재 페이지의 글자 수만 사용
      currentChapterCharsRef.current = charCount;

      console.log(`현재 챕터(${currentChapterRef.current}) CFI(${currentCfi}) 현재 페이지 글자 수: ${charCount}자`);
    };

    // 챕터 변경 시 초기화 함수
    const resetChapterCharCount = (chapter) => {
      currentChapterCharsRef.current = 0;
      currentChapterRef.current = chapter;
      chapterPageCharsRef.current.clear();
      console.log(`챕터 ${chapter} 시작 - 글자 수 초기화`);
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
              // 페이지 이동 후 글자 수 업데이트
              updatePageCharCount(direction);
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

    // 설정 적용 함수
    const applySettings = () => {
      if (!renditionRef.current || !bookRef.current) return;
      
      const rendition = renditionRef.current;
      
      // 스프레드 모드 설정
      rendition.spread(getSpreadMode());
      
      // 글꼴 크기 적용 (설정이 있는 경우)
      if (settings?.fontSize) {
        const fontSize = settings.fontSize / 100; // 100%를 1로 변환
      rendition.themes.fontSize(`${fontSize * 100}%`);
      }
      
      // 줄 간격 적용 (설정이 있는 경우)
      if (settings?.lineHeight) {
      rendition.themes.override('body', {
          'line-height': `${settings.lineHeight}`
      });
      }
      
      // 테마 적용 (설정이 있는 경우)
      if (settings?.theme) {
      const themeStyles = {
        light: {
          backgroundColor: '#ffffff',
          textColor: '#000000',
        },
        dark: {
          backgroundColor: '#121212',
          textColor: '#ffffff',
        },
        sepia: {
          backgroundColor: '#f4ecd8',
          textColor: '#5f4b32',
        }
      };
      
        const themeStyle = themeStyles[settings.theme] || themeStyles.light;
      
      rendition.themes.override('body', {
        'color': themeStyle.textColor,
        'background-color': themeStyle.backgroundColor
      });
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
      // 설정 적용 함수 추가
      applySettings: () => applySettings(),
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

          // TOC 정보 로드 및 챕터별 텍스트 저장
          const toc = bookInstance.navigation.toc;
          
          // 챕터별 텍스트 저장
          const chapterTexts = new Map();

          // 각 챕터의 텍스트 로드
          for (const item of toc) {
            if (!item.cfi) continue;
            
            try {
              const chapterCfi = item.cfi.replace(/!.*$/, '');
              const chapter = await bookInstance.get(chapterCfi);
              if (chapter) {
                const text = chapter.textContent;
                chapterTexts.set(item.cfi, text);
              }
            } catch (e) {
              console.warn(`챕터 "${item.label}" 로드 실패:`, e);
            }
          }

          const rendition = bookInstance.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: getSpreadMode(),
            manager: 'default',
            flow: 'paginated',
            maxSpreadPages: pageMode === 'single' ? 1 : 2,
          });

          // 페이지 모드에 맞는 CSS 적용
          rendition.themes.default({
            body: {
              'max-width': '100%',
              'margin': '0 auto',
              'box-sizing': 'border-box',
              'overflow-x': 'hidden'
            }
          });

          rendition.on('relocated', async (location) => {
            setLoading(false);
            const cfi = location?.start?.cfi;
            const locIdx = bookInstance.locations.locationFromCfi(cfi);
            const totalPages = bookInstance.locations.total;
            const pageNum = Math.min(locIdx + 1, totalPages);

            onCurrentPageChange?.(pageNum);
            onProgressChange?.(Math.round((locIdx / totalPages) * 100));
            localStorage.setItem(LOCAL_STORAGE_KEY, cfi);

            // CFI에서 장 번호와 단락 정보 추출
            const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
            const paragraphMatch = cfi.match(/\/(\d+)\/1:(\d+)\)$/);
            
            const chapterNum = chapterMatch ? parseInt(chapterMatch[1]) : 1;
            const paragraphNum = paragraphMatch ? parseInt(paragraphMatch[1]) : 1;
            const charOffset = paragraphMatch ? parseInt(paragraphMatch[2]) : 0;

            // 챕터가 변경되었을 때 초기화
            if (chapterNum !== currentChapterRef.current) {
              currentChapterRef.current = chapterNum;
              chapterPageCharsRef.current.clear();
            }

            // 페이지 글자 수 업데이트
            updatePageCharCount();

            // 이벤트 데이터 가져오기
            try {
              const events = getEventsForChapter(chapterNum);
              const currentEvent = events.find(event => 
                currentChapterCharsRef.current >= event.start && 
                currentChapterCharsRef.current < event.end
              );
              onCurrentLineChange?.(currentChapterCharsRef.current, events.length, currentEvent || null);
            } catch (error) {
              onCurrentLineChange?.(currentChapterCharsRef.current, 0, null);
            }
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
          
          // 설정 적용
          if (settings) {
            applySettings();
          }
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

    // 설정이 변경될 때마다 적용
    useEffect(() => {
      if (renditionRef.current && settings) {
        applySettings();
      }
    }, [settings]);

    // 앱이 처음 로드될 때 로컬 스토리지 초기화
    useEffect(() => {
      localStorage.setItem(CHAPTER_KEY, '1');
    }, []);

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
            backgroundColor: settings?.theme === 'dark' ? '#121212' : 
                             settings?.theme === 'sepia' ? '#f4ecd8' : 'white',
            overflow: 'hidden',
          }}
        />
      </div>
    );
  }
);

export default EpubViewer;