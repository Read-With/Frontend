
import { errorUtils as commonErrorUtils } from './common/errorUtils';
import { storageUtils as commonStorageUtils } from './common/storageUtils';
import { cfiUtils as commonCfiUtils } from './common/cfiUtils';
import { settingsUtils as commonSettingsUtils, defaultSettings as commonDefaultSettings, loadSettings as commonLoadSettings } from './common/settingsUtils';

export const errorUtils = commonErrorUtils;
export const storageUtils = commonStorageUtils;
export const cfiUtils = commonCfiUtils;
export const defaultSettings = commonDefaultSettings;
export const loadSettings = commonLoadSettings;

export function parseCfiToChapterDetail(cfi) {
  if (!cfi || typeof cfi !== 'string') {
    errorUtils.logWarning('parseCfiToChapterDetail', '유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
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
    return errorUtils.handleError('parseCfiToChapterDetail', error, cfi, { cfi });
  }
}

export function extractEventNodesAndEdges(event) {
  if (!event || typeof event !== 'object') {
    errorUtils.logWarning('extractEventNodesAndEdges', '유효하지 않은 이벤트 객체입니다', { event, type: typeof event });
    return { nodes: new Set(), edges: new Set() };
  }

  try {
    const nodes = new Set();
    const edges = new Set();
    
    if (Array.isArray(event.relations)) {
      for (const rel of event.relations) {
        if (!rel || typeof rel !== 'object') {
          errorUtils.logWarning('extractEventNodesAndEdges', '유효하지 않은 관계 객체입니다', { rel });
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
    return errorUtils.handleError('extractEventNodesAndEdges', error, { nodes: new Set(), edges: new Set() }, { event });
  }
}

export function saveViewerMode(mode) {
  try {
    if (!mode || typeof mode !== 'string') {
      return;
    }
    localStorage.setItem("viewer_mode", mode);
    } catch (error) {
      return;
    }
}

export function loadViewerMode() {
  try {
    return localStorage.getItem("viewer_mode");
    } catch (error) {
      return null;
    }
}

export function cfiToCharIndex(cfi, chapter, viewerRef) {
  if (!cfi || typeof cfi !== 'string') {
    return 0;
  }
  
  if (!chapter || typeof chapter !== 'number' || chapter < 1) {
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
    return 0;
  }
  return 0;
}

export async function getCurrentChapterFromViewer(viewerRef) {
  if (!viewerRef?.current) {
    return null;
  }
  
  if (viewerRef.current.getCurrentCfi) {
    try {
      const cfi = await viewerRef.current.getCurrentCfi();
      if (cfi && typeof cfi === 'string') {
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        if (chapterMatch) {
          return parseInt(chapterMatch[1]);
        }
      }
    } catch (error) {
      // getCurrentCfi 실패 시 조용히 처리
      return null;
    }
  }
  return null;
}

// CFI 기반 챕터 내 글자 위치 계산
export function calculateChapterProgress(cfi, chapterNum, events, bookInstance = null) {
  if (!cfiUtils.isValidCfi(cfi)) {
    errorUtils.logWarning('calculateChapterProgress', '유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
  
  if (!chapterNum || typeof chapterNum !== 'number' || chapterNum < 1) {
    errorUtils.logWarning('calculateChapterProgress', '유효하지 않은 챕터 번호입니다', { chapterNum, type: typeof chapterNum });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
  
  if (!events || !Array.isArray(events) || !events.length) {
    errorUtils.logWarning('calculateChapterProgress', '유효하지 않은 이벤트 배열입니다', { events, type: typeof events });
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
      
      // 캐시된 localStorage 접근으로 최적화
      const totalLength = Number(storageUtils.get(`totalLength_${bookId}`)) || 0;
      const chapterLengths = storageUtils.getJson(`chapterLengths_${bookId}`, {});
      
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
      errorUtils.logWarning('calculateChapterProgress', 'CFI 기반 정확한 위치 계산 실패, fallback 방식 사용', { error });
    }
  }

  // Fallback: 단락 기반 추정
  let paragraphNum = null;
  let charOffset = null;
  
  if (calculationMethod === 'fallback') {
    paragraphNum = cfiUtils.extractParagraphNumber(cfi) || 1;
    charOffset = cfiUtils.extractCharOffset(cfi) || 0;
    
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
    return errorUtils.handleError('calculateChapterProgress', error, { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 }, { cfi, chapterNum, eventsLength: events?.length });
  }
}

export function findClosestEvent(cfi, chapterNum, events, currentChars = null, bookInstance = null) {
  if (!cfiUtils.isValidCfi(cfi)) {
    errorUtils.logWarning('findClosestEvent', '유효하지 않은 CFI입니다', { cfi, type: typeof cfi });
    return null;
  }
  
  if (!chapterNum || typeof chapterNum !== 'number' || chapterNum < 1) {
    errorUtils.logWarning('findClosestEvent', '유효하지 않은 챕터 번호입니다', { chapterNum, type: typeof chapterNum });
    return null;
  }
  
  if (!events || !Array.isArray(events) || !events.length) {
    errorUtils.logWarning('findClosestEvent', '유효하지 않은 이벤트 배열입니다', { events, type: typeof events });
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
    return errorUtils.handleError('findClosestEvent', error, null, { cfi, chapterNum, eventsLength: events?.length });
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


// CFI 매핑을 통한 정확한 챕터 감지 (EpubViewer에서 사용)
export function detectCurrentChapter(cfi, chapterCfiMap = null) {
  let detectedChapter = cfiUtils.extractChapterNumber(cfi);
  
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
  if (!book) {
    errorUtils.logWarning('ensureLocations', 'book 객체가 없습니다');
    return false;
  }
  
  if (!book.locations) {
    errorUtils.logWarning('ensureLocations', 'book.locations가 없습니다', { 
      hasBook: !!book,
      bookKeys: book ? Object.keys(book) : []
    });
    return false;
  }
  
  if (!book.locations.length()) {
    try {
      errorUtils.logInfo('ensureLocations', `locations 생성 시작 (${chars} chars)`);
      
      // 더 작은 값으로 시도해보기
      let generated = false;
      for (const charCount of [chars, 1000, 500, 100]) {
        try {
          await book.locations.generate(charCount);
          if (book.locations.length() > 0) {
            errorUtils.logSuccess('ensureLocations', `locations 생성 완료 (${book.locations.length()} locations, ${charCount} chars)`);
            generated = true;
            break;
          }
        } catch (generateError) {
          errorUtils.logWarning('ensureLocations', `locations 생성 실패 (${charCount} chars)`, { generateError });
          continue;
        }
      }
      
      if (!generated) {
        errorUtils.logWarning('ensureLocations', '모든 시도에서 locations 생성 실패');
        return false;
      }
      
      return true;
    } catch (error) {
      errorUtils.logError('ensureLocations', error, { 
        chars, 
        hasLocations: !!book.locations,
        locationsLength: book.locations?.length() || 0
      });
      return false;
    }
  }
  
  return true;
}


// 네비게이션 관련 유틸리티 함수들 (CFI 기반만)
export const navigationUtils = {
  async safeNavigate(book, rendition, action, direction = 'next', setIsNavigating, setNavigationError, storageKeys) {
    if (!book || !rendition) {
      errorUtils.logWarning('safeNavigate', 'book 또는 rendition이 없습니다', { hasBook: !!book, hasRendition: !!rendition });
      setNavigationError('뷰어가 준비되지 않았습니다.');
      return { success: false, error: 'book 또는 rendition 없음' };
    }
    
    setIsNavigating(true);
    setNavigationError(null);

    try {
      const result = await action();
      
      if (!result || !result.success) {
        const errorMsg = result?.error || '페이지 이동에 실패했습니다.';
        setNavigationError(errorMsg);
        return result || { success: false, error: errorMsg };
      }
      
      return result;
      
    } catch (error) {
      errorUtils.logError('safeNavigate', error);
      const errorMsg = '페이지 이동 중 오류가 발생했습니다.';
      setNavigationError(errorMsg);
      return { success: false, error: errorMsg };
    } finally {
      setIsNavigating(false);
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

// settingsUtils는 commonSettingsUtils 사용 (이미 import됨)
export const settingsUtils = commonSettingsUtils;

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