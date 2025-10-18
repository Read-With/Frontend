/**
 * EPUB 뷰어 유틸
 * 
 * [주요 기능]
 * 1. 설정 관리: defaultSettings, loadSettings, settingsUtils
 * 2. CFI 처리: CFI ↔ 챕터 변환, 파싱, 글자 인덱스 계산
 * 3. 위치/진행률: calculateChapterProgress, findClosestEvent
 * 4. 북마크: bookmarkUtils (추가/삭제)
 * 5. 이벤트: extractEventNodesAndEdges (그래프 노드/엣지 추출)
 * 6. 뷰어 모드: 저장/복원
 * 7. 스토리지: localStorage 헬퍼 (storageUtils)
 * 8. Ref 헬퍼: getRefs, withRefs
 * 9. 네비게이션: cleanupNavigation, ensureLocations
 * 
 * - CFI 기반 정확한 위치 계산 (전역 진행률 → 챕터 내 글자수)
 * - Fallback: 단락 기반 추정 (평균 글자수 × 단락 번호)
 * - 로마 숫자(I~M) → 아라비아 숫자 변환
 */

export const defaultSettings = {
  fontSize: 100,
  pageMode: "double",
  lineHeight: 1.5,
  margin: 20,
  fontFamily: "Noto Serif KR",
  showGraph: true,
};

export function loadSettings() {
  try {
    const settings = localStorage.getItem("epub_viewer_settings");
    const loadedSettings = settings ? JSON.parse(settings) : defaultSettings;

    if (loadedSettings.pageMode === "leftOnly") {
      loadedSettings.pageMode = "double";
    }

    if (loadedSettings.showGraph === undefined) {
      loadedSettings.showGraph = defaultSettings.showGraph;
    }
    localStorage.setItem(
      "epub_viewer_settings",
      JSON.stringify(loadedSettings)
    );

    return loadedSettings;
  } catch (error) {
    console.error('loadSettings 실패:', error, { 
      settings: localStorage.getItem("epub_viewer_settings") 
    });
    return defaultSettings;
  }
}

export function parseCfiToChapterDetail(cfi) {
  if (!cfi || typeof cfi !== 'string') {
    console.warn('parseCfiToChapterDetail: 유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
    return cfi || '';
  }

  try {
    const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
    const chapter = chapterMatch ? `${chapterMatch[1]}장` : null;

    const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
    const page = pageMatch ? pageMatch[1] : null;

    if (chapter && page) return `${chapter} ${page}`;
    if (chapter) return chapter;
    return cfi;
  } catch (error) {
    console.error('parseCfiToChapterDetail 실패:', error, { cfi });
    return cfi;
  }
}

// 이벤트에서 노드와 엣지 ID 추출 (Set 기반 최적화)
export function extractEventNodesAndEdges(event) {
  if (!event || typeof event !== 'object') {
    console.warn('extractEventNodesAndEdges: 유효하지 않은 이벤트 객체입니다', { event, type: typeof event });
    return { nodes: new Set(), edges: new Set() };
  }

  try {
    const nodes = new Set();
    const edges = new Set();
    
    if (Array.isArray(event.relations)) {
      for (const rel of event.relations) {
        if (!rel || typeof rel !== 'object') {
          console.warn('extractEventNodesAndEdges: 유효하지 않은 관계 객체입니다', { rel });
          continue;
        }
        
        const id1 = rel.id1 || rel.source;
        const id2 = rel.id2 || rel.target;
        
        if (id1) nodes.add(String(id1));
        if (id2) nodes.add(String(id2));
        if (id1 && id2) {
          edges.add(`${id1}-${id2}`);
        }
      }
    }
    
    if (event.importance && typeof event.importance === 'object') {
      for (const id of Object.keys(event.importance)) {
        if (id) nodes.add(String(id));
      }
    }
    
    if (Array.isArray(event.new_appearances)) {
      for (const id of event.new_appearances) {
        if (id) nodes.add(String(id));
      }
    }
    
    return { nodes, edges };
  } catch (error) {
    console.error('extractEventNodesAndEdges 실패:', error, { event });
    return { nodes: new Set(), edges: new Set() };
  }
}

export function saveViewerMode(mode) {
  try {
    if (!mode || typeof mode !== 'string') {
      console.warn('saveViewerMode: 유효하지 않은 모드입니다', { mode, type: typeof mode });
      return;
    }
    localStorage.setItem("viewer_mode", mode);
  } catch (error) {
    console.error('saveViewerMode 실패:', error, { mode });
  }
}

export function loadViewerMode() {
  try {
    return localStorage.getItem("viewer_mode");
  } catch (error) {
    console.error('loadViewerMode 실패:', error);
    return null;
  }
}

export function cfiToCharIndex(cfi, chapter, viewerRef) {
  if (!cfi || typeof cfi !== 'string') {
    console.warn('cfiToCharIndex: 유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
    return 0;
  }
  
  if (!chapter || typeof chapter !== 'number' || chapter < 1) {
    console.warn('cfiToCharIndex: 유효하지 않은 챕터 번호입니다', { chapter, type: typeof chapter });
    return 0;
  }
  
  try {
    if (
      viewerRef?.current &&
      viewerRef.current.bookRef &&
      viewerRef.current.bookRef.current &&
      viewerRef.current.bookRef.current.locations &&
      typeof viewerRef.current.bookRef.current.locations.locationFromCfi === "function"
    ) {
      return viewerRef.current.bookRef.current.locations.locationFromCfi(cfi);
    }
  } catch (error) {
    console.error('cfiToCharIndex 실패:', error, { cfi, chapter });
  }
  return 0;
}

export async function getCurrentChapterFromViewer(viewerRef) {
  if (!viewerRef) {
    console.warn('getCurrentChapterFromViewer: viewerRef가 없습니다');
    return null;
  }
  
  if (viewerRef?.current && viewerRef.current.getCurrentCfi) {
    try {
      const cfi = await viewerRef.current.getCurrentCfi();
      if (cfi && typeof cfi === 'string') {
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        if (chapterMatch) {
          return parseInt(chapterMatch[1]);
        }
      }
    } catch (error) {
      console.error('getCurrentChapterFromViewer 실패:', error);
    }
  }
  return null;
}

// CFI 기반 챕터 내 글자 위치 계산
export function calculateChapterProgress(cfi, chapterNum, events, bookInstance = null) {
  if (!cfi || typeof cfi !== 'string') {
    console.warn('calculateChapterProgress: 유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
  
  if (!chapterNum || typeof chapterNum !== 'number' || chapterNum < 1) {
    console.warn('calculateChapterProgress: 유효하지 않은 챕터 번호입니다', { chapterNum, type: typeof chapterNum });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
  
  if (!events || !Array.isArray(events) || !events.length) {
    console.warn('calculateChapterProgress: 유효하지 않은 이벤트 배열입니다', { events, type: typeof events });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }

  try {
    const totalChars = events[events.length - 1]?.end || 0;
    let currentChars = 0;
    let calculationMethod = 'fallback';

  // CFI 기반 정확한 위치 계산
  if (bookInstance?.locations?.percentageFromCfi) {
    try {
      const globalProgress = bookInstance.locations.percentageFromCfi(cfi);
      const path = window.location.pathname;
      const fileName = path.split('/').pop();
      const bookId = fileName.replace('.epub', '');
      const totalLength = Number(localStorage.getItem(`totalLength_${bookId}`)) || 0;
      const chapterLengths = JSON.parse(localStorage.getItem(`chapterLengths_${bookId}`) || '{}');
      
      if (totalLength > 0 && Object.keys(chapterLengths).length > 0) {
        const globalCurrentChars = Math.round(globalProgress * totalLength);
        let prevChaptersSum = 0;
        for (let i = 1; i < chapterNum; i++) {
          prevChaptersSum += Number(chapterLengths[i] || 0);
        }
        const chapterCurrentChars = Math.max(0, globalCurrentChars - prevChaptersSum);
        const currentChapterLength = Number(chapterLengths[chapterNum] || totalChars);
        if (currentChapterLength > 0) {
          const chapterProgress = chapterCurrentChars / currentChapterLength;
          currentChars = Math.min(Math.round(chapterProgress * totalChars), totalChars);
          calculationMethod = 'cfi_accurate';
        }
      }
    } catch (error) {
      console.warn('CFI 기반 정확한 위치 계산 실패, fallback 방식 사용:', error);
    }
  }

  // Fallback: 단락 기반 추정
  let paragraphNum = null;
  let charOffset = null;
  
  if (calculationMethod === 'fallback') {
    const paragraphMatch = cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
    paragraphNum = paragraphMatch ? parseInt(paragraphMatch[1]) : 1;
    charOffset = paragraphMatch ? parseInt(paragraphMatch[2]) : 0;
    
    if (totalChars > 0 && paragraphNum > 1) {
      const avgCharsPerParagraph = totalChars / 50;
      currentChars = Math.min((paragraphNum - 1) * avgCharsPerParagraph + charOffset, totalChars);
    } else {
      currentChars = charOffset;
    }
  }

  const progress = totalChars > 0 ? (currentChars / totalChars) * 100 : 0;
  let eventIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (currentChars >= event.start && currentChars < event.end) {
      eventIndex = i;
      break;
    }
  }

  if (currentChars >= totalChars) {
    eventIndex = events.length - 1;
  }

    return {
      currentChars: Math.round(currentChars),
      totalChars,
      progress: Math.round(progress * 100) / 100,
      eventIndex,
      calculationMethod,
      paragraphNum,
      charOffset
    };
  } catch (error) {
    console.error('calculateChapterProgress 실패:', error, { cfi, chapterNum, eventsLength: events?.length });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
}

export function findClosestEvent(cfi, chapterNum, events, currentChars = null, bookInstance = null) {
  if (!cfi || typeof cfi !== 'string') {
    console.warn('findClosestEvent: 유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
    return null;
  }
  
  if (!chapterNum || typeof chapterNum !== 'number' || chapterNum < 1) {
    console.warn('findClosestEvent: 유효하지 않은 챕터 번호입니다', { chapterNum, type: typeof chapterNum });
    return null;
  }
  
  if (!events || !Array.isArray(events) || !events.length) {
    console.warn('findClosestEvent: 유효하지 않은 이벤트 배열입니다', { events, type: typeof events });
    return null;
  }
  
  try {
    if (currentChars === null) {
      const progressInfo = calculateChapterProgress(cfi, chapterNum, events, bookInstance);
      currentChars = progressInfo.currentChars;
    }

  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (currentChars >= event.start && currentChars < event.end) {
      return {
        ...event,
        eventNum: event.event_id ?? 0,
        chapter: chapterNum,
        progress: ((currentChars - event.start) / (event.end - event.start)) * 100
      };
    }
  }

  if (currentChars < events[0].start) {
    return {
      ...events[0],
      eventNum: events[0].event_id ?? 0,
      chapter: chapterNum,
      progress: 0
    };
  }

    const lastEvent = events[events.length - 1];
    return {
      ...lastEvent,
      eventNum: lastEvent.event_id ?? 0,
      chapter: chapterNum,
      progress: 100
    };
  } catch (error) {
    console.error('findClosestEvent 실패:', error, { cfi, chapterNum, eventsLength: events?.length });
    return null;
  }
}

export const bookmarkUtils = {
  async toggleBookmark(cfi, cleanFilename, currentBookmarks, loadBookmarks, saveBookmarks) {
    const latestBookmarks = loadBookmarks(cleanFilename);
    const isDuplicate = latestBookmarks.some((b) => b.cfi === cfi);
    
    let newBookmarks;
    if (isDuplicate) {
      newBookmarks = latestBookmarks.filter((b) => b.cfi !== cfi);
      return { 
        bookmarks: newBookmarks, 
        message: "❌ 북마크가 삭제되었습니다",
        isAdded: false
      };
    } else {
      const newBookmark = { cfi, createdAt: new Date().toISOString() };
      newBookmarks = [newBookmark, ...latestBookmarks];
      return { 
        bookmarks: newBookmarks, 
        message: "✅ 북마크가 추가되었습니다",
        isAdded: true
      };
    }
  },

  deleteBookmark(cfi, cleanFilename, bookmarks, saveBookmarks) {
    if (!cleanFilename) {
      return { success: false, message: "❗ 파일명이 없어 북마크를 삭제할 수 없습니다." };
    }
    
    if (window.confirm("정말 삭제하시겠습니까?")) {
      const newBookmarks = bookmarks.filter((b) => b.cfi !== cfi);
      saveBookmarks(cleanFilename, newBookmarks);
      return { success: true, bookmarks: newBookmarks };
    }
    
    return { success: false, message: "삭제가 취소되었습니다." };
  }
};

function romanToArabic(roman) {
  if (!roman || typeof roman !== 'string') return 1;
  
  const romanMap = {
    'I': 1, 'V': 5, 'X': 10, 'L': 50, 
    'C': 100, 'D': 500, 'M': 1000
  };
  
  let result = 0;
  for (let i = 0; i < roman.length; i++) {
    const current = romanMap[roman[i]];
    const next = romanMap[roman[i + 1]];
    
    if (current < next) {
      result -= current;
    } else {
      result += current;
    }
  }
  
  return result || 1;
}

export function extractChapterNumber(cfi, label = null) {
  const cfiMatch = cfi?.match(/\[chapter-(\d+)\]/);
  if (cfiMatch) return parseInt(cfiMatch[1]);
  
  if (label) {
    const patterns = [
      /Chapter\s+(\d+)/i,
      /(\d+)\s*장/i,
      /^(\d+)$/,
      /Chapter\s+([IVXLCDM]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) {
        if (pattern.source.includes('[IVXLCDM]')) {
          return romanToArabic(match[1]);
        }
        return parseInt(match[1]);
      }
    }
  }
  
  return 1;
}

// CFI 매핑을 통한 정확한 챕터 감지 (EpubViewer에서 사용)
export function detectCurrentChapter(cfi, chapterCfiMap = null) {
  let detectedChapter = extractChapterNumber(cfi);
  
  // 챕터 번호가 1이고 CFI 매핑이 있을 때 정확한 챕터 번호 찾기
  if (detectedChapter === 1 && chapterCfiMap && chapterCfiMap.size > 0) {
    for (const [chapterNum, chapterCfi] of chapterCfiMap) {
      if (cfi && cfi.includes(chapterCfi)) {
        detectedChapter = chapterNum;
        break;
      }
    }
  }
  
  return detectedChapter;
}

export const storageUtils = {
  get: (key) => localStorage.getItem(key),
  set: (key, value) => localStorage.setItem(key, value),
  remove: (key) => localStorage.removeItem(key),
  getJson: (key, defaultValue = {}) => {
    try {
      return JSON.parse(localStorage.getItem(key) || '{}');
    } catch {
      return defaultValue;
    }
  },
  setJson: (key, value) => localStorage.setItem(key, JSON.stringify(value))
};

export function getRefs(bookRef, renditionRef) {
  return {
    book: bookRef.current,
    rendition: renditionRef.current
  };
}

export function withRefs(bookRef, renditionRef, callback) {
  const { book, rendition } = getRefs(bookRef, renditionRef);
  if (!book || !rendition) return null;
  return callback(book, rendition);
}

export function cleanupNavigation(setIsNavigating, rendition, handler) {
  setIsNavigating(false);
  if (rendition && handler) {
    rendition.off('relocated', handler);
  }
}

export async function ensureLocations(book, chars = 2000) {
  if (!book.locations?.length()) {
    await book.locations.generate(chars);
  }
}

// 네비게이션 관련 유틸리티 함수들
export const navigationUtils = {
  // 안전한 페이지 이동 처리
  async safeNavigate(book, rendition, action, direction = 'next', setIsNavigating, setNavigationError, storageKeys) {
    if (!book || !rendition) return;
    
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
      await navigationUtils.fallbackDisplay(book, rendition, direction, storageKeys);
    }
  },

  // 네비게이션 실패 시 대체 방법 제공
  async fallbackDisplay(book, rendition, direction = 'next', storageKeys) {
    try {
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
        // smoothReload는 컴포넌트에서 처리
        return 'reload';
      }
    } catch (e) {
      return 'reload';
    }
  }
};

// 스프레드 모드 결정 함수
export function getSpreadMode(pageMode, showGraph) {
  // 분할 화면 + 그래프 화면 (showGraph=true, graphFullScreen=false)에서는 뷰어 너비가 50%로 제한
  if (showGraph) {
    // 분할 화면: 50% 너비에 최적화하여 항상 한 페이지씩 표시
    // pageMode 설정과 관계없이 'none'으로 설정 (50% 너비에서는 두 페이지 표시가 부적절)
    return 'none';
  } else {
    // 전체 화면: pageMode에 따라 spread 모드 결정
    return pageMode === 'single' ? 'none' : 'always';
  }
}

export const settingsUtils = {
  applySettings(newSettings, prevSettings, setSettings, setShowGraph, setReloadKey, viewerRef, cleanFilename) {
    const currentSettings = { ...prevSettings };
    setSettings(newSettings);
    setShowGraph(newSettings.showGraph);

    const needsReload = 
      newSettings.pageMode !== currentSettings.pageMode ||
      newSettings.showGraph !== currentSettings.showGraph;

    if (needsReload) {
      const saveCurrent = async () => {
        try {
          let cfi = null;
          if (viewerRef?.current?.getCurrentCfi) {
            cfi = await viewerRef.current.getCurrentCfi();
            if (cfi) {
              localStorage.setItem(`readwith_${cleanFilename}_lastCFI`, cfi);
            }
          }
          setReloadKey((prev) => prev + 1);
        } catch (e) {
          setReloadKey((prev) => prev + 1);
        }
      };
      saveCurrent();
    } else {
      if (viewerRef?.current?.applySettings) {
        viewerRef.current.applySettings();
      }
    }

    try {
      localStorage.setItem("epub_viewer_settings", JSON.stringify(newSettings));
    } catch (e) {
      return { success: false, message: "설정 저장 중 오류가 발생했습니다." };
    }

    return { success: true, message: "✅ 설정이 적용되었습니다" };
  },

  // EpubViewer에서 사용할 설정 적용 함수
  applyEpubSettings(rendition, settings, getSpreadMode) {
    if (!rendition || !settings) return;
    
    // 스프레드 모드 설정
    rendition.spread(getSpreadMode);
    
    // 글꼴 크기 적용
    if (settings.fontSize) {
      const fontSize = settings.fontSize / 100;
      rendition.themes.fontSize(`${fontSize * 100}%`);
    }
    
    // 줄 간격 적용
    if (settings.lineHeight) {
      rendition.themes.override('body', {
        'line-height': `${settings.lineHeight}`
      });
    }
  }
};

export const textUtils = {
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
      .replace(/[^a-zA-Z가-힣]/g, '')
      .length;
  },

  // 단락별 글자 수 계산
  calculateParagraphChars: (paragraph, element) => {
    return textUtils.countCharacters(paragraph.textContent, element);
  },

  // 이전 단락들의 누적 글자 수 계산
  calculatePreviousParagraphsChars: (paragraphs, currentParagraphNum) => {
    let charCount = 0;
    for (let i = 0; i < currentParagraphNum - 1; i++) {
      const paragraph = paragraphs[i];
      if (paragraph) {
        charCount += textUtils.calculateParagraphChars(paragraph, paragraph);
      }
    }
    return charCount;
  },

  // 현재 단락의 부분 글자 수 계산
  calculateCurrentParagraphChars: (paragraphs, currentParagraphNum, charOffset) => {
    if (currentParagraphNum > 0 && paragraphs[currentParagraphNum - 1]) {
      const currentParagraph = paragraphs[currentParagraphNum - 1];
      const currentParagraphChars = textUtils.calculateParagraphChars(currentParagraph, currentParagraph);
      return Math.min(charOffset, currentParagraphChars);
    }
    return 0;
  }
};