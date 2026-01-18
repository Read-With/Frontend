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
  errorUtils,
  getServerBookId
} from '../../../utils/viewerUtils';
import { getProgressFromCache } from '../../../utils/common/cache/progressCache';
import { registerCache } from '../../../utils/common/cache/cacheManager';
import { getEventsForChapter as getGraphEventsForChapter, getFolderKeyFromFilename } from '../../../utils/graph/graphData';

// EPUB 인스턴스 및 Blob 캐시
let epubCache = new Map();
let isEpubCacheRegistered = false;

// 전역 EPUB 인스턴스 저장 (graph 페이지로 가도 유지)
const globalEpubInstances = new Map(); // currentSource -> { bookInstance, rendition, viewerRef, lastAccessed }

// 오래된 전역 인스턴스 정리 (1시간 이상 미사용)
const cleanupOldGlobalInstances = () => {
  const now = Date.now();
  const maxAge = 3600000; // 1시간
  
  for (const [key, instance] of globalEpubInstances.entries()) {
    if (instance.lastAccessed && (now - instance.lastAccessed > maxAge)) {
      try {
        if (instance.rendition) {
          instance.rendition.destroy();
        }
        if (instance.bookInstance) {
          instance.bookInstance.destroy();
        }
      } catch (e) {
        // destroy 실패 무시
      }
      globalEpubInstances.delete(key);
    }
  }
};

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

const resolveTotalLocations = (locations) => {
  if (!locations) return 1;
  try {
    if (typeof locations.length === 'function') {
      const lengthValue = Number(locations.length());
      if (Number.isFinite(lengthValue) && lengthValue > 0) {
        return lengthValue;
      }
    }
  } catch (error) {
  }
  const totalValue = Number(locations?.total);
  if (Number.isFinite(totalValue) && totalValue > 0) {
    return totalValue;
  }
  return 1;
};


const EpubViewer = forwardRef(
  (
    { book, onProgressChange, onCurrentPageChange, onTotalPagesChange, onCurrentChapterChange, onCurrentLineChange, settings, initialChapter, initialProgress },
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
    const relocatedHandlerRef = useRef(null); // relocated 이벤트 핸들러 참조

    // 메모이제이션된 값들
    // EPUB 파일은 항상 IndexedDB에서만 로드
    const { storageKeys, pageMode, showGraph } = useMemo(() => {
      const clean = book.id?.toString() || book.filename || 'book';
      
      return {
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
    
    const folderKey = useMemo(() => {
      if (book?.filename) {
        const key = getFolderKeyFromFilename(book.filename);
        if (key) return key;
      }
      if (book?.id !== undefined && book?.id !== null) {
        return getFolderKeyFromFilename(book.id);
      }
      return null;
    }, [book?.filename, book?.id]);
    
    // relocatedHandler 생성 함수 (공통 로직)
    const createRelocatedHandler = useCallback((bookInstance, currentSource) => {
      return async (location) => {
        setLoading(false);
        const cfi = location?.start?.cfi;
        
        if (!cfi) return;
        
        const detectedChapter = detectCurrentChapter(cfi, chapterCfiMapRef.current, book?.title);
        
        let locIdx = 0;
        try {
          const idxCandidate = bookInstance.locations?.locationFromCfi?.(cfi);
          if (Number.isFinite(idxCandidate) && idxCandidate >= 0) {
            locIdx = idxCandidate;
          } else if (!bookInstance.locations?.length || bookInstance.locations.length() === 0) {
            await ensureLocations(bookInstance, 2000);
            const retryCandidate = bookInstance.locations?.locationFromCfi?.(cfi);
            if (Number.isFinite(retryCandidate) && retryCandidate >= 0) {
              locIdx = retryCandidate;
            }
          }
        } catch (error) {
          try {
            await ensureLocations(bookInstance, 2000);
            const retryCandidate = bookInstance.locations?.locationFromCfi?.(cfi);
            if (Number.isFinite(retryCandidate) && retryCandidate >= 0) {
              locIdx = retryCandidate;
            }
          } catch (e) {
            // 생성 실패 무시
          }
        }
        const totalLocations = resolveTotalLocations(bookInstance.locations);
        const clampedIndex = Math.min(Math.max(locIdx, 0), Math.max(totalLocations - 1, 0));
        const pageNum = Math.max(Math.min(clampedIndex + 1, totalLocations), 1);
        const progressValue = totalLocations > 1
          ? Math.round((clampedIndex / (totalLocations - 1)) * 100)
          : (clampedIndex > 0 ? 100 : 0);
        const normalizedProgress = Math.max(0, Math.min(progressValue, 100));

        onCurrentPageChange?.(pageNum);
        onTotalPagesChange?.(totalLocations);
        onProgressChange?.(normalizedProgress);
        storageUtils.set(storageKeys.lastCFI, cfi);
        
        const epubInfo = {
          cfi: cfi,
          spinePos: location?.start?.spinePos,
          href: location?.start?.href,
          totalPages: totalLocations,
          locationsLength: bookInstance.locations?.length() || 0,
          spineLength: bookInstance.spine?.length || 0,
          timestamp: Date.now()
        };
        
        storageUtils.set('epubInfo_' + (book.filename || 'book'), JSON.stringify(epubInfo));
        
        const prevChapter = currentChapterRef.current;
        if (detectedChapter !== prevChapter) {
          onCurrentChapterChange?.(detectedChapter);
        }

        if (detectedChapter !== currentChapterRef.current) {
          currentChapterRef.current = detectedChapter;
          chapterPageCharsRef.current.clear();
        }

        updatePageCharCount();
        const currentChars = currentChapterCharsRef.current;

        try {
          const serverBookId = getServerBookId(book);
          const isApiBook = !!serverBookId;
          
          if (isApiBook && serverBookId) {
            const { calculateApiChapterProgress, findApiEventFromChars } = await import('../../../utils/common/cache/manifestCache');
            const progressInfo = calculateApiChapterProgress(serverBookId, cfi, detectedChapter, bookInstance);
            const matchedEvent = await findApiEventFromChars(
              serverBookId,
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
              onCurrentLineChange?.(currentEvent.currentChars, 0, currentEvent);
            } else {
              onCurrentLineChange?.(progressInfo.currentChars, 0, null);
            }
          } else {
            const events = getGraphEventsForChapter(detectedChapter, folderKey);
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
    }, [book, folderKey, storageKeys, onCurrentPageChange, onTotalPagesChange, onProgressChange, onCurrentChapterChange, onCurrentLineChange]);

    // 전역 인스턴스 재사용 및 렌더링 함수
    const reuseGlobalInstance = useCallback(async (instance, currentSource) => {
      if (!instance || !instance.bookInstance) return false;
      
      const bookInstance = instance.bookInstance;
      bookRef.current = bookInstance;
      instance.lastAccessed = Date.now();
      
      // viewerRef가 다르면 새로 렌더링
      if (instance.viewerRef !== viewerRef.current && bookInstance) {
        try {
          // 기존 이벤트 리스너 제거
          if (relocatedHandlerRef.current && instance.rendition) {
            try {
              instance.rendition.off('relocated', relocatedHandlerRef.current);
            } catch (e) {
              // 이미 제거되었거나 없는 경우 무시
            }
          }
          
          if (instance.rendition) {
            instance.rendition.destroy();
          }
          const newRendition = bookInstance.renderTo(viewerRef.current, {
            width: '100%',
            height: '100%',
            spread: getSpreadMode(pageMode, showGraph),
            manager: 'default',
            flow: 'paginated',
            maxSpreadPages: (showGraph || pageMode === 'single') ? 1 : 2,
          });
          renditionRef.current = newRendition;
          instance.rendition = newRendition;
          instance.viewerRef = viewerRef.current;
        } catch (e) {
          // 재렌더링 실패 무시
        }
      }
      
      // relocatedHandler 등록
      if (renditionRef.current) {
        // 기존 핸들러 제거
        if (relocatedHandlerRef.current) {
          try {
            renditionRef.current.off('relocated', relocatedHandlerRef.current);
          } catch (e) {
            // 이미 제거되었거나 없는 경우 무시
          }
        }
        
        const relocatedHandler = createRelocatedHandler(bookInstance, currentSource);
        relocatedHandlerRef.current = relocatedHandler;
        renditionRef.current.on('relocated', relocatedHandler);
      }
      
      // locations 확인 및 총 페이지 수 업데이트
      try {
        await ensureLocations(bookInstance, 2000);
        const totalLocations = resolveTotalLocations(bookInstance.locations);
        onTotalPagesChange?.(totalLocations);
      } catch (e) {
        // locations 생성 실패 무시
      }
      
      // 현재 위치 복원 및 즉시 업데이트
      try {
        const savedCfi = storageUtils.get(storageKeys.lastCFI);
        if (savedCfi && renditionRef.current) {
          await renditionRef.current.display(savedCfi);
          // display 후 relocated 이벤트가 발생하므로 자동으로 업데이트됨
        } else if (renditionRef.current) {
          // CFI가 없으면 현재 위치 가져와서 업데이트
          const currentLocation = await renditionRef.current.currentLocation();
          if (currentLocation?.start?.cfi) {
            const relocatedHandler = createRelocatedHandler(bookInstance, currentSource);
            await relocatedHandler(currentLocation);
          }
        }
      } catch (e) {
        // CFI 복원 실패는 무시
      }
      
      cleanupOldGlobalInstances();
      currentPathRef.current = currentSource;
      setLoading(false);
      setError(null);
      isLoadingRef.current = false;
      
      return true;
    }, [pageMode, showGraph, storageKeys, createRelocatedHandler, onTotalPagesChange]);

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

  // 페이지 이동 공통 함수
  const navigatePage = useCallback(async (direction) => {
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
      async () => await cfiUtils.navigateWithFallback(book, rendition, direction),
      direction,
      setIsNavigating,
      setNavigationError,
      storageKeys
    );
  }, [isNavigating, storageKeys]);

  useImperativeHandle(ref, () => ({
      prevPage: () => navigatePage('prev'),
      nextPage: () => navigatePage('next'),
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
        // book과 rendition이 준비될 때까지 대기 (최대 5초)
        let attempts = 0;
        let book, rendition;
        while (attempts < 50) {
          const refs = getRefs(bookRef, renditionRef);
          book = refs.book;
          rendition = refs.rendition;
          
          if (book && rendition && book.spine && book.spine.length > 0) {
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }
        
        if (!book || !rendition) {
          console.warn('moveToProgress: book 또는 rendition이 준비되지 않았습니다.');
          return;
        }

        try {
          await ensureLocations(book, 3000);
          const percent = Math.min(Math.max(percentage, 0), 100) / 100;
          const targetCfi = book.locations.cfiFromPercentage(percent);
          await rendition.display(targetCfi || (percent < 0.5 ? 0 : book.spine.last()?.href));
        } catch (error) {
          console.error('moveToProgress 실패:', error);
        }
      },
      applySettings: () => {
        const { rendition } = getRefs(bookRef, renditionRef);
        if (rendition) {
          settingsUtils.applyEpubSettings(rendition, settings, getSpreadMode(pageMode, showGraph));
        }
      },
      getBookInstance: () => bookRef.current,
      isNavigating,
      setIsNavigating,
    }), [navigatePage, isNavigating, pageMode, showGraph, storageKeys, loading, settings]);

    useEffect(() => {
      let retryTimeout = null;
      
      const loadBook = async () => {
        // EPUB 파일은 항상 IndexedDB에서만 로드
        // 뷰어에서 EPUB을 보여줄 때만 책 이름(제목)으로 IndexedDB에서 찾기
        let actualEpubSource = null;
        let targetBookId = null;
        let apiProgressData = null;
        
        // book.id 또는 book._bookId가 없으면 에러
        const hasBookId = book.id || book._bookId;
        if (!hasBookId) {
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
        
        // bookKey 생성 (로컬 캐시에서 진도 조회용)
        const bookKeyForProgress = book.id || book._bookId || book.filename;
        
        // 진도 조회: 로컬 캐시에서 가져오기 (모든 책 - 로컬/서버 구분 없음)
        if (bookKeyForProgress) {
          try {
            // 로컬 캐시에서 직접 조회
            const cachedProgress = getProgressFromCache(String(bookKeyForProgress));
            if (cachedProgress) {
              apiProgressData = cachedProgress;
              if (apiProgressData.chapterIdx) {
                currentChapterRef.current = apiProgressData.chapterIdx;
              }
            }
          } catch (progressError) {
            // 에러는 조용히 처리 (로컬 캐시에서 가져오므로 일반적으로 에러 없음)
            apiProgressData = null;
          }
        }

        try {
          const { loadLocalBookBuffer, saveLocalBookBuffer } = await import('../../../utils/localBookStorage');
          
          // 로컬 bookID는 사용하지 않음 - bookId만 사용
          const candidateKeys = Array.from(
            new Set(
              [
                book._indexedDbId ? String(book._indexedDbId) : null,
                book._bookId ? String(book._bookId) : null,
                book.id ? String(book.id) : null,
                book.filename ? String(book.filename) : null,
              ].filter(Boolean),
            ),
          );
          
          targetBookId = candidateKeys[0] || 'temp';
          let globalReuseEntry = null;
          
          for (const key of candidateKeys) {
            const buffer = await loadLocalBookBuffer(key);
            if (buffer) {
              actualEpubSource = buffer;
              targetBookId = key;
              break;
            }
          }
          
          if (!actualEpubSource) {
            if (book.epubFile || book.epubArrayBuffer) {
              let bufferToSave = null;
              if (book.epubArrayBuffer instanceof ArrayBuffer) {
                bufferToSave = book.epubArrayBuffer;
              } else if (book.epubFile instanceof File) {
                bufferToSave = await book.epubFile.arrayBuffer();
              }
              
              if (bufferToSave) {
                // 로컬 bookID는 사용하지 않음 - bookId만 사용
                const assignedKey = targetBookId || (book.id ? String(book.id) : book._bookId ? String(book._bookId) : 'temp');
                targetBookId = assignedKey;
                await saveLocalBookBuffer(assignedKey, bufferToSave);
                actualEpubSource = bufferToSave;
              }
            }
          }
          
          if (!actualEpubSource) {
            for (const key of candidateKeys) {
              const entry = globalEpubInstances.get(`local_${key}`);
              if (entry?.bookInstance) {
                globalReuseEntry = entry;
                targetBookId = key;
                break;
              }
            }
            
            if (!globalReuseEntry) {
              setError('EPUB 파일을 찾을 수 없습니다. 다시 업로드해주세요.');
              setLoading(false);
              return;
            }
            
            const reuseSuccess = await reuseGlobalInstance(globalReuseEntry, `local_${targetBookId}`);
            if (reuseSuccess) return;
          }
        } catch (error) {
          setError('EPUB 파일 로드에 실패했습니다.');
          setLoading(false);
          return;
        }
        
        const currentSource = `local_${targetBookId}`;
        
        const globalInstance = globalEpubInstances.get(currentSource);
        if (globalInstance && globalInstance.bookInstance && globalInstance.rendition && globalInstance.viewerRef) {
          const reuseSuccess = await reuseGlobalInstance(globalInstance, currentSource);
          if (reuseSuccess) return;
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
               viewerRef: viewerRef.current,
               lastAccessed: Date.now()
             });
          
          await bookInstance.locations.generate(1800);
          await ensureLocations(bookInstance, 2000);
          const initialTotal = resolveTotalLocations(bookInstance.locations);
          onTotalPagesChange?.(initialTotal);

          // TOC 정보 로드 및 챕터별 CFI 매핑 저장
          const toc = bookInstance.navigation.toc;
          
          // 챕터별 CFI 매핑 저장
          const newChapterCfiMap = new Map();

          // 각 챕터의 CFI 매핑 병렬 로드
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
            existingGlobalInstance.lastAccessed = Date.now();
          } else {
            // 없으면 새로 생성
            globalEpubInstances.set(currentSource, {
              bookInstance: bookRef.current,
              rendition: rendition,
              viewerRef: viewerRef.current,
              lastAccessed: Date.now()
            });
          }
          
          // 오래된 인스턴스 정리
          cleanupOldGlobalInstances();

          // 페이지 모드에 맞는 CSS 적용
          rendition.themes.default({
            body: {
              'max-width': '100%',
              'margin': '0 auto',
              'box-sizing': 'border-box',
              'overflow-x': 'hidden'
            }
          });

          // 기존 이벤트 리스너 제거 (중복 방지)
          if (relocatedHandlerRef.current && renditionRef.current) {
            try {
              renditionRef.current.off('relocated', relocatedHandlerRef.current);
            } catch (e) {
              // 이미 제거되었거나 없는 경우 무시
            }
          }
          
          // relocatedHandler 생성 및 등록
          const relocatedHandler = createRelocatedHandler(bookInstance, currentSource);
          relocatedHandlerRef.current = relocatedHandler;
          rendition.on('relocated', relocatedHandler);
          
          // 전역 인스턴스 접근 시간 업데이트
          const globalInstance = globalEpubInstances.get(currentSource);
          if (globalInstance) {
            globalInstance.lastAccessed = Date.now();
          }

          // 초기 CFI 설정: 로컬 진도 CFI → URL 파라미터 → 로컬 저장 CFI 순서
          let displayTarget;
 
          // 0. 로컬 캐시에서 가져온 진도의 CFI 사용 (최우선)
          if (!displayTarget && apiProgressData?.cfi) {
            displayTarget = apiProgressData.cfi;
            if (apiProgressData.chapterIdx) {
              onCurrentChapterChange?.(apiProgressData.chapterIdx);
              currentChapterRef.current = apiProgressData.chapterIdx;
            }
            errorUtils.logInfo('loadBook', '로컬 진도 CFI 사용', { 
              target: displayTarget, 
              chapter: apiProgressData.chapterIdx 
            });
          }

          // 1. URL 파라미터 기반 초기 위치 설정
          if (!displayTarget && (initialChapter || initialProgress)) {
            errorUtils.logInfo('loadBook', 'URL 파라미터 기반 초기 위치 설정', {
              chapter: initialChapter,
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
                  // 챕터 변경 알림
                  onCurrentChapterChange?.(initialChapter);
                  currentChapterRef.current = initialChapter;
                } else {
                  // spine 인덱스 기반 위치 설정
                  const spineIndex = Math.max(0, initialChapter - 1);
                  const spineItem = bookInstance.spine.get(spineIndex);
                  if (spineItem) {
                    displayTarget = spineItem.href;
                    errorUtils.logInfo('loadBook', 'Spine 기반 위치', { target: displayTarget });
                    // 챕터 변경 알림
                    onCurrentChapterChange?.(initialChapter);
                    currentChapterRef.current = initialChapter;
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
        
        // 이벤트 리스너 cleanup
        if (relocatedHandlerRef.current && renditionRef.current) {
          try {
            renditionRef.current.off('relocated', relocatedHandlerRef.current);
          } catch (e) {
            // 이미 제거되었거나 없는 경우 무시
          }
          relocatedHandlerRef.current = null;
        }
        
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