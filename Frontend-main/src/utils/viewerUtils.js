/**
 * 뷰어 관련 유틸리티 함수들
 * EPUB 뷰어의 설정, CFI 처리, 북마크, 진행률 계산 등을 담당
 */

import { getFolderKeyFromFilename } from './graphData';
import { safeId } from './characterUtils';

/**
 * 기본 뷰어 설정
 * @type {Object}
 */
export const defaultSettings = {
  fontSize: 100,
  pageMode: "double",
  lineHeight: 1.5,
  margin: 20,
  fontFamily: "Noto Serif KR",
  showGraph: true,
};

/**
 * 로컬 스토리지에서 뷰어 설정을 로드하는 함수
 * @returns {Object} 로드된 설정 객체
 */
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

/**
 * CFI 문자열을 챕터 상세 정보로 파싱하는 함수
 * @param {string} cfi - CFI 문자열
 * @returns {string} 파싱된 챕터 정보
 */
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

/**
 * 이벤트에서 노드와 엣지 ID를 추출하는 공통 함수 (성능 최적화)
 * @param {Object} event - 이벤트 객체
 * @returns {Object} 노드와 엣지 Set
 */
export function extractEventNodesAndEdges(event) {
  if (!event || typeof event !== 'object') {
    console.warn('extractEventNodesAndEdges: 유효하지 않은 이벤트 객체입니다', { event, type: typeof event });
    return { nodes: new Set(), edges: new Set() };
  }

  try {
    const nodes = new Set();
    const edges = new Set();
    
    // relations 처리 (가장 일반적인 경우)
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
        
        // 유효한 엣지만 추가
        if (id1 && id2) {
          edges.add(`${id1}-${id2}`);
        }
      }
    }
    
    // importance 처리
    if (event.importance && typeof event.importance === 'object') {
      for (const id of Object.keys(event.importance)) {
        if (id) nodes.add(String(id));
      }
    }
    
    // new_appearances 처리
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

/**
 * 뷰어 모드 저장 함수
 * @param {string} mode - 모드 ('graph', 'split', 'viewer')
 */
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

/**
 * 뷰어 모드 복원 함수
 * @returns {string|null} 저장된 모드 또는 null
 */
export function loadViewerMode() {
  try {
    return localStorage.getItem("viewer_mode");
  } catch (error) {
    console.error('loadViewerMode 실패:', error);
    return null;
  }
}

// getFolderKey 함수는 getFolderKeyFromFilename을 직접 사용하도록 변경

/**
 * CFI → 챕터/글자 인덱스 변환 함수
 * @param {string} cfi - CFI 문자열
 * @param {number} chapter - 챕터 번호
 * @param {Object} viewerRef - 뷰어 참조
 * @returns {number} 글자 인덱스
 */
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
    // viewerRef.current.bookRef.current.locations.locationFromCfi(cfi) 사용
    if (
      viewerRef?.current &&
      viewerRef.current.bookRef &&
      viewerRef.current.bookRef.current &&
      viewerRef.current.bookRef.current.locations &&
      typeof viewerRef.current.bookRef.current.locations.locationFromCfi ===
        "function"
    ) {
      // 챕터 내 인덱스 반환
      return viewerRef.current.bookRef.current.locations.locationFromCfi(cfi);
    }
  } catch (error) {
    console.error('cfiToCharIndex 실패:', error, { cfi, chapter });
  }
  return 0;
}

/**
 * 현재 위치에서 챕터 정보 추출
 * @param {Object} viewerRef - 뷰어 참조
 * @returns {Promise<number>} 챕터 번호
 */
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

/**
 * CFI에서 챕터 내 글자 위치 계산 (개선된 버전)
 * @param {string} cfi - CFI 문자열
 * @param {number} chapterNum - 챕터 번호
 * @param {Array} events - 이벤트 배열
 * @param {Object} bookInstance - EPUB.js Book 인스턴스 (선택사항)
 * @returns {Object} 위치 정보 { currentChars, totalChars, progress, eventIndex }
 */
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
    // 챕터 총 글자수 (마지막 이벤트의 end 값)
    const totalChars = events[events.length - 1]?.end || 0;
    let currentChars = 0;
    let calculationMethod = 'fallback';

  // 새로운 방식: CFI 기반 정확한 위치 계산 (우선 적용)
  if (bookInstance && bookInstance.locations && typeof bookInstance.locations.percentageFromCfi === 'function') {
    try {
      // 1. CFI로 전체 페이지 대비 현재 위치 비율 구하기
      const globalProgress = bookInstance.locations.percentageFromCfi(cfi);
      
      // 2. 전체 글자수와 챕터별 글자수 정보 가져오기
      const path = window.location.pathname;
      const fileName = path.split('/').pop();
      const bookId = fileName.replace('.epub', '');
      const totalLength = Number(localStorage.getItem(`totalLength_${bookId}`)) || 0;
      const chapterLengths = JSON.parse(localStorage.getItem(`chapterLengths_${bookId}`) || '{}');
      
      if (totalLength > 0 && Object.keys(chapterLengths).length > 0) {
        // 3. 전체 대비 비율 × 전체 글자수 = 현재 글자수
        const globalCurrentChars = Math.round(globalProgress * totalLength);
        
        // 4. 이전 챕터까지의 글자수 합 계산
        let prevChaptersSum = 0;
        for (let i = 1; i < chapterNum; i++) {
          prevChaptersSum += Number(chapterLengths[i] || 0);
        }
        
        // 5. 현재 글자수 - 이전챕터까지의 글자수 합 = 해당 챕터 내 글자수
        const chapterCurrentChars = Math.max(0, globalCurrentChars - prevChaptersSum);
        
        // 6. 해당 챕터에서의 비율 구하기
        const currentChapterLength = Number(chapterLengths[chapterNum] || totalChars);
        if (currentChapterLength > 0) {
          const chapterProgress = chapterCurrentChars / currentChapterLength;
          
          // 7. 해당 챕터 전체 글자수 × 비율로 정확한 현재 위치 글자수 구하기
          currentChars = Math.min(Math.round(chapterProgress * totalChars), totalChars);
          calculationMethod = 'cfi_accurate';
        }
      }
    } catch (error) {
    }
  }

  // Fallback 방식: 기존 단락 기반 추정 (새로운 방식이 실패한 경우)
  if (calculationMethod === 'fallback') {
    const paragraphMatch = cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
    const paragraphNum = paragraphMatch ? parseInt(paragraphMatch[1]) : 1;
    const charOffset = paragraphMatch ? parseInt(paragraphMatch[2]) : 0;
    
    if (totalChars > 0 && paragraphNum > 1) {
      // 단락당 평균 글자수 추정
      const avgCharsPerParagraph = totalChars / 50; // 대략적인 단락 수
      currentChars = Math.min((paragraphNum - 1) * avgCharsPerParagraph + charOffset, totalChars);
    } else {
      currentChars = charOffset;
    }
  }

  // 챕터 내 진행률 계산
  const progress = totalChars > 0 ? (currentChars / totalChars) * 100 : 0;

  // 현재 위치에 해당하는 이벤트 인덱스 찾기
  let eventIndex = -1;
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    if (currentChars >= event.start && currentChars < event.end) {
      eventIndex = i;
      break;
    }
  }

  // 마지막 이벤트를 넘어선 경우
  if (currentChars >= totalChars) {
    eventIndex = events.length - 1;
  }

    return {
      currentChars: Math.round(currentChars),
      totalChars,
      progress: Math.round(progress * 100) / 100,
      eventIndex,
      calculationMethod,
      paragraphNum: calculationMethod === 'fallback' ? (cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/) ? parseInt(cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/)[1]) : 1) : null,
      charOffset: calculationMethod === 'fallback' ? (cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/) ? parseInt(cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/)[2]) : 0) : null
    };
  } catch (error) {
    console.error('calculateChapterProgress 실패:', error, { cfi, chapterNum, eventsLength: events?.length });
    return { currentChars: 0, totalChars: 0, progress: 0, eventIndex: -1 };
  }
}

/**
 * 현재 위치에 해당하는 이벤트 찾기 (개선된 버전)
 * @param {string} cfi - CFI 문자열
 * @param {number} chapterNum - 챕터 번호
 * @param {Array} events - 이벤트 배열
 * @param {number} currentChars - 현재까지 읽은 글자수 (선택사항)
 * @param {Object} bookInstance - EPUB.js Book 인스턴스 (선택사항)
 * @returns {Object|null} 가장 가까운 이벤트
 */
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
    // currentChars가 제공되지 않은 경우 계산
    if (currentChars === null) {
      const progressInfo = calculateChapterProgress(cfi, chapterNum, events, bookInstance);
      currentChars = progressInfo.currentChars;
    }

  // 글자수 기반으로 정확한 이벤트 찾기
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

  // 첫 이벤트보다 앞선 경우
  if (currentChars < events[0].start) {
    return {
      ...events[0],
      eventNum: events[0].event_id ?? 0,
      chapter: chapterNum,
      progress: 0
    };
  }

    // 마지막 이벤트를 넘어선 경우
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

/**
 * 북마크 관련 유틸리티 함수들
 */
export const bookmarkUtils = {
  /**
   * 북마크 추가/삭제 처리
   * @param {string} cfi - CFI 문자열
   * @param {string} cleanFilename - 정리된 파일명
   * @param {Array} currentBookmarks - 현재 북마크 배열
   * @param {Function} loadBookmarks - 북마크 로드 함수
   * @param {Function} saveBookmarks - 북마크 저장 함수
   * @returns {Object} 처리 결과
   */
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

  /**
   * 북마크 삭제 확인
   * @param {string} cfi - CFI 문자열
   * @param {string} cleanFilename - 정리된 파일명
   * @param {Array} bookmarks - 북마크 배열
   * @param {Function} saveBookmarks - 북마크 저장 함수
   * @returns {boolean} 삭제 여부
   */
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

/**
 * CFI 또는 라벨에서 챕터 번호를 추출하는 함수
 * @param {string} cfi - CFI 문자열
 * @param {string} [label=null] - 라벨 문자열 (선택사항)
 * @returns {number} 추출된 챕터 번호
 */
export function extractChapterNumber(cfi, label = null) {
  // CFI에서 직접 추출 (가장 정확)
  const cfiMatch = cfi?.match(/\[chapter-(\d+)\]/);
  if (cfiMatch) return parseInt(cfiMatch[1]);
  
  // 라벨에서 추출
  if (label) {
    const patterns = [
      /Chapter\s+(\d+)/i,
      /(\d+)\s*장/i,
      /^(\d+)$/,
      /Chapter\s+([IVX]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = label.match(pattern);
      if (match) {
        if (pattern.source.includes('[IVX]')) {
          const romanToNum = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5, 'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9 };
          return romanToNum[match[1]];
        }
        return parseInt(match[1]);
      }
    }
  }
  
  return 1; // 기본값
}

/**
 * localStorage 헬퍼 함수들
 * @namespace storageUtils
 */
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

/**
 * ref 객체 접근 헬퍼 함수
 * @param {Object} bookRef - book ref 객체
 * @param {Object} renditionRef - rendition ref 객체
 * @returns {Object} book과 rendition 객체
 */
export function getRefs(bookRef, renditionRef) {
  return {
    book: bookRef.current,
    rendition: renditionRef.current
  };
}

/**
 * ref 객체와 함께 콜백 실행
 * @param {Object} bookRef - book ref 객체
 * @param {Object} renditionRef - rendition ref 객체
 * @param {Function} callback - 실행할 콜백 함수
 * @returns {any} 콜백 실행 결과
 */
export function withRefs(bookRef, renditionRef, callback) {
  const { book, rendition } = getRefs(bookRef, renditionRef);
  if (!book || !rendition) return null;
  return callback(book, rendition);
}

/**
 * 네비게이션 정리 함수
 * @param {Function} setIsNavigating - 네비게이션 상태 설정 함수
 * @param {Object} rendition - rendition 객체
 * @param {Function} handler - 이벤트 핸들러
 */
export function cleanupNavigation(setIsNavigating, rendition, handler) {
  setIsNavigating(false);
  if (rendition && handler) {
    rendition.off('relocated', handler);
  }
}

/**
 * locations 생성 보장 함수
 * @param {Object} book - book 객체
 * @param {number} chars - 생성할 문자 수 (기본값: 2000)
 */
export async function ensureLocations(book, chars = 2000) {
  if (!book.locations?.length()) {
    await book.locations.generate(chars);
  }
}

/**
 * 설정 관련 유틸리티 함수들
 */
export const settingsUtils = {
  /**
   * 설정 적용 처리
   * @param {Object} newSettings - 새로운 설정
   * @param {Object} prevSettings - 이전 설정
   * @param {Function} setSettings - 설정 설정 함수
   * @param {Function} setShowGraph - 그래프 표시 설정 함수
   * @param {Function} setReloadKey - 리로드 키 설정 함수
   * @param {Object} viewerRef - 뷰어 참조
   * @param {string} cleanFilename - 정리된 파일명
   * @returns {Object} 처리 결과
   */
  applySettings(newSettings, prevSettings, setSettings, setShowGraph, setReloadKey, viewerRef, cleanFilename) {
    // 현재 설정 백업
    const currentSettings = { ...prevSettings };

    // 새 설정 적용
    setSettings(newSettings);

    // 그래프 표시 설정 적용
    setShowGraph(newSettings.showGraph);

    // 페이지 모드 변경 또는 그래프 표시 여부 변경 시 뷰어 다시 로드
    const needsReload = 
      newSettings.pageMode !== currentSettings.pageMode ||
      newSettings.showGraph !== currentSettings.showGraph;

    if (needsReload) {
      // 현재 위치 저장 후 뷰어 다시 로드
      const saveCurrent = async () => {
        try {
          let cfi = null;

          if (viewerRef?.current?.getCurrentCfi) {
            cfi = await viewerRef.current.getCurrentCfi();
            if (cfi) {
              localStorage.setItem(`readwith_${cleanFilename}_lastCFI`, cfi);
            }
          }

          // 즉시 뷰어 다시 로드
          setReloadKey((prev) => prev + 1);
        } catch (e) {
          // 에러 발생 시에도 뷰어 다시 로드
          setReloadKey((prev) => prev + 1);
        }
      };

      saveCurrent();
    } else {
      // 뷰어에 설정 적용 (페이지 모드 외 다른 설정이 변경된 경우)
      if (viewerRef?.current?.applySettings) {
        viewerRef.current.applySettings();
      }
    }

    // 로컬 스토리지에 설정 저장
    try {
      localStorage.setItem("epub_viewer_settings", JSON.stringify(newSettings));
    } catch (e) {
      return { success: false, message: "설정 저장 중 오류가 발생했습니다." };
    }

    return { success: true, message: "✅ 설정이 적용되었습니다" };
  }
};