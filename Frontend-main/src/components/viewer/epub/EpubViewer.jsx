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
  detectCurrentChapter,
  storageUtils,
  getRefs,
  cleanupNavigation,
  ensureLocations,
  textUtils,
  settingsUtils,
  getSpreadMode,
  navigationUtils,
  cfiUtils,
  errorUtils
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

// 공통 네비게이션 로직 함수
const handleNavigation = async (book, rendition, direction, setIsNavigating, setNavigationError, storageKeys) => {
  console.log(`🚀 handleNavigation 시작: ${direction}`, {
    hasBook: !!book,
    hasSpine: !!book?.spine,
    hasRendition: !!rendition,
    renditionStarted: rendition?.started,
    renditionDisplaying: rendition?.displaying,
    spineLength: book?.spine?.length || 0
  });
  
  try {
    // 간단한 뷰어 상태 확인
    const hasSpine = !!book?.spine && book?.spine?.length > 0;
    const renditionReady = rendition?.started && rendition?.displaying !== undefined;
    
    console.log('🔍 뷰어 상태:', {
      hasSpine,
      spineLength: book?.spine?.length || 0,
      renditionReady,
      renditionStarted: rendition?.started,
      renditionDisplaying: rendition?.displaying
    });
    
    // 뷰어가 완전히 로드되지 않았으면 기본 네비게이션 사용
    if (!hasSpine || !renditionReady) {
      console.warn('⚠️ 뷰어가 완전히 로드되지 않았습니다. 기본 네비게이션으로 대체합니다.');
      
      try {
        if (direction === 'next') {
          await rendition.next();
          console.log('✅ 기본 next() 네비게이션 성공');
        } else {
          await rendition.prev();
          console.log('✅ 기본 prev() 네비게이션 성공');
        }
        return { success: true, method: 'basic', target: direction };
      } catch (basicError) {
        console.error('❌ 기본 네비게이션도 실패:', basicError);
        setNavigationError('페이지 이동에 실패했습니다. 뷰어가 완전히 로드될 때까지 기다려주세요.');
        return { success: false, error: basicError.message };
      }
    }
    
    // currentLocation 함수 확인
    if (!rendition?.currentLocation || typeof rendition.currentLocation !== 'function') {
      console.warn('⚠️ rendition.currentLocation이 준비되지 않았습니다');
      setNavigationError('뷰어가 아직 완전히 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
      return;
    }
    
    // 현재 위치 확인
    let currentLocation;
    try {
      currentLocation = rendition.currentLocation();
      console.log('📍 현재 위치:', currentLocation);
    } catch (err) {
      console.error('❌ 현재 위치 조회 실패:', err);
      setNavigationError('현재 위치를 확인할 수 없습니다.');
      return;
    }
    
    // 하이브리드 탐색 실행
    console.log('🔄 safeNavigate 호출 시작');
    const result = await navigationUtils.safeNavigate(book, rendition, async () => {
      console.log('🚀 페이지 이동 시도 시작');
      
      // 현재 위치를 확실히 구하기
      let retryCount = 0;
      const maxRetries = 5;
      let finalLocation = null;
      
      while (retryCount < maxRetries) {
        try {
          const currentLocation = rendition.currentLocation();
          console.log(`📍 현재 위치 확인 (${retryCount + 1}/${maxRetries}):`, currentLocation);
          
          if (currentLocation && currentLocation.start && currentLocation.start.cfi) {
            console.log('✅ 현재 위치 발견 - CFI:', currentLocation.start.cfi);
            finalLocation = currentLocation;
            break;
          }
          
          retryCount++;
          if (retryCount < maxRetries) {
            console.log(`⏳ 현재 위치 대기 중... (${retryCount}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        } catch (error) {
          console.error(`❌ 현재 위치 확인 시도 ${retryCount + 1} 실패:`, error);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
      
      if (!finalLocation || !finalLocation.start || !finalLocation.start.cfi) {
        console.error('❌ 현재 CFI를 찾을 수 없습니다 - 이동을 시도하지 않습니다');
        console.log('🔍 뷰어 상태 디버깅:', {
          hasRendition: !!rendition,
          hasCurrentLocation: typeof rendition.currentLocation === 'function',
          renditionStarted: rendition.started,
          renditionDisplaying: rendition.displaying,
          bookSpine: book?.spine ? 'exists' : 'missing'
        });
        
        throw new Error('현재 위치를 확인할 수 없어 페이지 이동을 할 수 없습니다. 뷰어가 완전히 로드될 때까지 기다려주세요.');
      }
      
      // CFI 인지하기
      let currentCfi = finalLocation.start.cfi;
      console.log('🎯 현재 CFI 정보:', {
        cfi: currentCfi,
        file: finalLocation.start.href,
        chapter: currentCfi.match(/\[chapter-(\d+)\]/)?.[1] || 'unknown',
        currentPage: finalLocation.start.displayed?.page || 'unknown',
        totalPages: finalLocation.start.displayed?.total || 'unknown',
        location: finalLocation.start.location || 'unknown',
        percentage: finalLocation.start.percentage || 'unknown',
        index: finalLocation.start.index || 'unknown'
      });
      
      // CFI가 유효하지 않다면 재계산 시도
      if (!currentCfi || !currentCfi.includes('epubcfi')) {
        console.log('⚠️ CFI가 유효하지 않습니다. 재계산 시도...');
        const recalculatedCfi = await cfiUtils.calculateCurrentCfi(book, rendition);
        if (recalculatedCfi) {
          currentCfi = recalculatedCfi;
          console.log('✅ CFI 재계산 성공:', currentCfi);
        } else {
          throw new Error('CFI를 계산할 수 없습니다');
        }
      }
      
      // 하이브리드 탐색 사용
      console.log('🚀 하이브리드 탐색 시작:', direction);
      
      const navigationResult = await cfiUtils.navigateWithFallback(book, rendition, direction);
      
      if (navigationResult.success) {
        console.log('✅ 하이브리드 탐색 성공:', {
          method: navigationResult.method,
          target: navigationResult.target
        });
        
        // 이동 후 위치 확인
        setTimeout(async () => {
          const newLocation = rendition.currentLocation();
          console.log('🔍 이동 후 실제 위치:', newLocation);
          
          if (newLocation && newLocation.start && newLocation.start.cfi) {
            console.log('📍 이동 후 CFI 정보:', {
              cfi: newLocation.start.cfi,
              file: newLocation.start.href,
              page: newLocation.start.displayed?.page || 'unknown'
            });
            
            if (newLocation.start.cfi !== currentCfi) {
              console.log('✅ CFI 변경 확인: 실제로 이동됨');
            } else {
              console.warn('⚠️ CFI 변경 없음: 같은 위치에 머물러 있음');
            }
          } else {
            console.warn('⚠️ 이동 후 위치를 확인할 수 없습니다');
          }
        }, 500);
        
        return navigationResult;
      } else {
        console.error('❌ 하이브리드 탐색 실패:', navigationResult.error);
        throw new Error(`페이지 이동에 실패했습니다: ${navigationResult.error}`);
      }
    }, direction, setIsNavigating, setNavigationError, storageKeys);
    
    console.log('✅ handleNavigation 완료:', result);
    return result;
    
  } catch (error) {
    console.error('❌ handleNavigation 오류:', error);
    setNavigationError(`페이지 이동 중 오류가 발생했습니다: ${error.message}`);
  }
};


const EpubViewer = forwardRef(
  (
    { book, onProgressChange, onCurrentPageChange, onTotalPagesChange, onCurrentChapterChange, onCurrentLineChange, settings, reloadKey, initialChapter, initialPage, initialProgress },
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
    const lastNavigationTimeRef = useRef(0);

    // 메모이제이션된 값들
    const { epubPath, storageKeys, pageMode, showGraph } = useMemo(() => {
      // epubPath 우선순위: book.epubPath > book.path > book.filename
      const rawPath = book.epubPath || book.path || book.filename || '';
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
    }, [book.epubPath, book.path, book.filename, settings?.pageMode, settings?.showGraph]);

    // 스프레드 모드 결정은 viewerUtils.js의 getSpreadMode 사용

    const smoothReload = useCallback((type = 'next') => {
      setReloading(type);
      setTimeout(() => {
        window.location.reload();
      }, 300);
    }, []);

    // 네비게이션 실패 시 대체 방법은 viewerUtils.js의 navigationUtils 사용

    // 글자 수 계산은 viewerUtils.js의 textUtils 사용

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
        const previousChars = textUtils.calculatePreviousParagraphsChars(paragraphs, currentParagraphNum);
        
        // 현재 단락의 부분 글자 수 계산
        const currentChars = textUtils.calculateCurrentParagraphChars(paragraphs, currentParagraphNum, charOffset);
        
        const totalCharCount = previousChars + currentChars;

        // 현재 페이지의 글자 수를 저장
        chapterPageCharsRef.current.set(currentCfi, totalCharCount);
        currentChapterCharsRef.current = totalCharCount;
      }, 50);
    }, []);


    // 챕터 번호 감지는 viewerUtils.js의 detectCurrentChapter 사용

    // 안전한 네비게이션은 viewerUtils.js의 navigationUtils 사용

    // 설정 적용은 viewerUtils.js의 settingsUtils.applyEpubSettings 사용

    // pageMode 또는 showGraph 변경 시 spread 모드 재적용
    useEffect(() => {
      if (renditionRef.current) {
        const { rendition } = getRefs(bookRef, renditionRef);
        if (rendition) {
          settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
        }
      }
    }, [pageMode, showGraph, settings?.fontSize, settings?.lineHeight]);

         useImperativeHandle(ref, () => ({
      prevPage: async () => {
        const { book, rendition } = getRefs(bookRef, renditionRef);
        
        console.log('🔄 prevPage 호출:', { 
          hasBook: !!book, 
          hasRendition: !!rendition,
          hasSpine: !!book?.spine,
          spineLength: book?.spine?.length || 0,
          renditionStarted: rendition?.started,
          renditionDisplaying: rendition?.displaying,
          isNavigating
        });
        
        // 이미 네비게이션 중이면 무시
        if (isNavigating) {
          console.log('ℹ️ 이미 네비게이션 중입니다. 잠시만 기다려주세요.');
          return;
        }
        
        // 중복 호출 방지를 위한 디바운싱
        const now = Date.now();
        if (lastNavigationTimeRef.current && now - lastNavigationTimeRef.current < 500) {
          console.log('ℹ️ 네비게이션 디바운싱: 너무 빠른 연속 호출 방지');
          return;
        }
        lastNavigationTimeRef.current = now;
        
        if (book && rendition) {
          console.log('🚀 강제 prev() 네비게이션 시도 (상태 무시)');
          try {
            await rendition.prev();
            console.log('✅ 강제 prev() 네비게이션 성공');
          } catch (error) {
            console.error('❌ 강제 prev() 네비게이션 실패:', error);
            setNavigationError('이전 페이지로 이동할 수 없습니다.');
          }
        } else {
          console.warn('⚠️ book 또는 rendition이 없습니다.', { book: !!book, rendition: !!rendition });
        }
      },
      nextPage: async () => {
        const { book, rendition } = getRefs(bookRef, renditionRef);
        
        console.log('🔄 nextPage 호출:', { 
          hasBook: !!book, 
          hasRendition: !!rendition,
          hasSpine: !!book?.spine,
          spineLength: book?.spine?.length || 0,
          renditionStarted: rendition?.started,
          renditionDisplaying: rendition?.displaying,
          isNavigating
        });
        
        // 이미 네비게이션 중이면 무시
        if (isNavigating) {
          console.log('ℹ️ 이미 네비게이션 중입니다. 잠시만 기다려주세요.');
          return;
        }
        
        // 중복 호출 방지를 위한 디바운싱
        const now = Date.now();
        if (lastNavigationTimeRef.current && now - lastNavigationTimeRef.current < 500) {
          console.log('ℹ️ 네비게이션 디바운싱: 너무 빠른 연속 호출 방지');
          return;
        }
        lastNavigationTimeRef.current = now;
        
        if (book && rendition) {
          console.log('🚀 강제 next() 네비게이션 시도 (상태 무시)');
          try {
            await rendition.next();
            console.log('✅ 강제 next() 네비게이션 성공');
          } catch (error) {
            console.error('❌ 강제 next() 네비게이션 실패:', error);
            setNavigationError('다음 페이지로 이동할 수 없습니다.');
          }
        } else {
          console.warn('⚠️ book 또는 rendition이 없습니다.', { book: !!book, rendition: !!rendition });
        }
      },
       getCurrentCfi: async () => {
         const rendition = renditionRef.current;
         if (!rendition) {
           return null;
         }
         
         // rendition이 완전히 초기화되었는지 확인
         if (typeof rendition.currentLocation !== 'function') {
           return null;
         }
         
         try {
           const location = await rendition.currentLocation();
           return location?.start?.cfi || null;
         } catch (error) {
           return null;
         }
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
      applySettings: () => {
        const { rendition } = getRefs(bookRef, renditionRef);
        if (rendition) {
          settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
        }
      },
      isNavigating,
      setIsNavigating,
    }), [isNavigating, pageMode, showGraph, storageKeys]);

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
          // 로깅 제거 - 너무 많이 출력됨
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
              
              // 챕터 번호 추출 (cfiUtils 함수 사용)
              let chapterNum = cfiUtils.extractChapterNumber(item.cfi, item.label);
              
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
            spread: getSpreadMode(pageMode, showGraph),
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
            
            if (cfi) {
              const locIdx = bookInstance.locations.locationFromCfi(cfi);
              const totalPages = bookInstance.locations.total;
              const pageNum = Math.min(locIdx + 1, totalPages);

              onCurrentPageChange?.(pageNum);
              onProgressChange?.(Math.round((locIdx / totalPages) * 100));
              storageUtils.set(storageKeys.lastCFI, cfi);
              
              // EPUB 정보 업데이트
              const epubInfo = {
                cfi: cfi,
                spinePos: location?.start?.spinePos,
                href: location?.start?.href,
                totalPages: totalPages,
                locationsLength: bookInstance.locations?.length() || 0,
                spineLength: bookInstance.spine?.length || 0,
                timestamp: Date.now()
              };
              
              storageUtils.set('epubInfo_' + (book.filename || 'book'), JSON.stringify(epubInfo));
            }
            
              // 현재 챕터 감지 및 업데이트 (통합된 함수 사용)
             const detectedChapter = detectCurrentChapter(cfi, chapterCfiMapRef.current);
             
             
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

              if (events && events.length > 0 && cfi) {
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

          // 초기 CFI 설정 개선 - URL 파라미터 우선 처리
          let displayTarget;
          
          // 1. URL 파라미터 기반 초기 위치 설정 (최우선)
          if (initialChapter || initialPage || initialProgress) {
            errorUtils.logInfo('loadBook', 'URL 파라미터 기반 초기 위치 설정', {
              chapter: initialChapter,
              page: initialPage,
              progress: initialProgress
            });
            
            try {
              await ensureLocations(bookInstance, 2000);
              
              if (initialProgress && initialProgress > 0) {
                // progress 기반 위치 설정
                const percent = Math.min(Math.max(initialProgress, 0), 100) / 100;
                displayTarget = bookInstance.locations.cfiFromPercentage(percent);
                errorUtils.logInfo('loadBook', 'Progress 기반 위치', { target: displayTarget });
              } else if (initialChapter && initialChapter > 0) {
                // chapter 기반 위치 설정
                const chapterCfi = chapterCfiMapRef.current.get(initialChapter);
                if (chapterCfi) {
                  displayTarget = chapterCfi;
                  errorUtils.logInfo('loadBook', 'Chapter 기반 위치', { target: displayTarget });
                } else {
                  // spine 인덱스 기반 위치 설정
                  const spineIndex = Math.max(0, initialChapter - 1);
                  const spineItem = bookInstance.spine.get(spineIndex);
                  if (spineItem) {
                    displayTarget = spineItem.href;
                    errorUtils.logInfo('loadBook', 'Spine 기반 위치', { target: displayTarget });
                  }
                }
              }
            } catch (error) {
              errorUtils.logWarning('loadBook', 'URL 파라미터 기반 위치 설정 실패', error);
            }
          }
          
          // 2. 저장된 CFI 사용 (URL 파라미터가 없을 때)
          if (!displayTarget) {
            const savedCfi = storageUtils.get(storageKeys.lastCFI);
          if (savedCfi) {
            displayTarget = savedCfi;
              errorUtils.logInfo('loadBook', '저장된 CFI 사용', { target: displayTarget });
            }
          }
          
          // 3. 기본 위치 설정 (최후의 수단)
          if (!displayTarget) {
            try {
              await ensureLocations(bookInstance, 2000);
              displayTarget = bookInstance.locations.cfiFromLocation(0);
              errorUtils.logInfo('loadBook', '기본 위치 사용', { target: displayTarget });
            } catch (e) {
              errorUtils.logWarning('loadBook', 'CFI 생성 실패, spine 기반으로 대체');
              const firstSpine = bookInstance.spine.get(0);
              displayTarget = firstSpine?.href;
              errorUtils.logInfo('loadBook', 'Spine 기본 위치', { target: displayTarget });
            }
          }
          
          await rendition.display(displayTarget);

          // display 후 강제로 relocated 이벤트 트리거
          const location = await rendition.currentLocation();
          
          // EPUB 필수 정보 저장
          const epubInfo = {
            cfi: location?.start?.cfi,
            spinePos: location?.start?.spinePos,
            href: location?.start?.href,
            totalPages: bookInstance.locations?.total || 0,
            locationsLength: bookInstance.locations?.length() || 0,
            spineLength: bookInstance.spine?.length || 0,
            timestamp: Date.now()
          };
          
          storageUtils.set(storageKeys.lastCFI, location?.start?.cfi);
          storageUtils.set('epubInfo_' + (book.filename || 'book'), JSON.stringify(epubInfo));
          
          // EPUB 필수 정보 저장
          
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
            settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
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
      showGraph, 
      pageMode, 
      storageKeys, 
      settings
    ]);

    // 설정이 변경될 때마다 적용
    useEffect(() => {
      if (renditionRef.current && settings) {
        const { rendition } = getRefs(bookRef, renditionRef);
        if (rendition) {
          settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
        }
      }
    }, [settings, pageMode, showGraph]);

    // 새로고침할 때마다 현재 화면에 보이는 CFI를 콘솔로 보여주기
    useEffect(() => {
      const showCurrentCFI = async () => {
        if (renditionRef.current) {
          console.log('🔄 새로고침 감지 - 현재 화면 CFI 확인 시작');
          
          let retryCount = 0;
          const maxRetries = 15; // 재시도 횟수 증가
          
          while (retryCount < maxRetries) {
            try {
              const currentLocation = renditionRef.current.currentLocation();
              console.log(`📍 현재 화면 CFI 확인 (${retryCount + 1}/${maxRetries}):`, currentLocation);
              
              // 뷰어 상태 상세 분석
              console.log('🔍 뷰어 상태 상세 분석:', {
                hasRendition: !!renditionRef.current,
                hasCurrentLocation: typeof renditionRef.current.currentLocation === 'function',
                renditionStarted: renditionRef.current.started,
                renditionDisplaying: renditionRef.current.displaying,
                renditionLocation: renditionRef.current.location,
                currentLocationType: typeof currentLocation,
                currentLocationKeys: currentLocation ? Object.keys(currentLocation) : 'null',
                startExists: currentLocation?.start ? 'exists' : 'missing',
                cfiExists: currentLocation?.start?.cfi ? 'exists' : 'missing'
              });
              
              if (currentLocation && currentLocation.start && currentLocation.start.cfi) {
                console.log('🎯 ===== 현재 화면에 보이는 CFI =====');
                console.log('📍 CFI:', currentLocation.start.cfi);
                console.log('📍 파일:', currentLocation.start.href);
                console.log('📍 챕터:', currentLocation.start.cfi.match(/\[chapter-(\d+)\]/)?.[1] || 'unknown');
                console.log('📍 현재 페이지:', currentLocation.start.displayed?.page || 'unknown');
                console.log('📍 전체 페이지:', currentLocation.start.displayed?.total || 'unknown');
                console.log('📍 위치:', currentLocation.start.location || 'unknown');
                console.log('📍 퍼센트:', currentLocation.start.percentage || 'unknown');
                console.log('🎯 ======================================');
                break;
              }
              
              retryCount++;
              if (retryCount < maxRetries) {
                console.log(`⏳ 현재 화면 CFI 대기 중... (${retryCount}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, 600)); // 대기 시간 증가
              }
            } catch (error) {
              console.error('❌ 현재 화면 CFI 확인 중 오류:', error);
              retryCount++;
              if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 600));
              }
            }
          }
          
          if (retryCount >= maxRetries) {
            console.warn('⚠️ 현재 화면 CFI를 찾을 수 없습니다 (15번 시도 후 실패)');
            console.log('🔍 최종 뷰어 상태:', {
              hasRendition: !!renditionRef.current,
              renditionStarted: renditionRef.current?.started,
              renditionDisplaying: renditionRef.current?.displaying,
              renditionLocation: renditionRef.current?.location
            });
          }
        }
      };
      
      // 새로고침 감지 시 현재 화면 CFI 즉시 표시
      const timer = setTimeout(showCurrentCFI, 800); // 대기 시간 증가
      return () => clearTimeout(timer);
    }, [reloadKey]); // reloadKey가 변경될 때마다 실행 (새로고침 감지)

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