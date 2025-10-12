import React, {
  useRef,
  useImperativeHandle,
  forwardRef,
  useEffect,
  useState,
  useMemo,
  useCallback,
} from 'react';
import ePub from 'epubjs';
import { 
  calculateChapterProgress, 
  findClosestEvent,
  extractChapterNumber,
  storageUtils,
  getRefs,
  cleanupNavigation,
  ensureLocations
} from '../../../utils/viewerUtils';
import { registerCache, clearCache } from '../../../utils/common/cacheManager';

const eventRelationModules = import.meta.glob('../../../data/gatsby/chapter*_events.json', { eager: true });

// 캐시 매니저에 eventsCache 등록 (중복 등록 방지)
let eventsCache;
let isCacheRegistered = false;

const getEventsCache = () => {
  if (!eventsCache) {
    eventsCache = new Map();
  }
  if (!isCacheRegistered) {
    try {
      registerCache('eventsCache', eventsCache, { maxSize: 100, ttl: 600000 });
      isCacheRegistered = true;
    } catch (e) {
      // 이미 등록된 경우 무시
    }
  }
  return eventsCache;
};

const getEventsForChapter = (chapter) => {
  const chapterNum = String(chapter);
  const cache = getEventsCache();
  
  if (cache.has(chapterNum)) {
    return cache.get(chapterNum);
  }

  try {
    const textFilePath = Object.keys(eventRelationModules).find(path => 
      path.includes(`chapter${chapterNum}_events.json`)
    );
    
    if (!textFilePath) {
      cache.set(chapterNum, []);
      return [];
    }

    const textArray = eventRelationModules[textFilePath]?.default || [];

    const eventsWithMeta = textArray.map(event => ({
      ...event,
      event_id: event.event_id ?? 0,
      eventNum: event.event_id ?? 0,
      chapter: Number(chapter)
    }));

    const currentChapterEvents = eventsWithMeta.filter(event => 
      event.chapter === Number(chapter)
    );

    cache.set(chapterNum, currentChapterEvents);
    return currentChapterEvents;
  } catch (error) {
    cache.set(chapterNum, []);
    return [];
  }
};

const textUtils = {
  countCharacters: (text, element) => {
    if (!text) return 0;
    
    if (element) {
      const excludedClasses = ['.pg-boilerplate', '.pgheader', '.toc', '.dedication', '.epigraph'];
      if (excludedClasses.some(cls => element.closest(cls))) {
        return 0;
      }
    }

    return text
      .replace(/[\s\n\r\t]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .length;
  },

};

const EpubViewer = forwardRef(
  (
    { book, onProgressChange, onCurrentPageChange, onTotalPagesChange, onCurrentChapterChange, onCurrentLineChange, settings },
    ref
  ) => {
    const viewerRef = useRef(null);
    const bookRef = useRef(null);
    const renditionRef = useRef(null);
    const currentChapterCharsRef = useRef(0);
    const currentChapterRef = useRef(1);
    const chapterPageCharsRef = useRef(new Map());
    const chapterCfiMapRef = useRef(new Map());

    const [loading, setLoading] = useState(false);
    const [reloading, setReloading] = useState(false);
    const [error, setError] = useState(null);
    const [currentPath, setCurrentPath] = useState(null);
    const [isNavigating, setIsNavigating] = useState(false);
    const [navigationError, setNavigationError] = useState(null);

    // 메모이제이션된 값들
    const { epubPath, storageKeys, pageMode, showGraph } = useMemo(() => {
      const rawPath = book.path || book.filename || '';
      const path = rawPath && rawPath.startsWith('/') ? rawPath : '/' + rawPath;
      const clean = rawPath ? rawPath.replace(/^\/+/, '') : '';
      
      return {
        epubPath: path,
        storageKeys: {
          lastCFI: `readwith_${clean}_lastCFI`,
          nextPage: `readwith_nextPagePending`,
          prevPage: `readwith_prevPagePending`,
          chapter: `readwith_${clean}_prevChapter`
        },
        pageMode: settings?.pageMode || 'double',
        showGraph: settings?.showGraph || false
      };
    }, [book.path, book.filename, settings?.pageMode, settings?.showGraph]);

    // 스프레드 모드 결정 함수 (메모이제이션)
    const getSpreadMode = useCallback(() => {
      // 분할 화면 + 그래프 화면 (showGraph=true, graphFullScreen=false)에서는 뷰어 너비가 50%로 제한
      if (showGraph) {
        // 분할 화면: 50% 너비에 최적화하여 항상 한 페이지씩 표시
        // pageMode 설정과 관계없이 'none'으로 설정 (50% 너비에서는 두 페이지 표시가 부적절)
        return 'none';
      } else {
        // 전체 화면: pageMode에 따라 spread 모드 결정
        return pageMode === 'single' ? 'none' : 'always';
      }
    }, [pageMode, showGraph]);

    const smoothReload = useCallback((type = 'next') => {
      setReloading(type);
      setTimeout(() => {
        window.location.reload();
      }, 300);
    }, []);

    const fallbackDisplay = useCallback(async (direction = 'next') => {
      try {
        const { book, rendition } = getRefs(bookRef, renditionRef);
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
          storageUtils.set(
            direction === 'next' ? storageKeys.nextPage : storageKeys.prevPage,
            'true'
          );
          smoothReload(direction);
        }
      } catch (e) {
        smoothReload(direction);
      } finally {
        setReloading(false);
      }
    }, [storageKeys, smoothReload]);

    // 글자 수 계산 유틸리티 함수들 (중복 로직 제거)
    const calculateParagraphChars = useCallback((paragraph, element) => {
      return textUtils.countCharacters(paragraph.textContent, element);
    }, []);

    const calculatePreviousParagraphsChars = useCallback((paragraphs, currentParagraphNum) => {
      let charCount = 0;
      for (let i = 0; i < currentParagraphNum - 1; i++) {
        const paragraph = paragraphs[i];
        if (paragraph) {
          charCount += calculateParagraphChars(paragraph, paragraph);
        }
      }
      return charCount;
    }, [calculateParagraphChars]);

    const calculateCurrentParagraphChars = useCallback((paragraphs, currentParagraphNum, charOffset) => {
      if (currentParagraphNum > 0 && paragraphs[currentParagraphNum - 1]) {
        const currentParagraph = paragraphs[currentParagraphNum - 1];
        const currentParagraphChars = calculateParagraphChars(currentParagraph, currentParagraph);
        return Math.min(charOffset, currentParagraphChars);
      }
      return 0;
    }, [calculateParagraphChars]);

    // 페이지 이동 시 글자 수 계산 및 표시 함수 (디바운싱 적용)
    const updatePageCharCountTimer = useRef(null);
    
    const updatePageCharCount = useCallback((direction = 'next') => {
      // 이전 타이머 취소
      if (updatePageCharCountTimer.current) {
        clearTimeout(updatePageCharCountTimer.current);
      }
      
      // 50ms 디바운싱
      updatePageCharCountTimer.current = setTimeout(() => {
        const rendition = renditionRef.current;
        if (!rendition) return;

        const currentCfi = rendition.currentLocation()?.start?.cfi;
        if (!currentCfi) return;

        const contents = rendition.getContents();
        if (!contents || contents.length === 0) return;

        // CFI에서 현재 단락 번호와 문자 오프셋 추출
        const paragraphMatch = currentCfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
        const currentParagraphNum = paragraphMatch ? parseInt(paragraphMatch[1]) : 0;
        const charOffset = paragraphMatch ? parseInt(paragraphMatch[2]) : 0;

        const currentPage = contents[0];
        const paragraphs = currentPage.document.querySelectorAll('p');

        // 이전 단락들의 글자 수 계산
        const previousChars = calculatePreviousParagraphsChars(paragraphs, currentParagraphNum);
        
        // 현재 단락의 부분 글자 수 계산
        const currentChars = calculateCurrentParagraphChars(paragraphs, currentParagraphNum, charOffset);
        
        const totalCharCount = previousChars + currentChars;

        // 현재 페이지의 글자 수를 저장
        chapterPageCharsRef.current.set(currentCfi, totalCharCount);
        currentChapterCharsRef.current = totalCharCount;
      }, 50);
    }, [calculatePreviousParagraphsChars, calculateCurrentParagraphChars]);


    // 챕터 번호 감지 함수 (중복 로직 통합)
    const detectCurrentChapter = useCallback((cfi) => {
      let detectedChapter = extractChapterNumber(cfi);
      
      if (detectedChapter === 1 && chapterCfiMapRef.current.size > 0) {
        for (const [chapterNum, chapterCfi] of chapterCfiMapRef.current) {
          if (cfi && cfi.includes(chapterCfi)) {
            detectedChapter = chapterNum;
            break;
          }
        }
      }
      
      return detectedChapter;
    }, []);

    const safeNavigate = useCallback(async (action, direction = 'next') => {
      const { book, rendition } = getRefs(bookRef, renditionRef);
      if (!book || !rendition || isNavigating) return;
      setIsNavigating(true);
      setNavigationError(null);

      let relocatedFired = false;
      const relocatedHandler = () => {
        relocatedFired = true;
        cleanupNavigation(setIsNavigating, rendition, relocatedHandler);
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
          cleanupNavigation(setIsNavigating, rendition, relocatedHandler);
        }
      } catch {
        cleanupNavigation(setIsNavigating, rendition, relocatedHandler);
        setNavigationError('이동 중 오류가 발생했습니다.');
        await fallbackDisplay(direction);
      }
    }, [isNavigating, fallbackDisplay]);

    // 설정 적용 함수
    const applySettings = useCallback(() => {
      const { book, rendition } = getRefs(bookRef, renditionRef);
      if (!book || !rendition) return;
      
      // 스프레드 모드 설정 - 화면 모드 전환 시에도 유지
      rendition.spread(getSpreadMode());
      
      // 글꼴 크기 적용 (설정이 있는 경우)
      if (settings?.fontSize) {
        const fontSize = settings.fontSize / 100;
      rendition.themes.fontSize(`${fontSize * 100}%`);
      }
      
      // 줄 간격 적용 (설정이 있는 경우)
      if (settings?.lineHeight) {
      rendition.themes.override('body', {
          'line-height': `${settings.lineHeight}`
      });
      }
      
    }, [getSpreadMode, settings]);

    // pageMode 또는 showGraph 변경 시 spread 모드 재적용
    useEffect(() => {
      if (renditionRef.current) {
        applySettings();
      }
    }, [pageMode, showGraph, settings?.fontSize, settings?.lineHeight, applySettings]);

         useImperativeHandle(ref, () => ({
       prevPage: () => safeNavigate(() => renditionRef.current.prev(), 'prev'),
       nextPage: () => safeNavigate(() => renditionRef.current.next(), 'next'),
       getCurrentCfi: async () => {
         if (!renditionRef.current?.currentLocation) return null;
         const location = await renditionRef.current.currentLocation();
         return location?.start?.cfi || null;
       },
       book: bookRef.current,
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
            await renditionRef.current.display(cfi);
            
            const currentLocation = await renditionRef.current.currentLocation();
            const currentCfi = currentLocation?.start?.cfi;
            
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
        const { book, rendition } = getRefs(bookRef, renditionRef);
        if (!book || !rendition) return;
        try {
          await ensureLocations(book, 2000);
          const lastCfi = book.locations.cfiFromPercentage(1.0);
          await rendition.display(lastCfi || book.spine.last()?.href);
        } catch (e) {
          // 마지막 페이지 이동 실패
        }
      },
      moveToProgress: async (percentage) => {
        const { book, rendition } = getRefs(bookRef, renditionRef);
        if (!book || !rendition) return;

        await ensureLocations(book, 3000);
        const percent = Math.min(Math.max(percentage, 0), 100) / 100;
        const targetCfi = book.locations.cfiFromPercentage(percent);
        await rendition.display(targetCfi || (percent < 0.5 ? 0 : book.spine.last()?.href));
      },
      applySettings: () => applySettings(),
      isNavigating,
    }), [safeNavigate, applySettings, isNavigating]);

    useEffect(() => {
      const loadBook = async () => {
        if (!epubPath || !viewerRef.current || !viewerRef.current.tagName || epubPath === currentPath) return;

        setLoading(true);
        setError(null);

        if (bookRef.current) bookRef.current.destroy();
        if (viewerRef.current && viewerRef.current.tagName) {
          viewerRef.current.innerHTML = '';
        }

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
          const newChapterCfiMap = new Map();

          // 각 챕터의 텍스트 병렬 로드
          await Promise.all(
            toc.map(async (item) => {
              if (!item.cfi) return;
              
              // 챕터 번호 추출 (utils 함수 사용)
              let chapterNum = extractChapterNumber(item.cfi, item.label);
              
              // spine 인덱스를 챕터 번호로 사용 (최후의 수단)
              if (chapterNum === 1) {
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
                newChapterCfiMap.set(chapterNum, item.cfi);
              }
              
              try {
                const chapterCfi = item.cfi.replace(/!.*$/, '');
                const chapter = await bookInstance.get(chapterCfi);
                if (chapter) {
                  const text = chapter.textContent;
                  chapterTexts.set(item.cfi, text);
                }
              } catch (e) {
                // 챕터 로드 실패 (무시)
              }
            })
          );
          
          // 챕터 CFI 매핑을 ref로 저장
          chapterCfiMapRef.current = newChapterCfiMap;

          // viewerRef.current가 유효한 DOM 요소인지 확인
          if (!viewerRef.current || !viewerRef.current.tagName) {
            throw new Error("뷰어 컨테이너가 유효하지 않습니다.");
          }

          const rendition = bookInstance.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: getSpreadMode(),
            manager: 'default',
            flow: 'paginated',
            maxSpreadPages: (showGraph || pageMode === 'single') ? 1 : 2,
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

          const relocatedHandler = async (location) => {
            setLoading(false);
            const cfi = location?.start?.cfi;
            const locIdx = bookInstance.locations.locationFromCfi(cfi);
            const totalPages = bookInstance.locations.total;
            const pageNum = Math.min(locIdx + 1, totalPages);

            onCurrentPageChange?.(pageNum);
            onProgressChange?.(Math.round((locIdx / totalPages) * 100));
            storageUtils.set(storageKeys.lastCFI, cfi);
            
              // 현재 챕터 감지 및 업데이트 (통합된 함수 사용)
             const detectedChapter = detectCurrentChapter(cfi);
             
             
             // ViewerPage에 챕터 변경 알림
             const prevChapter = currentChapterRef.current;
             if (detectedChapter !== prevChapter) {
               onCurrentChapterChange?.(detectedChapter);
             }



            // 챕터가 변경되었을 때 초기화
            if (detectedChapter !== currentChapterRef.current) {
              currentChapterRef.current = detectedChapter;
              chapterPageCharsRef.current.clear();
            }

            // 페이지 글자 수 업데이트 (항상 재계산)
            updatePageCharCount();
            const currentChars = currentChapterCharsRef.current;

            // 이벤트 데이터 가져오기 및 매칭 (개선된 버전 - CFI 기반 정확한 계산)
            try {
              const events = getEventsForChapter(detectedChapter);
              let currentEvent = null;

              if (events && events.length > 0) {
                // 새로운 개선된 함수 사용: CFI 기반 정확한 위치 계산
                const progressInfo = calculateChapterProgress(cfi, detectedChapter, events, bookInstance);
                const closestEvent = findClosestEvent(cfi, detectedChapter, events, null, bookInstance);
                
                if (closestEvent) {
                  currentEvent = {
                    ...closestEvent,
                    chapterProgress: progressInfo.progress,
                    currentChars: progressInfo.currentChars,
                    totalChars: progressInfo.totalChars,
                    calculationMethod: progressInfo.calculationMethod
                  };
                }
              }
              
              onCurrentLineChange?.(currentEvent?.currentChars || currentChars, events?.length || 0, currentEvent || null);
            } catch (error) {
              onCurrentLineChange?.(currentChars, 0, null);
            }
          };
          
          rendition.on('relocated', relocatedHandler);

          const savedCfi = storageUtils.get(storageKeys.lastCFI);
          const displayTarget = savedCfi || bookInstance.locations.cfiFromLocation(0);
          await rendition.display(displayTarget);

          // display 후 강제로 relocated 이벤트 트리거
          const location = await rendition.currentLocation();
          rendition.emit('relocated', location);

          if (storageUtils.get(storageKeys.nextPage) === 'true') {
            storageUtils.remove(storageKeys.nextPage);
            setTimeout(() => rendition.next(), 200);
          }
          if (storageUtils.get(storageKeys.prevPage) === 'true') {
            storageUtils.remove(storageKeys.prevPage);
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
        // 타이머 정리
        if (updatePageCharCountTimer.current) {
          clearTimeout(updatePageCharCountTimer.current);
        }
        // Book destroy가 모든 이벤트 리스너를 자동으로 정리함
        if (bookRef.current) {
          try {
            bookRef.current.destroy();
          } catch (e) {
            // destroy 중 에러 무시
          }
        }
        // 캐시 정리
        clearCache('eventsCache');
      };
    }, [
      epubPath, 
      currentPath, 
      getSpreadMode, 
      showGraph, 
      pageMode, 
      storageKeys, 
      detectCurrentChapter, 
      updatePageCharCount,
      onCurrentPageChange,
      onProgressChange,
      onCurrentChapterChange,
      onCurrentLineChange,
      onTotalPagesChange,
      applySettings,
      settings
    ]);

    // 설정이 변경될 때마다 적용
    useEffect(() => {
      if (renditionRef.current && settings) {
        applySettings();
      }
    }, [settings, applySettings]);

    // 앱이 처음 로드될 때 로컬 스토리지 초기화
    useEffect(() => {
      storageUtils.set(storageKeys.chapter, '1');
    }, [storageKeys.chapter]);

    // --- 전체 epub 글자수 및 챕터별 글자수 계산 후 localStorage 저장 useEffect ---
    const bookId = useMemo(() => {
      const path = window.location.pathname;
      const fileName = path.split('/').pop();
      if (!fileName || !fileName.endsWith('.epub')) return null;
      return fileName.replace('.epub', '');
    }, []);

    useEffect(() => {
      if (!bookId) return;

      // 모든 책의 이벤트 파일을 glob import 후, bookId로 필터링
      const allEventModules = import.meta.glob('/src/data/*/chapter*_events.json');
      const modules = Object.entries(allEventModules)
        .filter(([path]) => path.includes(`/src/data/${bookId}/`))
        .map(([, mod]) => mod);

      const importAll = async () => {
        const chapters = await Promise.all(modules.map(fn => fn()));
        
        // 각 챕터의 마지막 event의 end값 추출
        const lastEnds = chapters.map(events => {
          const arr = events.default || events;
          return arr[arr.length - 1]?.end || 0;
        });
        
        // 전체 합산
        const totalLength = lastEnds.reduce((sum, end) => sum + end, 0);
        
        // 챕터별 글자수 객체 생성 (1번 챕터부터)
        const chapterLengths = {};
        lastEnds.forEach((end, idx) => {
          chapterLengths[idx + 1] = end;
        });
        
        // localStorage에 저장
        storageUtils.set(`totalLength_${bookId}`, totalLength);
        storageUtils.setJson(`chapterLengths_${bookId}`, chapterLengths);
      };
      
      importAll();
    }, [bookId]);

    // 생동감 있는 로딩 컴포넌트
    const LoadingComponent = ({ message, isError = false }) => (
      <div className="flex flex-col items-center justify-center space-y-6 absolute inset-0 z-50 pointer-events-none animate-fade-in">
        {!isError ? (
          <div className="text-center">
            <span className="text-gray-700 font-medium text-lg">epub 파일을 불러오고 있습니다...</span>
          </div>
        ) : (
          // 에러 상태
          <div className="flex flex-col items-center space-y-4 animate-shake">
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
              <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold">
                !
              </div>
            </div>
            <div className="bg-red-50/95 border border-red-200 rounded-xl px-6 py-4 text-center">
              <span className="text-red-700 font-medium">{message}</span>
            </div>
          </div>
        )}
      </div>
    );

    // 네비게이션 오류 메시지 컴포넌트  
    const NavigationError = ({ message }) => (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 animate-fade-in">
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg shadow-lg font-medium">
          {message}
        </div>
      </div>
    );

    return (
      <div className="w-full h-full relative flex items-center justify-center">
        {/* 네비게이션 오류 메시지 */}
        {navigationError && <NavigationError message={navigationError} />}
        
        {/* 로딩 및 오류 상태 */}
        {!reloading && loading && <LoadingComponent message="책을 불러오는 중..." />}
        {!reloading && error && <LoadingComponent message={error} isError />}
        
        {/* EPUB 뷰어 */}
        <div
          ref={viewerRef}
          className="w-full h-full transition-colors duration-300"
          style={{
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