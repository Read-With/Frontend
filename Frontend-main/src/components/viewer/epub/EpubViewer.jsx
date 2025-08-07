import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
} from 'react';
import ePub from 'epubjs';

// glob import 경로를 상대경로로 수정
const eventRelationModules = import.meta.glob('../../../data/gatsby/chapter*_events.json', { eager: true });

// getEventsForChapter 함수 정의
function getEventsForChapter(chapter) {
  const num = String(chapter);
  // 1. 이벤트 본문 데이터 추출
  const textFilePath = Object.keys(eventRelationModules).find(path => path.includes(`chapter${num}_events.json`));
  if (!textFilePath) {
    // 파일을 찾을 수 없음
  }
  const textArray = textFilePath ? eventRelationModules[textFilePath]?.default : [];

  // 2. 각 event에 대해 event_id, eventNum, chapter 세팅
  const eventsWithMeta = textArray.map(event => {
    const eventId = (event.event_id === undefined || event.event_id === null) ? 0 : event.event_id;
    return {
      ...event,
      event_id: eventId,
      eventNum: eventId,
      chapter: Number(chapter)
    };
  });
  
  // 3. 현재 챕터의 이벤트만 필터링 (이전 챕터의 마지막 이벤트 제외)
  const currentChapterEvents = eventsWithMeta.filter(event => {
    return event.chapter === Number(chapter);
  });
  
  return currentChapterEvents;
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
    const [isNavigating, setIsNavigating] = useState(false);
    const [navigationError, setNavigationError] = useState(null);

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

        if (targetCfi) {
          await rendition.display(targetCfi);
        } else {
          localStorage.setItem(
            direction === 'next' ? NEXT_PAGE_FLAG : PREV_PAGE_FLAG,
            'true'
          );
          smoothReload(direction);
        }
      } catch (e) {
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
        }
      }

      // 현재 페이지의 글자 수를 저장
      chapterPageCharsRef.current.set(currentCfi, charCount);

      // 현재 페이지의 글자 수만 사용
      currentChapterCharsRef.current = charCount;
    };

    // 챕터 변경 시 초기화 함수
    const resetChapterCharCount = (chapter) => {
      currentChapterCharsRef.current = 0;
      currentChapterRef.current = chapter;
      chapterPageCharsRef.current.clear();
    };

    const safeNavigate = async (action, direction = 'next') => {
      if (!renditionRef.current || !bookRef.current || isNavigating) return;
      setIsNavigating(true);
      setNavigationError(null);
      const rendition = renditionRef.current;
      const book = bookRef.current;

      let relocatedFired = false;
      const relocatedHandler = () => {
        relocatedFired = true;
        setIsNavigating(false);
        rendition.off('relocated', relocatedHandler);
      };
      rendition.on('relocated', relocatedHandler);

      try {
        const beforeLocation = await rendition.currentLocation();
        const beforeCfi = beforeLocation?.start?.cfi;
        const beforeSpinePos = beforeLocation?.start?.spinePos;

        // next/prev 실행 결과 반환값 체크
        const result = await action();

        let waited = 0;
        const maxWait = 1200;
        const interval = 60;
        while (!relocatedFired && waited < maxWait) {
          await new Promise(res => setTimeout(res, interval));
          waited += interval;
        }

        const afterLocation = await rendition.currentLocation();
        const afterCfi = afterLocation?.start?.cfi;
        const afterSpinePos = afterLocation?.start?.spinePos;

        // relocated가 발생하지 않았거나, cfi가 그대로면 spine 직접 이동 시도
        if ((!relocatedFired || beforeCfi === afterCfi) && afterCfi) {
          // spine 직접 이동 (다음/이전 챕터)
          let moved = false;
          if (direction === 'next') {
            const currSpine = book.spine.get(beforeSpinePos);
            const nextSpine = book.spine.get(currSpine.index + 1);
            if (nextSpine) {
              await rendition.display(nextSpine.href);
              moved = true;
            }
          } else if (direction === 'prev') {
            const currSpine = book.spine.get(beforeSpinePos);
            const prevSpine = book.spine.get(currSpine.index - 1);
            if (prevSpine) {
              await rendition.display(prevSpine.href);
              moved = true;
            }
          }
          if (!moved) {
            setNavigationError('이동할 수 없는 페이지입니다.');
          }
          rendition.emit('relocated', afterLocation);
          setIsNavigating(false);
          rendition.off('relocated', relocatedHandler);
        }
      } catch {
        setIsNavigating(false);
        rendition.off('relocated', relocatedHandler);
        setNavigationError('이동 중 오류가 발생했습니다.');
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
       book: bookRef.current, // book 객체 노출
      display: async (spineIndex) => {
        if (renditionRef.current && typeof spineIndex === 'number') {
          try {
            await renditionRef.current.display(spineIndex);
            return true;
          } catch (error) {
            return false;
          }
        } else {
          return false;
        }
      },
      
      currentLocation: async () => {
        if (renditionRef.current) {
          try {
            const location = await renditionRef.current.currentLocation();
            return location;
          } catch (error) {
            return null;
          }
        } else {
          return null;
        }
      },
      
      displayAt: async (cfi) => {
        if (renditionRef.current && cfi) {
          try {
            // 1. 먼저 CFI를 직접 사용해서 시도
            await renditionRef.current.display(cfi);
            
            // 이동 후 현재 위치 확인
            const currentLocation = await renditionRef.current.currentLocation();
            const currentCfi = currentLocation?.start?.cfi;
            
            // CFI에서 챕터 번호 추출하여 이동이 실제로 되었는지 확인
            const targetChapterMatch = cfi.match(/\[chapter-(\d+)\]/);
            const currentChapterMatch = currentCfi?.match(/\[chapter-(\d+)\]/);
            
            if (targetChapterMatch && currentChapterMatch) {
              const targetChapter = parseInt(targetChapterMatch[1]);
              const currentChapter = parseInt(currentChapterMatch[1]);
              
              if (targetChapter === currentChapter) {
                return true;
              } else {
                throw new Error(`이동 실패: 목표 챕터 ${targetChapter}, 현재 챕터 ${currentChapter}`);
              }
            } else {
              return true;
            }
          } catch (error) {
            return false;
          }
        } else {
          return false;
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
          // 마지막 페이지 이동 실패
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
      isNavigating, // 외부에서 접근 가능하게 export
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
          
          // 챕터별 CFI 매핑 저장
          const chapterCfiMap = new Map();

                     // 각 챕터의 텍스트 로드
           for (const item of toc) {
             if (!item.cfi) continue;
             
             // 챕터 번호 추출 (더 정확한 방법)
             let chapterNum = null;
             
             // 1. CFI에서 직접 챕터 번호 추출 (가장 정확)
             const cfiMatch = item.cfi.match(/\[chapter-(\d+)\]/);
             if (cfiMatch) {
               chapterNum = parseInt(cfiMatch[1]);
             }
             
             // 2. "Chapter 1", "CHAPTER 1" 형식
             if (!chapterNum) {
               const chapterMatch = item.label?.match(/Chapter\s+(\d+)/i);
               if (chapterMatch) {
                 chapterNum = parseInt(chapterMatch[1]);
               }
             }
             
             // 3. "1장", "1 장" 형식
             if (!chapterNum) {
               const koreanMatch = item.label?.match(/(\d+)\s*장/i);
               if (koreanMatch) {
                 chapterNum = parseInt(koreanMatch[1]);
               }
             }
             
             // 4. "1", "2" 등 숫자만 있는 경우
             if (!chapterNum) {
               const numberMatch = item.label?.match(/^(\d+)$/);
               if (numberMatch) {
                 chapterNum = parseInt(numberMatch[1]);
               }
             }
             
             // 5. "Chapter I", "Chapter II" 등 로마 숫자
             if (!chapterNum) {
               const romanMatch = item.label?.match(/Chapter\s+([IVX]+)/i);
               if (romanMatch) {
                 const romanNum = romanMatch[1];
                 // 간단한 로마 숫자 변환 (I=1, II=2, III=3, IV=4, V=5, VI=6, VII=7, VIII=8, IX=9)
                 const romanToNum = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9 };
                 chapterNum = romanToNum[romanNum];
               }
             }
             
             // 6. spine 인덱스를 챕터 번호로 사용 (최후의 수단)
             if (!chapterNum) {
               // spine에서 해당 항목의 인덱스 찾기
               for (let i = 0; i < bookInstance.spine.length; i++) {
                 const spineItem = bookInstance.spine.get(i);
                 if (spineItem && spineItem.href && item.cfi.includes(spineItem.href)) {
                   chapterNum = i + 1; // 1부터 시작하는 챕터 번호
                   break;
                 }
               }
             }
             
             if (chapterNum) {
               chapterCfiMap.set(chapterNum, item.cfi);
             }
            
            try {
              const chapterCfi = item.cfi.replace(/!.*$/, '');
              const chapter = await bookInstance.get(chapterCfi);
              if (chapter) {
                const text = chapter.textContent;
                chapterTexts.set(item.cfi, text);
              }
            } catch (e) {
              // 챕터 로드 실패
            }
          }
          
          // 챕터 CFI 매핑을 전역으로 저장
          window.chapterCfiMap = chapterCfiMap;

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
            
                         // 현재 챕터 감지 및 업데이트
             let currentChapter = 1;
             
             // 1. CFI에서 직접 챕터 번호 추출 (가장 확실한 방법)
             const cfiMatch = cfi?.match(/\[chapter-(\d+)\]/);
             if (cfiMatch) {
               currentChapter = parseInt(cfiMatch[1]);
             } else if (window.chapterCfiMap) {
               // 2. chapterCfiMap을 사용한 감지
               
               for (const [chapterNum, chapterCfi] of window.chapterCfiMap) {
                 if (cfi && cfi.includes(chapterCfi)) {
                   currentChapter = chapterNum;
                   break;
                 }
               }
             }
             
             // 전역에 현재 챕터 정보 저장
             window.currentChapter = currentChapter;

            // 전체 대비 현재 위치(%) 콘솔 출력
            if (bookInstance.locations && typeof bookInstance.locations.percentageFromCfi === 'function') {
              const percent = bookInstance.locations.percentageFromCfi(cfi);
              const percentDisplay = (percent * 100).toFixed(2);

              // 전체 글자수 및 챕터별 글자수, 현재 챕터 번호 추출
              const path = window.location.pathname;
              const fileName = path.split('/').pop();
              const bookId = fileName.replace('.epub', '');
              const totalLength = Number(localStorage.getItem(`totalLength_${bookId}`)) || 0;
              const chapterLengths = JSON.parse(localStorage.getItem(`chapterLengths_${bookId}`) || '{}');
              const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
              const chapterNum = chapterMatch ? parseInt(chapterMatch[1]) : 1;

              // 이전 챕터까지의 글자수 합
              let prevChaptersSum = 0;
              if (chapterNum > 1) {
                for (let i = 1; i < chapterNum; i++) {
                  prevChaptersSum += Number(chapterLengths[i] || 0);
                }
              }

              // 현재까지 읽은 글자수
              const currentCharCount = Math.max(0, Math.round(percent * totalLength) - prevChaptersSum);
            }

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

            // 페이지 글자 수 업데이트 (항상 재계산)
            updatePageCharCount();

            // 이벤트 데이터 가져오기 및 매칭 (항상 재계산)
            try {
              const events = getEventsForChapter(chapterNum);

              let currentEvent = null;

              if (events && events.length > 0) {
                const lastEvent = events[events.length - 1];
                const firstEvent = events[0];
                const currentChars = currentChapterCharsRef.current;

                if (currentChars >= lastEvent.end) {
                  currentEvent = { ...lastEvent, eventNum: lastEvent.event_id + 1, chapter: chapterNum };
                } else if (currentChars < firstEvent.start) {
                  currentEvent = { ...firstEvent, eventNum: firstEvent.event_id + 1, chapter: chapterNum };
                } else {
                  for (let i = events.length - 1; i >= 0; i--) {
                    const event = events[i];
                    if (currentChars >= event.start && currentChars < event.end) {
                      currentEvent = { ...event, eventNum: event.event_id + 1, chapter: chapterNum };
                      break;
                    }
                  }
                  // 혹시라도 매칭이 안 되면 가장 가까운 이벤트로 fallback
                  if (!currentEvent) {
                    currentEvent = { ...firstEvent, eventNum: firstEvent.event_id + 1, chapter: chapterNum };
                  }
                }
              } else {
                // 이벤트가 없음
              }
              onCurrentLineChange?.(currentChapterCharsRef.current, events.length, currentEvent || null);
            } catch (error) {
              onCurrentLineChange?.(currentChapterCharsRef.current, 0, null);
            }
          });

          const savedCfi = localStorage.getItem(LOCAL_STORAGE_KEY);
          const displayTarget = savedCfi || bookInstance.locations.cfiFromLocation(0);
          await rendition.display(displayTarget);

          // display 후 강제로 relocated 이벤트 트리거
          const location = await rendition.currentLocation();
          rendition.emit('relocated', location);

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

    // --- 전체 epub 글자수 및 챕터별 글자수 계산 후 localStorage 저장 useEffect ---
    useEffect(() => {
      // 1. 책 id 추출 (예: /user/viewer/gatsby.epub → gatsby)
      const path = window.location.pathname;
      const fileName = path.split('/').pop();
      if (!fileName || !fileName.endsWith('.epub')) return;
      const bookId = fileName.replace('.epub', '');

      // 2. 모든 책의 이벤트 파일을 glob import 후, bookId로 필터링
      const allEventModules = import.meta.glob('/src/data/*/chapter*_events.json');
      const modules = Object.entries(allEventModules)
        .filter(([path]) => path.includes(`/src/data/${bookId}/`))
        .map(([, mod]) => mod);

      const importAll = async () => {
        const chapters = await Promise.all(modules.map(fn => fn()));
        // 3. 각 챕터의 마지막 event의 end값 추출
        const lastEnds = chapters.map(events => {
          const arr = events.default || events;
          return arr[arr.length - 1]?.end || 0;
        });
        // 4. 전체 합산
        const totalLength = lastEnds.reduce((sum, end) => sum + end, 0);
        // 5. 챕터별 글자수 객체 생성 (1번 챕터부터)
        const chapterLengths = {};
        lastEnds.forEach((end, idx) => {
          chapterLengths[idx + 1] = end;
        });
        // 6. localStorage에 저장
        localStorage.setItem(`totalLength_${bookId}`, totalLength);
        localStorage.setItem(`chapterLengths_${bookId}`, JSON.stringify(chapterLengths));
      };
      importAll();
    }, []);

    return (
      <div className="w-full h-full relative flex items-center justify-center">
        {/* 이동 실패 안내 메시지 */}
        {navigationError && (
          <div style={{ position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', zIndex: 1000, background: '#ffefef', color: '#d32f2f', padding: '8px 18px', borderRadius: 8, fontWeight: 600, fontSize: 16, boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
            {navigationError}
          </div>
        )}
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