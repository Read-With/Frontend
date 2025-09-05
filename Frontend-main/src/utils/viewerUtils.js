// 뷰어 유틸리티
import { getFolderKeyFromFilename, safeId } from './graphData';

// 기본 설정 값
export const defaultSettings = {
  fontSize: 100,
  pageMode: "double",
  theme: "light",
  lineHeight: 1.5,
  margin: 20,
  fontFamily: "default",
  showGraph: true,
};

// 설정 불러오기
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
  } catch (e) {
    return defaultSettings;
  }
}

/**
 * CFI를 챕터 상세 정보로 파싱
 * @param {string} cfi - CFI 문자열
 * @returns {string} 파싱된 챕터 정보
 */
export function parseCfiToChapterDetail(cfi) {
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? `${chapterMatch[1]}장` : null;

  // [chapter-x]/숫+ 추출
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  const page = pageMatch ? pageMatch[1] : null;

  if (chapter && page) return `${chapter} ${page}`;
  if (chapter) return chapter;
  return cfi;
}

/**
 * 이벤트에서 노드와 엣지 ID를 추출하는 공통 함수 (성능 최적화)
 * @param {Object} event - 이벤트 객체
 * @returns {Object} 노드와 엣지 Set
 */
export function extractEventNodesAndEdges(event) {
  if (!event || typeof event !== 'object') {
    return { nodes: new Set(), edges: new Set() };
  }

  const nodes = new Set();
  const edges = new Set();
  
  // relations 처리 (가장 일반적인 경우)
  if (Array.isArray(event.relations)) {
    for (const rel of event.relations) {
      if (!rel || typeof rel !== 'object') continue;
      
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
}

/**
 * 뷰어 모드 저장 함수
 * @param {string} mode - 모드 ('graph', 'split', 'viewer')
 */
export function saveViewerMode(mode) {
  try {
    localStorage.setItem("viewer_mode", mode);
  } catch (e) {
    console.warn('Failed to save viewer mode:', e);
  }
}

/**
 * 뷰어 모드 복원 함수
 * @returns {string|null} 저장된 모드 또는 null
 */
export function loadViewerMode() {
  try {
    return localStorage.getItem("viewer_mode");
  } catch (e) {
    console.warn('Failed to load viewer mode:', e);
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
  } catch (e) {
    // 무시
  }
  return 0;
}

/**
 * 현재 위치에서 챕터 정보 추출
 * @param {Object} viewerRef - 뷰어 참조
 * @returns {Promise<number>} 챕터 번호
 */
export async function getCurrentChapterFromViewer(viewerRef) {
  if (viewerRef?.current && viewerRef.current.getCurrentCfi) {
    try {
      const cfi = await viewerRef.current.getCurrentCfi();
      if (cfi) {
        const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
        if (chapterMatch) {
          return parseInt(chapterMatch[1]);
        }
      }
    } catch (e) {
      // 챕터 정보 읽기 오류 처리
    }
  }
  return null;
}

/**
 * 현재 위치에 해당하는 이벤트 찾기
 * @param {string} cfi - CFI 문자열
 * @param {number} chapterNum - 챕터 번호
 * @param {Array} events - 이벤트 배열
 * @returns {Object|null} 가장 가까운 이벤트
 */
export function findClosestEvent(cfi, chapterNum, events) {
  if (!events || !events.length) return null;
  
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  if (!pageMatch) return null;
  
  const currentPage = parseInt(pageMatch[1]);
  
  // 페이지 번호에 가장 가까운 이벤트 찾기
  let closestEvent = null;
  let minDistance = Infinity;
  
  events.forEach(event => {
    // 이벤트의 페이지 정보가 있다면 사용, 없다면 이벤트 번호로 추정
    const eventPage = event.page || (event.eventNum + 1);
    const distance = Math.abs(currentPage - eventPage);
    
    if (distance < minDistance) {
      minDistance = distance;
      closestEvent = event;
    }
  });
  
  return closestEvent;
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
 * 설정 관련 유틸리티 함수들
 */
export const settingsUtils = {
  /**
   * 설정 적용 처리
   * @param {Object} newSettings - 새로운 설정
   * @param {Object} prevSettings - 이전 설정
   * @param {Function} setSettings - 설정 설정 함수
   * @param {Function} setDarkMode - 다크모드 설정 함수
   * @param {Function} setShowGraph - 그래프 표시 설정 함수
   * @param {Function} setReloadKey - 리로드 키 설정 함수
   * @param {Object} viewerRef - 뷰어 참조
   * @param {string} cleanFilename - 정리된 파일명
   * @returns {Object} 처리 결과
   */
  applySettings(newSettings, prevSettings, setSettings, setDarkMode, setShowGraph, setReloadKey, viewerRef, cleanFilename) {
    // 현재 설정 백업
    const currentSettings = { ...prevSettings };

    // 새 설정 적용
    setSettings(newSettings);

    // 테마 설정 적용
    if (newSettings.theme === "dark") {
      setDarkMode(true);
    } else {
      setDarkMode(false);
    }

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
