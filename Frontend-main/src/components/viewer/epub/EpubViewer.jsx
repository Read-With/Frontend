import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
} from 'react';
import ePub from 'epubjs';

// eventRelationModules import 수정 - 프로젝트 루트 기준
const eventRelationModules = import.meta.glob('/src/data/*/[0-9][0-9]_ev*_relations.json', { eager: true });

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

    // 챕터별 누적 단어 수를 저장할 Map 추가
    const chapterWordCountsRef = useRef(new Map());
    // 현재 페이지의 단어 수를 저장
    const currentPageWordsRef = useRef(0);
    // 현재까지의 누적 단어 수를 저장
    const accumulatedWordsRef = useRef(0);

    const rawPath = book.path || book.filename;
    const epubPath = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
    const cleanPath = rawPath.replace(/^\/+/, '');

    const LOCAL_STORAGE_KEY = `readwith_${cleanPath}_lastCFI`;
    const NEXT_PAGE_FLAG = `readwith_nextPagePending`;
    const PREV_PAGE_FLAG = `readwith_prevPagePending`;
    const ACCUMULATED_WORDS_KEY = `readwith_${cleanPath}_accumulatedWords`;
    const NEXT_PAGE_WORDS_KEY = `readwith_${cleanPath}_nextPageWords`;
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
          
          // 챕터별 텍스트와 단어 배열 저장
          const chapterTexts = new Map();
          const chapterWords = new Map();

          // 각 챕터의 텍스트 로드
          for (const item of toc) {
            if (!item.cfi) continue;
            
            try {
              const chapterCfi = item.cfi.replace(/!.*$/, '');
              const chapter = await bookInstance.get(chapterCfi);
              if (chapter) {
                const text = chapter.textContent
                  .replace(/\s+/g, ' ')
                  .trim();
                // 정확한 단어 수 계산
                const wordCount = countWords(text);
                chapterTexts.set(item.cfi, text);
                chapterWords.set(item.cfi, wordCount);
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

          // 단어 수 계산을 위한 변수들 초기화
          let totalWordCount = 0;
          let currentPageWordCount = 0;

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
            
            try {
              // 현재 페이지의 내용 가져오기
              const currentLocation = await rendition.currentLocation();
              const currentCfi = currentLocation?.start?.cfi;
              
              if (currentCfi) {
                const contents = rendition.getContents();
                
                if (contents && contents.length > 0) {
                  const content = contents[0];
                  
                  if (content.document) {
                    // 현재 보이는 페이지의 내용만 가져오기
                    const visibleContent = content.document.body;
                    
                    if (!visibleContent) {
                      console.warn('페이지 내용을 찾을 수 없음');
                      return;
                    }

                    // 현재 페이지의 모든 단락 가져오기
                    const paragraphs = visibleContent.querySelectorAll('p');
                    let totalWordCount = 0;
                    
                    // 현재 단락까지의 단어 수만 계산
                    for (let i = 0; i < paragraphs.length && i < paragraphNum; i++) {
                      const paragraph = paragraphs[i];
                      const paragraphText = paragraph.textContent;
                      const wordsCount = countWords(paragraphText);
                      if (i + 1 === paragraphNum) {
                        // 현재 단락인 경우 charOffset을 기준으로 단어 수 계산 (대략적)
                        const approxWords = Math.ceil(charOffset / 10);
                        totalWordCount += Math.min(approxWords, wordsCount);
                      } else {
                        totalWordCount += wordsCount;
                      }
                    }
                    
                    // 로컬 스토리지에서 누적 단어 수 가져오기
                    let accumulatedWords = parseInt(localStorage.getItem(ACCUMULATED_WORDS_KEY) || '0');

                    // 현재 위치까지의 총 단어 수 계산
                    let wordPosition = accumulatedWords;

                    // 다음 페이지로 이동하는 경우에만 이전 단어 위치 확인
                    const isNextPage = localStorage.getItem(NEXT_PAGE_FLAG) === 'true';
                    const prevWordPosition = parseInt(localStorage.getItem(NEXT_PAGE_WORDS_KEY) || '0');

                    // 챕터가 변경되었을 때 단어 수 초기화
                    const prevChapter = parseInt(localStorage.getItem(CHAPTER_KEY) || '1');
                    if (chapterNum !== prevChapter) {
                      // 챕터 변경 시 초기화
                      accumulatedWords = 0;
                      wordPosition = 0;
                      localStorage.setItem(ACCUMULATED_WORDS_KEY, '0');
                      localStorage.setItem(NEXT_PAGE_WORDS_KEY, '0');
                      localStorage.setItem(CHAPTER_KEY, chapterNum.toString());
                      
                      // 현재 챕터의 첫 이벤트 정보 가져오기
                      try {
                        const events = getEventsForChapter(chapterNum);
                        if (events && events.length > 0) {
                          const firstEvent = events[0];
                          wordPosition = firstEvent.start;
                          accumulatedWords = firstEvent.start;
                          localStorage.setItem(ACCUMULATED_WORDS_KEY, firstEvent.start.toString());
                          console.log('📍', `chapter-${chapterNum} (${firstEvent.start}번째 단어)`);
                        } else {
                          console.log('📍', `chapter-${chapterNum} (0번째 단어)`);
                        }
                      } catch (error) {
                        console.error('이벤트 로딩 오류:', error);
                        console.log('📍', `chapter-${chapterNum} (0번째 단어)`);
                      }
                    }
                    // 챕터의 첫 페이지인 경우 단어 수 초기화
                    else if (pageNum === 1 && paragraphNum === 1 && charOffset === 0) {
                      // 첫 페이지에서도 첫 이벤트 정보 가져오기
                      try {
                        const events = getEventsForChapter(chapterNum);
                        if (events && events.length > 0) {
                          const firstEvent = events[0];
                          wordPosition = firstEvent.start;
                          accumulatedWords = firstEvent.start;
                          localStorage.setItem(ACCUMULATED_WORDS_KEY, firstEvent.start.toString());
                          console.log('📍', `chapter-${chapterNum} (${firstEvent.start}번째 단어)`);
                        } else {
                          accumulatedWords = 0;
                          wordPosition = 0;
                          localStorage.setItem(ACCUMULATED_WORDS_KEY, '0');
                          localStorage.setItem(NEXT_PAGE_WORDS_KEY, '0');
                          console.log('📍', `chapter-${chapterNum} (0번째 단어)`);
                        }
                      } catch (error) {
                        console.error('이벤트 로딩 오류:', error);
                        accumulatedWords = 0;
                        wordPosition = 0;
                        localStorage.setItem(ACCUMULATED_WORDS_KEY, '0');
                        localStorage.setItem(NEXT_PAGE_WORDS_KEY, '0');
                        console.log('📍', `chapter-${chapterNum} (0번째 단어)`);
                      }
                    } 
                    // 다음 페이지로 이동하면서 단어 수가 0이 되는 경우에만 이전 위치 유지
                    else if (isNextPage && totalWordCount === 0 && prevWordPosition > 0) {
                      wordPosition = prevWordPosition;
                      accumulatedWords = prevWordPosition;
                      localStorage.setItem(ACCUMULATED_WORDS_KEY, prevWordPosition.toString());
                      console.log('📍', `chapter-${chapterNum} (${prevWordPosition}번째 단어)`);
                    } else {
                      // 현재 페이지의 단어 수 계산
                      if (totalWordCount > 0) {
                        wordPosition = totalWordCount;
                        accumulatedWords = totalWordCount;
                        
                        // 다음 페이지를 위해 누적 단어 수 업데이트
                        if (paragraphNum === paragraphs.length) {
                          // 현재 페이지의 모든 단락의 단어 수 합산
                          const pageTotalWords = Array.from(paragraphs).reduce((sum, p) => {
                            return sum + countWords(p.textContent);
                          }, 0);
                          
                          accumulatedWords = pageTotalWords;
                          wordPosition = pageTotalWords;
                        }
                        localStorage.setItem(ACCUMULATED_WORDS_KEY, accumulatedWords.toString());
                        console.log('📍', `chapter-${chapterNum} (${wordPosition}번째 단어)`);
                      } else {
                        // 단어 수가 0인 경우 이전 위치 유지
                        wordPosition = prevWordPosition;
                        accumulatedWords = prevWordPosition;
                        localStorage.setItem(ACCUMULATED_WORDS_KEY, prevWordPosition.toString());
                        console.log('📍', `chapter-${chapterNum} (${prevWordPosition}번째 단어)`);
                      }
                    }
                    
                    // 다음 페이지를 위해 현재 단어 위치 저장
                    if (wordPosition > 0) {
                      localStorage.setItem(NEXT_PAGE_WORDS_KEY, wordPosition.toString());
                    }
                    
                    // 다음 페이지 플래그 제거
                    localStorage.removeItem(NEXT_PAGE_FLAG);
                    
                    // 이벤트 데이터 가져오기
                    try {
                      const events = getEventsForChapter(chapterNum);
                      // 다음 페이지로 이동하면서 단어 수가 0이 되는 경우 이전 위치 사용
                      const currentWordPosition = isNextPage && totalWordCount === 0 && prevWordPosition > 0 
                        ? prevWordPosition 
                        : wordPosition;
                      // [수정] start <= currentWordPosition < end 조건으로 이벤트 탐색
                      const currentEvent = events.find(event => currentWordPosition >= event.start && currentWordPosition < event.end);
                      onCurrentLineChange?.(currentWordPosition, events.length, currentEvent || null);
                      console.log('[EpubViewer onCurrentLineChange] wordIndex:', currentWordPosition, 'currentEvent:', currentEvent);
                    } catch (error) {
                      onCurrentLineChange?.(wordPosition, 0, null);
                      console.log('[EpubViewer onCurrentLineChange] wordIndex:', wordPosition, 'currentEvent: null');
                    }

                    // relocated 이벤트 핸들러 내 chapterNum 추출 후
                    if (onCurrentChapterChange) {
                      onCurrentChapterChange(chapterNum);
                    }
                  }
                }
              }
            } catch (error) {
              console.error('단어 수 계산 중 오류:', error);
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
      localStorage.setItem(ACCUMULATED_WORDS_KEY, '0');
      localStorage.setItem(NEXT_PAGE_WORDS_KEY, '0');
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