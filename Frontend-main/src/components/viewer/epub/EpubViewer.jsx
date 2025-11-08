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
import { toast } from 'react-toastify';
import { 
  calculateChapterProgress, 
  findClosestEvent,
  detectCurrentChapter,
  storageUtils,
  getRefs,
  ensureLocations,
  textUtils,
  settingsUtils,
  getSpreadMode,
  navigationUtils,
  cfiUtils,
  errorUtils
} from '../../../utils/viewerUtils';
import { getBookProgress } from '../../../utils/common/api';
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

// EPUB 인스턴스 및 Blob 캐시
let epubCache = new Map();
let isEpubCacheRegistered = false;

// 전역 EPUB 인스턴스 저장 (graph 페이지로 가도 유지)
const globalEpubInstances = new Map(); // currentSource -> { bookInstance, rendition, viewerRef }

const getEpubCache = () => {
  if (!isEpubCacheRegistered) {
    try {
      registerCache('epubCache', epubCache, { maxSize: 10, ttl: 3600000 }); // 1시간 캐시
      isEpubCacheRegistered = true;
    } catch (e) {
      // 이미 등록된 경우 무시
    }
  }
  return epubCache;
};

// EPUB 캐시 키 생성
const getEpubCacheKey = (epubPath, epubSource, bookId) => {
  if (epubSource) {
    // 로컬 파일인 경우
    return `local_${bookId || 'unknown'}`;
  }
  // 경로 기반인 경우
  return epubPath || `book_${bookId || 'unknown'}`;
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
    const [error, setError] = useState(null);
    const [isNavigating, setIsNavigating] = useState(false);
    const [navigationError, setNavigationError] = useState(null);
    const lastNavigationTimeRef = useRef(0);
    const isLoadingRef = useRef(false);
    const currentPathRef = useRef(null); // 동기적 확인용

    // 메모이제이션된 값들
    // EPUB 파일은 항상 IndexedDB에서만 로드
    const { epubPath, epubSource, originalS3Url, storageKeys, pageMode, showGraph } = useMemo(() => {
      const clean = book.id?.toString() || book.filename || 'book';
      
      return {
        epubPath: null, // 서버는 EPUB 파일을 제공하지 않음
        epubSource: null, // 항상 IndexedDB에서 로드 (메모리 사용 안 함)
        originalS3Url: null, // 서버는 EPUB 파일을 제공하지 않음
        storageKeys: {
          lastCFI: `readwith_${clean}_lastCFI`,
          nextPage: `readwith_nextPagePending`,
          prevPage: `readwith_nextPagePending`,
          chapter: `readwith_${clean}_prevChapter`
        },
        pageMode: settings?.pageMode || 'double',
        showGraph: settings?.showGraph || false
      };
    }, [book.id, book.filename, settings?.pageMode, settings?.showGraph]);


    const updatePageCharCountTimer = useRef(null);
    
    const updatePageCharCount = useCallback((direction = 'next') => {
      if (updatePageCharCountTimer.current) {
        clearTimeout(updatePageCharCountTimer.current);
      }
      
      updatePageCharCountTimer.current = setTimeout(() => {
        const rendition = renditionRef.current;
        if (!rendition) return;

        const currentCfi = rendition.currentLocation()?.start?.cfi;
        if (!currentCfi) return;

        const contents = rendition.getContents();
        if (!contents || contents.length === 0) return;

        const paragraphMatch = currentCfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
        const currentParagraphNum = paragraphMatch ? parseInt(paragraphMatch[1]) : 0;
        const charOffset = paragraphMatch ? parseInt(paragraphMatch[2]) : 0;

        const currentPage = contents[0];
        const paragraphs = currentPage.document.querySelectorAll('p');

        const previousChars = textUtils.calculatePreviousParagraphsChars(paragraphs, currentParagraphNum);
        const currentChars = textUtils.calculateCurrentParagraphChars(paragraphs, currentParagraphNum, charOffset);
        const totalCharCount = previousChars + currentChars;

        chapterPageCharsRef.current.set(currentCfi, totalCharCount);
        currentChapterCharsRef.current = totalCharCount;
      }, 50);
    }, []);

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
        
        if (isNavigating || isLoadingRef.current) return;
        
        const now = Date.now();
        if (lastNavigationTimeRef.current && now - lastNavigationTimeRef.current < 500) {
          return;
        }
        lastNavigationTimeRef.current = now;
        
        if (!book || !rendition) {
          setNavigationError('뷰어가 준비되지 않았습니다.');
          return;
        }
        
        if (!book.spine || book.spine.length === 0) {
          setNavigationError('EPUB 로드 중입니다. 잠시만 기다려주세요.');
          return;
        }
      
      await navigationUtils.safeNavigate(
        book, 
        rendition, 
        async () => await cfiUtils.navigateWithFallback(book, rendition, 'prev'),
        'prev',
        setIsNavigating,
        setNavigationError,
        storageKeys
      );
    },
    
      nextPage: async () => {
        const { book, rendition } = getRefs(bookRef, renditionRef);
        
        if (isNavigating || isLoadingRef.current) return;
        
        const now = Date.now();
        if (lastNavigationTimeRef.current && now - lastNavigationTimeRef.current < 500) {
          return;
        }
        lastNavigationTimeRef.current = now;
        
        if (!book || !rendition) {
          setNavigationError('뷰어가 준비되지 않았습니다.');
          return;
        }
        
        if (!book.spine || book.spine.length === 0) {
          setNavigationError('EPUB 로드 중입니다. 잠시만 기다려주세요.');
          return;
        }
      
      await navigationUtils.safeNavigate(
        book, 
        rendition, 
        async () => await cfiUtils.navigateWithFallback(book, rendition, 'next'),
        'next',
        setIsNavigating,
        setNavigationError,
        storageKeys
      );
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
    }), [isNavigating, pageMode, showGraph, storageKeys, loading]);

    useEffect(() => {
      let retryTimeout = null;
      
      const loadBook = async () => {
        // EPUB 파일은 항상 IndexedDB에서만 로드
        // 뷰어에서 EPUB을 보여줄 때만 책 이름(제목)으로 IndexedDB에서 찾기
        let actualEpubSource = null;
        let targetBookId = null;
        let apiProgressData = null;
        
        // book.id가 없으면 에러
        if (!book.id) {
          setError('책 정보가 올바르지 않습니다.');
          setLoading(false);
          return;
        }
        
        // 서버에서 책 정보 로딩 중이면 대기 (최대 10초)
        if (!book.title || book.title === '로딩 중...') {
          setLoading(true);
          
          // 10초 후에도 로딩 중이면 에러 표시
          retryTimeout = setTimeout(() => {
            if (!book.title || book.title === '로딩 중...') {
              setError('책 정보를 불러오는 데 시간이 너무 오래 걸립니다. 새로고침해주세요.');
              setLoading(false);
            }
          }, 10000);
          
          return;
        }
        
        // 서버에서 책 정보를 가져오지 못한 경우 (3초 후 에러)
        if (book.title.startsWith('Book ')) {
          setLoading(true);
          
          // 3초 후에도 여전히 'Book X' 형태면 에러 표시
          retryTimeout = setTimeout(() => {
            if (book.title.startsWith('Book ')) {
              setError('책 정보를 불러올 수 없습니다. 책이 존재하지 않거나 권한이 없습니다.');
              setLoading(false);
            }
          }, 3000);
          
          return;
        }
        
        if (book && typeof book.id === 'number') {
          try {
            const apiProgressResponse = await getBookProgress(book.id);
            if (apiProgressResponse?.isSuccess && apiProgressResponse?.result) {
              apiProgressData = apiProgressResponse.result;
              if (apiProgressData.chapterIdx) {
                currentChapterRef.current = apiProgressData.chapterIdx;
              }
            }
          } catch (progressError) {
            if (!progressError?.message?.includes('404')) {
              console.warn('API 진도 조회 실패:', progressError);
            }
            apiProgressData = null;
          }
        }

        try {
          const { getAllLocalBookIds, loadLocalBookBuffer, saveLocalBookBuffer } = await import('../../../utils/localBookStorage');
          
          // 제목 정규화 함수
          const normalizeTitle = (title) => {
            if (!title) return '';
            return title
              .toLowerCase()
              .trim()
              .replace(/\s+/g, ' ')
              .replace(/[^\w\s가-힣]/g, '')
              .replace(/\s/g, '');
          };
          
          const normalizedBookTitle = normalizeTitle(book.title);
          
          // IndexedDB는 정규화된 책 제목을 키로 사용
          // 1단계: 정규화된 제목으로 직접 찾기
          if (normalizedBookTitle) {
            actualEpubSource = await loadLocalBookBuffer(normalizedBookTitle);
            if (actualEpubSource) {
              targetBookId = normalizedBookTitle;
            }
          }
          
          // 3단계: IndexedDB에 없으면 메모리에서 찾아서 저장
          if (!actualEpubSource) {
            if (book.epubFile || book.epubArrayBuffer) {
              let bufferToSave = null;
              if (book.epubArrayBuffer instanceof ArrayBuffer) {
                bufferToSave = book.epubArrayBuffer;
              } else if (book.epubFile instanceof File) {
                bufferToSave = await book.epubFile.arrayBuffer();
              }
              
              if (bufferToSave) {
                // 정규화된 제목을 키로 사용하여 저장
                targetBookId = normalizedBookTitle || 'temp';
                await saveLocalBookBuffer(targetBookId, bufferToSave);
                actualEpubSource = bufferToSave;
              } else {
                setError('EPUB 파일을 찾을 수 없습니다. 다시 업로드해주세요.');
                setLoading(false);
                return;
              }
            } else {
              setError('EPUB 파일을 찾을 수 없습니다. 다시 업로드해주세요.');
              setLoading(false);
              return;
            }
          }
        } catch (error) {
          setError('EPUB 파일 로드에 실패했습니다.');
          setLoading(false);
          return;
        }
        
        // epubSource와 targetBookId 확인 (이미 위에서 체크했지만 안전장치)
        if (!actualEpubSource || !targetBookId) {
          setError('EPUB 파일을 찾을 수 없습니다. IndexedDB에서 로드에 실패했습니다.');
          setLoading(false);
          return;
        }
        
        // IndexedDB ID 기반으로 currentSource 생성
        const currentSource = `local_${targetBookId}`;
        
        // 같은 책으로 다시 돌아온 경우 (graph에서 돌아오기 등)
        // 전역 인스턴스에서 확인
        const globalInstance = globalEpubInstances.get(currentSource);
        if (globalInstance && globalInstance.bookInstance && globalInstance.rendition && globalInstance.viewerRef) {
          // 전역 인스턴스가 있으면 재사용
          
          // ref에 전역 인스턴스 할당
          bookRef.current = globalInstance.bookInstance;
          renditionRef.current = globalInstance.rendition;
          
          // viewerRef가 다르면 새로 렌더링해야 함
          if (globalInstance.viewerRef !== viewerRef.current) {
            // 전역 인스턴스의 rendition을 현재 viewerRef에 다시 렌더링
            if (globalInstance.rendition && viewerRef.current) {
              try {
                // 기존 rendition을 destroy하고 새로 렌더링
                globalInstance.rendition.destroy();
                const newRendition = globalInstance.bookInstance.renderTo(viewerRef.current, {
                  width: '100%',
                  height: '100%',
                  spread: getSpreadMode(pageMode, showGraph),
                  manager: 'default',
                  flow: 'paginated',
                  maxSpreadPages: (showGraph || pageMode === 'single') ? 1 : 2,
                });
                renditionRef.current = newRendition;
                globalInstance.rendition = newRendition;
                globalInstance.viewerRef = viewerRef.current;
              } catch (e) {
                // 재렌더링 실패 무시
              }
            }
          }
          
          // 현재 위치 복원
          try {
            const savedCfi = storageUtils.get(storageKeys.lastCFI);
            if (savedCfi && renditionRef.current) {
              await renditionRef.current.display(savedCfi);
            }
          } catch (e) {
            // CFI 복원 실패는 무시
          }
          
          setLoading(false);
          setError(null);
          isLoadingRef.current = false;
          currentPathRef.current = currentSource;
          return;
        }
        
        // currentPathRef로 같은 책인지 확인 (로컬 체크)
        if (currentSource === currentPathRef.current) {
          // 이미 로드 중이면 대기
          if (isLoadingRef.current) {
            return;
          }
          
          // 로컬 ref가 있으면 재사용
          if (bookRef.current && renditionRef.current && viewerRef.current) {
            setLoading(false);
            setError(null);
            return;
          }
        }

        if (isLoadingRef.current) {
          return;
        }
        isLoadingRef.current = true;
        currentPathRef.current = currentSource;
        
        if (!viewerRef.current || !viewerRef.current.tagName) {
          await new Promise(resolve => setTimeout(resolve, 50));
          
          if (!viewerRef.current || !viewerRef.current.tagName) {
            isLoadingRef.current = false;
            currentPathRef.current = null;
            return;
          }
        }

        setLoading(true);
        setError(null);

        // 같은 책이면 이전 인스턴스를 재사용 (graph에서 돌아온 경우)
        if (currentSource === currentPathRef.current && bookRef.current && renditionRef.current && viewerRef.current) {
          // 이미 로드된 경우 재사용 (destroy하지 않음)
          // viewerRef 내용은 유지 (이미 렌더링되어 있음)
          // 책 인스턴스는 재사용하므로 새로 생성하지 않음
          // 아래 로직을 건너뛰고 바로 display만 수행
          try {
            const savedCfi = storageUtils.get(storageKeys.lastCFI);
            if (savedCfi && renditionRef.current) {
              await renditionRef.current.display(savedCfi);
            }
            setLoading(false);
            setError(null);
            return;
          } catch (e) {
            // CFI 복원 실패 시 정상 로드 진행
          }
        }
        
        // 다른 책이거나 처음 로드하는 경우에만 destroy
        if (renditionRef.current && currentSource !== currentPathRef.current) {
          try {
            renditionRef.current.destroy();
            renditionRef.current = null;
          } catch (e) {
            // ignore
          }
        }
        
        if (bookRef.current && currentSource !== currentPathRef.current) {
          try {
            bookRef.current.destroy();
            bookRef.current = null;
          } catch (e) {
            // ignore
          }
        }
        
        if (viewerRef.current && viewerRef.current.tagName && currentSource !== currentPathRef.current) {
          try {
            viewerRef.current.innerHTML = '';
          } catch (e) {
            // ignore
          }
        }

        try {
          let bookInstance;
          const cache = getEpubCache();
          // IndexedDB ID 기반으로 캐시 키 생성 (targetBookId와 일치시켜야 함)
          const cacheKey = `local_${targetBookId}`;
          
          // 캐시에서 확인
          const cachedData = cache.get(cacheKey);
          if (cachedData && cachedData.blob) {
            // 캐시된 Blob으로 새 인스턴스 생성 (인스턴스는 재사용 불가)
            bookInstance = ePub(cachedData.blob);
          } else {
            // 캐시에 없으면 IndexedDB에서 로드한 ArrayBuffer 사용
            
            if (actualEpubSource instanceof ArrayBuffer) {
              bookInstance = ePub(actualEpubSource);
              // ArrayBuffer를 캐시에 저장
              cache.set(cacheKey, { blob: actualEpubSource, timestamp: Date.now() });
            } else {
              throw new Error('EPUB 파일을 찾을 수 없습니다. IndexedDB에서 로드에 실패했습니다.');
            }
          }
          
          // EPUB 완전히 로드 (spine 포함)
          // 최초 로드 시 spine을 완전히 준비하면 이후 페이지 이동 시 대기 불필요
          await bookInstance.ready;
          
          if (bookInstance.opened && typeof bookInstance.opened.then === 'function') {
            await bookInstance.opened;
          }
          
          // spine이 준비될 때까지 대기 (최대 4초)
          let spineAttempts = 0;
          while ((!bookInstance.spine || bookInstance.spine.length === 0) && spineAttempts < 20) {
            await new Promise(resolve => setTimeout(resolve, 200));
            spineAttempts++;
          }
          
          if (!bookInstance.spine || bookInstance.spine.length === 0) {
            throw new Error("Spine 로드 실패");
          }
          
             // spine 로드 완료 즉시 bookRef에 할당 (페이지 이동 함수에서 즉시 사용 가능)
             bookRef.current = bookInstance;
             
             // 전역 인스턴스에도 저장 (graph 페이지로 가도 유지)
             globalEpubInstances.set(currentSource, {
               bookInstance: bookInstance,
               rendition: null, // rendition은 아래에서 할당
               viewerRef: viewerRef.current
             });
          
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
          
          chapterCfiMapRef.current = newChapterCfiMap;

          const rendition = bookInstance.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: getSpreadMode(pageMode, showGraph),
            manager: 'default',
            flow: 'paginated',
            maxSpreadPages: (showGraph || pageMode === 'single') ? 1 : 2,
          });
          
          renditionRef.current = rendition;
          
          // 전역 인스턴스에 rendition 업데이트
          const existingGlobalInstance = globalEpubInstances.get(currentSource);
          if (existingGlobalInstance) {
            existingGlobalInstance.rendition = rendition;
            existingGlobalInstance.viewerRef = viewerRef.current;
          } else {
            // 없으면 새로 생성
            globalEpubInstances.set(currentSource, {
              bookInstance: bookRef.current,
              rendition: rendition,
              viewerRef: viewerRef.current
            });
          }

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

            // 이벤트 데이터 가져오기 및 매칭
            try {
              const isApiBook = book && typeof book.id === 'number';
              
              if (isApiBook) {
                const { calculateApiChapterProgress, findApiEventFromChars } = await import('../../../utils/common/manifestCache');
                
                const progressInfo = calculateApiChapterProgress(book.id, cfi, detectedChapter, bookInstance);
                const matchedEvent = await findApiEventFromChars(
                  book.id,
                  detectedChapter,
                  progressInfo.currentChars,
                  progressInfo.chapterStartPos
                );
                
                if (matchedEvent) {
                  const currentEvent = {
                    ...matchedEvent,
                    chapter: detectedChapter,
                    eventNum: matchedEvent.eventIdx,
                    chapterProgress: progressInfo.progress,
                    currentChars: progressInfo.currentChars,
                    totalChars: progressInfo.totalChars,
                    cfi: cfi
                  };
                  
                  console.log('📍 현재 이벤트 정보:', currentEvent);
                  onCurrentLineChange?.(currentEvent.currentChars, 0, currentEvent);
                } else {
                  onCurrentLineChange?.(progressInfo.currentChars, 0, null);
                }
              } else {
                const events = getEventsForChapter(detectedChapter);
                let currentEvent = null;

                if (events && events.length > 0 && cfi) {
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
              }
            } catch (error) {
              console.error('이벤트 매칭 실패:', error);
              onCurrentLineChange?.(currentChars, 0, null);
            }
          };
          
          rendition.on('relocated', relocatedHandler);

          // 초기 CFI 설정: API 진도 → URL 파라미터 → 로컬 저장 순서
          let displayTarget;
 
          if (!displayTarget && apiProgressData?.cfi) {
            displayTarget = apiProgressData.cfi;
            if (apiProgressData.chapterIdx) {
              onCurrentChapterChange?.(apiProgressData.chapterIdx);
            }
          }

          // 1. URL 파라미터 기반 초기 위치 설정 (최우선)
          if (!displayTarget && (initialChapter || initialPage || initialProgress)) {
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

          // display가 자동으로 relocated 이벤트를 발생시키므로 강제 emit 제거
          // (중복 호출 방지)

          if (storageUtils.get(storageKeys.nextPage) === 'true') {
            storageUtils.remove(storageKeys.nextPage);
            setTimeout(() => rendition.next(), 200);
          }
          if (storageUtils.get(storageKeys.prevPage) === 'true') {
            storageUtils.remove(storageKeys.prevPage);
            setTimeout(() => rendition.prev(), 200);
          }

          // 설정 적용
          if (settings) {
            settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
          }
          } catch (e) {
            const errorMessage = e?.message || e?.toString() || 'EPUB 파일을 불러오는 중 오류가 발생했습니다.';
            setError(errorMessage);
            currentPathRef.current = null;
          } finally {
          isLoadingRef.current = false;
          setLoading(false);
        }
      };

      loadBook();
      return () => {
        if (updatePageCharCountTimer.current) {
          clearTimeout(updatePageCharCountTimer.current);
        }
        if (retryTimeout) {
          clearTimeout(retryTimeout);
        }
        clearCache('eventsCache');
        // cleanup 시 ref는 유지 (뒤로 가기 시 재사용을 위해)
        // isLoadingRef는 false로만 리셋
        isLoadingRef.current = false;
      };
      }, [book.id, book.title]);

    useEffect(() => {
      return () => {
        // 컴포넌트가 완전히 unmount될 때만 destroy
        // graph 페이지로 갔다가 돌아오는 경우는 destroy하지 않음
        // (graph 페이지는 별도 라우트이므로 컴포넌트가 unmount됨)
        // 하지만 브라우저 뒤로 가기로 돌아오면 재사용해야 하므로
        // destroy하지 않고 유지 (메모리 누수 방지를 위해 나중에 정리)
        
        // 실제로는 페이지를 완전히 떠날 때만 destroy해야 하지만
        // 현재는 재사용을 위해 destroy하지 않음
        // 단, 로딩 상태만 리셋
        isLoadingRef.current = false;
      };
    }, []);

    useEffect(() => {
      if (renditionRef.current && settings) {
        const { rendition } = getRefs(bookRef, renditionRef);
        if (rendition) {
          settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
        }
      }
    }, [settings, pageMode, showGraph]);

    useEffect(() => {
      storageUtils.set(storageKeys.chapter, '1');
    }, [storageKeys.chapter]);

    const bookId = useMemo(() => {
      const path = window.location.pathname;
      const fileName = path.split('/').pop();
      if (!fileName || !fileName.endsWith('.epub')) return null;
      return fileName.replace('.epub', '');
    }, []);

    useEffect(() => {
      if (!bookId) return;

      const allEventModules = import.meta.glob('/src/data/*/chapter*_events.json');
      const modules = Object.entries(allEventModules)
        .filter(([path]) => path.includes(`/src/data/${bookId}/`))
        .map(([, mod]) => mod);

      const importAll = async () => {
        const chapters = await Promise.all(modules.map(fn => fn()));
        
        const lastEnds = chapters.map(events => {
          const arr = events.default || events;
          return arr[arr.length - 1]?.end || 0;
        });
        
        const totalLength = lastEnds.reduce((sum, end) => sum + end, 0);
        
        const chapterLengths = {};
        lastEnds.forEach((end, idx) => {
          chapterLengths[idx + 1] = end;
        });
        
        storageUtils.set(`totalLength_${bookId}`, totalLength);
        storageUtils.setJson(`chapterLengths_${bookId}`, chapterLengths);
      };
      
      importAll();
    }, [bookId]);

    const LoadingComponent = ({ message, isError = false }) => (
      <div className="flex flex-col items-center justify-center space-y-6 absolute inset-0 z-50 pointer-events-none animate-fade-in">
        {!isError ? (
          <div className="text-center">
            <span className="text-gray-700 font-medium text-lg">epub 파일을 불러오고 있습니다...</span>
          </div>
        ) : (
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

    useEffect(() => {
      if (navigationError) {
        toast.error(navigationError, {
          position: 'top-center',
          autoClose: 3000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
        });
        const timer = setTimeout(() => {
          setNavigationError(null);
        }, 3000);
        return () => clearTimeout(timer);
      }
    }, [navigationError]);

    return (
      <div className="w-full h-full relative flex items-center justify-center">
        {loading && <LoadingComponent message="책을 불러오는 중..." />}
        {error && <LoadingComponent message={error} isError />}
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