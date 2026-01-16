
import { errorUtils as commonErrorUtils } from './common/errorUtils';
import { storageUtils as commonStorageUtils } from './common/cache/storageUtils';
import { cfiUtils as commonCfiUtils } from './common/cfiUtils';
import { settingsUtils as commonSettingsUtils, defaultSettings as commonDefaultSettings, loadSettings as commonLoadSettings } from './common/settingsUtils';
import { getManifestFromCache } from './common/cache/manifestCache';

export const errorUtils = commonErrorUtils;
export const storageUtils = commonStorageUtils;
export const cfiUtils = commonCfiUtils;
export const defaultSettings = commonDefaultSettings;
export const loadSettings = commonLoadSettings;

/**
 * 서버 bookId를 가져옵니다.
 * book.id 또는 book._bookId 중 숫자인 값을 우선 사용합니다.
 * @param {Object} book - 책 객체
 * @returns {number|null} 서버 bookId (없으면 null)
 */
export function getServerBookId(book) {
  if (!book) return null;
  
  // book.id가 숫자이면 우선 사용
  if (book.id !== undefined && book.id !== null && typeof book.id === 'number') {
    return book.id;
  }
  
  // book._bookId가 숫자이면 사용
  if (book._bookId !== undefined && book._bookId !== null && typeof book._bookId === 'number') {
    return book._bookId;
  }
  
  return null;
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


// CFI 기반 챕터 내 글자 위치 계산
/**
 * 로컬 CFI 기반 챕터 진행도 계산
 * @param {string} cfi - 로컬 CFI (현재 보고 있는 EPUB의 CFI)
 * @param {number} chapterNum - 챕터 번호
 * @param {Array} events - 이벤트 배열
 * @param {Object} bookInstance - EPUB.js book 인스턴스 (로컬 EPUB)
 * @returns {Object} 진행도 정보
 */
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

  // 로컬 CFI 기반 정확한 위치 계산
  if (bookInstance?.locations?.percentageFromCfi) {
    try {
      // 로컬 EPUB의 locations를 사용하여 CFI 기반 진행도 계산
      const globalProgress = bookInstance.locations.percentageFromCfi(cfi);
      const path = window.location.pathname;
      const fileName = path.split('/').pop();
      const bookId = fileName.replace('.epub', '');
      
      // Manifest 기반 진행도 계산
      const numericBookId = Number(bookId);
      const manifest = Number.isFinite(numericBookId) ? getManifestFromCache(numericBookId) : null;
      const progressMetadata = manifest?.progressMetadata;

      const chapterLengths = {};
      if (Array.isArray(progressMetadata?.chapterLengths)) {
        progressMetadata.chapterLengths.forEach((item) => {
          if (!item) return;
          const chapterIdx = Number(item.chapterIdx ?? item.idx);
          const length = Number(item.length);
          if (Number.isFinite(chapterIdx) && chapterIdx > 0 && Number.isFinite(length) && length > 0) {
            chapterLengths[chapterIdx] = length;
          }
        });
      } else if (Array.isArray(manifest?.chapters)) {
        manifest.chapters.forEach((chapter) => {
          if (!chapter) return;
          const chapterIdx = Number(chapter.idx ?? chapter.chapterIdx);
          const endPos = Number(
            chapter.endPos ??
            chapter.end ??
            (chapter.events && chapter.events.length
              ? chapter.events[chapter.events.length - 1]?.endPos ??
                chapter.events[chapter.events.length - 1]?.end
              : null)
          );
          if (Number.isFinite(chapterIdx) && chapterIdx > 0 && Number.isFinite(endPos) && endPos > 0) {
            chapterLengths[chapterIdx] = endPos;
          }
        });
      }

      const totalLength =
        Number(progressMetadata?.totalLength) ||
        Object.values(chapterLengths).reduce((sum, length) => sum + Number(length || 0), 0);

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
      errorUtils.logWarning('calculateChapterProgress', '로컬 CFI 기반 정확한 위치 계산 실패, fallback 방식 사용', { error });
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

/**
 * 로컬 CFI 기반 가장 가까운 이벤트 찾기
 * @param {string} cfi - 로컬 CFI (현재 보고 있는 EPUB의 CFI)
 * @param {number} chapterNum - 챕터 번호
 * @param {Array} events - 이벤트 배열
 * @param {number} currentChars - 현재 문자 위치 (선택사항)
 * @param {Object} bookInstance - EPUB.js book 인스턴스 (로컬 EPUB)
 * @returns {Object|null} 가장 가까운 이벤트
 */
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
      // 로컬 CFI 기반으로 진행도 계산
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


/**
 * Julius Caesar 책의 CFI를 chapter로 변환
 * @param {string} cfi - 현재 CFI
 * @returns {number} 감지된 챕터 번호
 */
function detectJuliusCaesarChapter(cfi) {
  if (!cfi) return 1;
  
  // Julius Caesar 책의 chapter 시작 CFI 매핑
  const juliusCaesarChapterCfis = [
    { chapter: 1, cfi: 'epubcfi(/6/10!/4/2[pgepubid00004]/2/4/1:0)' },
    { chapter: 2, cfi: 'epubcfi(/6/8!/4/2[pgepubid00004]/42/1:0)' },
    { chapter: 3, cfi: 'epubcfi(/6/8!/4/2[pgepubid00004]/248/1:0)' },
    { chapter: 4, cfi: 'epubcfi(/6/10!/4/2[pgepubid00008]/2/4/1:0)' },
    { chapter: 5, cfi: 'epubcfi(/6/10!/4/2[pgepubid00008]/214/13:0)' },
    { chapter: 6, cfi: 'epubcfi(/6/10!/4/2[pgepubid00008]/318/1:0)' },
    { chapter: 7, cfi: 'epubcfi(/6/10!/4/2[pgepubid00008]/334/1:0)' },
    { chapter: 8, cfi: 'epubcfi(/6/10!/4/2[pgepubid00013]/2/4/1:0)' },
    { chapter: 9, cfi: 'epubcfi(/6/12!/4/2[pgepubid00013]/208/1:0)' },
    { chapter: 10, cfi: 'epubcfi(/6/12!/4/2[pgepubid00013]/416/5:0)' },
    { chapter: 11, cfi: 'epubcfi(/6/10!/4/2[pgepubid00017]/2/4/1:0)' },
    { chapter: 12, cfi: 'epubcfi(/6/14!/4/2[pgepubid00017]/34/5:0)' },
    { chapter: 13, cfi: 'epubcfi(/6/14!/4/2[pgepubid00017]/94/1:0)' },
    { chapter: 14, cfi: 'epubcfi(/6/10!/4/2[pgepubid00021]/2/4/1:0)' },
    { chapter: 15, cfi: 'epubcfi(/6/16!/4/2[pgepubid00021]/104/1:0)' },
    { chapter: 16, cfi: 'epubcfi(/6/16!/4/2[pgepubid00021]/128/1:0)' },
    { chapter: 17, cfi: 'epubcfi(/6/16!/4/2[pgepubid00021]/214/5:0)' },
    { chapter: 18, cfi: 'epubcfi(/6/16!/4/2[pgepubid00021]/256/1:0)' }
  ];
  
  // CFI 정규화 (epubcfi() 제거, 괄호 정리)
  const normalizeCfi = (cfiStr) => {
    if (!cfiStr) return '';
    let normalized = cfiStr.replace(/^epubcfi\(/, '').replace(/\)$/, '').trim();
    // 마지막 닫는 괄호 제거 (있는 경우)
    if (normalized.endsWith(')')) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  };
  
  const normalizedCurrentCfi = normalizeCfi(cfi);
  
  // CFI 비교 함수: 현재 CFI가 chapter 시작 CFI보다 크거나 같은지 확인
  const compareCfi = (current, chapterStart) => {
    const normalizedCurrent = normalizeCfi(current);
    const normalizedStart = normalizeCfi(chapterStart);
    
    // 1. 정확한 포함 관계 확인
    if (normalizedCurrent.includes(normalizedStart)) {
      return true;
    }
    
    // 2. pgepubid 추출
    const currentPgepubidMatch = normalizedCurrent.match(/\[pgepubid(\d+)\]/);
    const startPgepubidMatch = normalizedStart.match(/\[pgepubid(\d+)\]/);
    
    if (!currentPgepubidMatch || !startPgepubidMatch) {
      // pgepubid가 없으면 문자열 비교로 fallback
      return normalizedCurrent >= normalizedStart;
    }
    
    const currentPgepubid = parseInt(currentPgepubidMatch[1]);
    const startPgepubid = parseInt(startPgepubidMatch[1]);
    
    // 3. pgepubid 비교 (pgepubid가 클수록 더 나중 chapter)
    if (currentPgepubid > startPgepubid) {
      return true;
    } else if (currentPgepubid < startPgepubid) {
      return false;
    }
    
    // 4. 같은 pgepubid면 path 숫자 비교
    // path 숫자 추출 - pgepubid 이후의 숫자 부분
    // 예: /6/10!/4/2[pgepubid00004]/2/4/1:0 -> /2/4/1:0 부분
    const extractPathAfterPgepubid = (cfiStr) => {
      const pgepubidIndex = cfiStr.indexOf(']');
      if (pgepubidIndex === -1) return null;
      const afterPgepubid = cfiStr.substring(pgepubidIndex + 1);
      const pathMatch = afterPgepubid.match(/\/(\d+)\/(\d+)(?::(\d+))?/);
      if (pathMatch) {
        return [
          parseInt(pathMatch[1]),
          parseInt(pathMatch[2]),
          pathMatch[3] ? parseInt(pathMatch[3]) : 0
        ];
      }
      return null;
    };
    
    const currentPath = extractPathAfterPgepubid(normalizedCurrent);
    const startPath = extractPathAfterPgepubid(normalizedStart);
    
    if (currentPath && startPath) {
      // 첫 번째 path 숫자 비교
      if (currentPath[0] > startPath[0]) {
        return true;
      } else if (currentPath[0] < startPath[0]) {
        return false;
      }
      
      // 두 번째 path 숫자 비교
      if (currentPath[1] > startPath[1]) {
        return true;
      } else if (currentPath[1] < startPath[1]) {
        return false;
      }
      
      // 세 번째 path 숫자 비교 (있는 경우)
      return currentPath[2] >= startPath[2];
    }
    
    // path 숫자를 추출할 수 없으면 문자열 비교
    return normalizedCurrent >= normalizedStart;
  };
  
  // 역순으로 확인 (마지막 chapter부터)
  for (let i = juliusCaesarChapterCfis.length - 1; i >= 0; i--) {
    const chapterInfo = juliusCaesarChapterCfis[i];
    
    // 현재 CFI가 이 chapter 시작 CFI보다 크거나 같으면 이 chapter 반환
    if (compareCfi(cfi, chapterInfo.cfi)) {
      return chapterInfo.chapter;
    }
  }
  
  // 매칭 실패 시 첫 번째 chapter
  return 1;
}

/**
 * 로컬 CFI 기반 현재 챕터 감지
 * @param {string} cfi - 로컬 CFI (현재 보고 있는 EPUB의 CFI)
 * @param {Map} chapterCfiMap - 챕터 CFI 맵 (로컬 EPUB의 챕터 CFI)
 * @param {string} bookTitle - 책 제목 (선택적)
 * @returns {number} 감지된 챕터 번호
 */
export function detectCurrentChapter(cfi, chapterCfiMap = null, bookTitle = null) {
  if (!cfi) return 1;
  
  // Julius Caesar 책 예외 처리
  const isJuliusCaesar = bookTitle && (
    bookTitle.toLowerCase().includes('julius caesar') ||
    bookTitle.toLowerCase().includes('줄리어스 시저')
  );
  
  if (isJuliusCaesar) {
    return detectJuliusCaesarChapter(cfi);
  }
  
  // 1. [chapter-X] 패턴으로 직접 추출 시도
  let detectedChapter = cfiUtils.extractChapterNumber(cfi);
  
  // 2. chapterCfiMap이 있으면 더 정확한 매칭 시도
  if (chapterCfiMap && chapterCfiMap.size > 0) {
    // 현재 CFI에서 spine 인덱스 추출
    const currentSpineMatch = cfi.match(/\/\d+\/(\d+)!/);
    const currentSpineIndex = currentSpineMatch ? parseInt(currentSpineMatch[1]) : null;
    
    // 2-1. pgepubid 기반 매칭 (가장 정확)
    const currentPgepubidMatch = cfi.match(/\[pgepubid(\d+)\]/);
    if (currentPgepubidMatch) {
      const currentPgepubid = currentPgepubidMatch[1];
      
      for (const [chapterNum, chapterCfi] of chapterCfiMap) {
        if (!chapterCfi) continue;
        
        // chapterCfi에서도 pgepubid 추출
        const chapterPgepubidMatch = chapterCfi.match(/\[pgepubid(\d+)\]/);
        if (chapterPgepubidMatch && chapterPgepubidMatch[1] === currentPgepubid) {
          detectedChapter = chapterNum;
          break;
        }
      }
    }
    
    // 2-2. spine 인덱스 기반 매칭 (pgepubid 매칭 실패 시)
    if (detectedChapter === 1 && currentSpineIndex !== null) {
      for (const [chapterNum, chapterCfi] of chapterCfiMap) {
        if (!chapterCfi) continue;
        
        // chapterCfi에서 spine 인덱스 추출
        const chapterSpineMatch = chapterCfi.match(/\/\d+\/(\d+)!/);
        if (chapterSpineMatch) {
          const chapterSpineIndex = parseInt(chapterSpineMatch[1]);
          if (chapterSpineIndex === currentSpineIndex) {
            detectedChapter = chapterNum;
            break;
          }
        }
      }
    }
    
    // 2-3. CFI base 경로 매칭 (spine 부분 비교)
    if (detectedChapter === 1) {
      for (const [chapterNum, chapterCfi] of chapterCfiMap) {
        if (!chapterCfi) continue;
        
        // chapterCfi의 기본 경로 추출 (spine 부분만)
        const chapterBase = chapterCfi.split('!')[0];
        const currentBase = cfi.split('!')[0];
        
        // spine 인덱스가 같거나, CFI가 chapterCfi를 포함하는지 확인
        if (currentBase === chapterBase || cfi.includes(chapterBase)) {
          detectedChapter = chapterNum;
          break;
        }
      }
    }
    
    // 2-4. 여전히 실패하면 부분 문자열 매칭 (기존 방식)
    if (detectedChapter === 1) {
      for (const [chapterNum, chapterCfi] of chapterCfiMap) {
        if (chapterCfi && cfi.includes(chapterCfi)) {
          detectedChapter = chapterNum;
          break;
        }
      }
    }
  }
  
  // 3. chapterCfiMap이 비어있거나 매칭 실패 시 pgepubid 기반 fallback
  if (detectedChapter === 1) {
    const currentPgepubidMatch = cfi.match(/\[pgepubid(\d+)\]/);
    if (currentPgepubidMatch) {
      const currentPgepubid = parseInt(currentPgepubidMatch[1]);
      
      // chapterCfiMap에서 최소 pgepubid 찾기
      let minPgepubid = null;
      if (chapterCfiMap && chapterCfiMap.size > 0) {
        for (const [, chapterCfi] of chapterCfiMap) {
          if (!chapterCfi) continue;
          const match = chapterCfi.match(/\[pgepubid(\d+)\]/);
          if (match) {
            const pgepubid = parseInt(match[1]);
            if (minPgepubid === null || pgepubid < minPgepubid) {
              minPgepubid = pgepubid;
            }
          }
        }
      }
      
      // 최소 pgepubid를 찾지 못했으면 기본값 3 사용 (일반적인 경우)
      if (minPgepubid === null) {
        minPgepubid = 3;
      }
      
      // pgepubid 기반 챕터 계산
      if (currentPgepubid >= minPgepubid) {
        detectedChapter = currentPgepubid - minPgepubid + 1;
      } else {
        // pgepubid가 최소값보다 작으면 1로 설정
        detectedChapter = 1;
      }
    }
  }
  
  return detectedChapter || 1;
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

export const eventUtils = {
  normalizeEventIdx: (event) => {
    if (!event || typeof event !== 'object') {
      return null;
    }
    
    const candidates = [
      event.resolvedEventIdx,
      event.eventIdx,
      event.eventNum,
      event.event_id,
      event.eventId,
      event.idx,
      event.id
    ];
    
    for (const candidate of candidates) {
      const numeric = Number(candidate);
      if (Number.isFinite(numeric) && numeric > 0) {
        return numeric;
      }
    }
    
    if (event?.event?.eventIdx) {
      const nestedIdx = Number(event.event.eventIdx);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }
    
    if (event?.event?.idx) {
      const nestedIdx = Number(event.event.idx);
      if (Number.isFinite(nestedIdx) && nestedIdx > 0) {
        return nestedIdx;
      }
    }
    
    if (event?.originalEventIdx) {
      const originalIdx = Number(event.originalEventIdx);
      if (Number.isFinite(originalIdx) && originalIdx > 0) {
        return originalIdx;
      }
    }
    
    return null;
  },

  extractRawEventIdx: (event) => {
    if (!event || typeof event !== 'object') {
      return 0;
    }
    
    const idx = eventUtils.normalizeEventIdx(event);
    return idx !== null ? idx : 0;
  },

  convertElementsToRelations: (elements, options = {}) => {
    if (!Array.isArray(elements) || elements.length === 0) {
      return [];
    }
    
    const {
      includeLabel = false,
      includeCount = true,
      positivityDefault = null
    } = options;
    
    return elements
      .filter((el) => el?.data?.source && el?.data?.target)
      .map((edge) => {
        const relation = {
          id1: edge.data.source,
          id2: edge.data.target,
          relation: Array.isArray(edge.data.relation) ? [...edge.data.relation] : [],
          positivity: typeof edge.data.positivity === 'number' 
            ? edge.data.positivity 
            : positivityDefault,
        };
        
        if (includeLabel) {
          relation.label = edge.data.label || '';
        }
        
        if (includeCount) {
          relation.count = edge.data.count || 1;
        }
        
        return relation;
      });
  },

  filterEdges: (elements) => {
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements.filter(el => el?.data && el.data.source && el.data.target);
  },

  filterNodes: (elements) => {
    if (!Array.isArray(elements)) {
      return [];
    }
    return elements.filter(el => el?.data && !el.data.source && !el.data.target);
  },

  findEventInCache: (events, eventIdx) => {
    if (!Array.isArray(events) || !Number.isFinite(eventIdx)) {
      return null;
    }
    return events.find(e => 
      Number(e.eventIdx) === eventIdx || Number(e.idx) === eventIdx
    ) || null;
  },

  getMaxEventIdx: (chapterCache) => {
    if (!chapterCache) {
      return 0;
    }
    
    const maxEventIdx = Number(chapterCache?.maxEventIdx);
    if (Number.isFinite(maxEventIdx) && maxEventIdx > 0) {
      return maxEventIdx;
    }
    
    if (Array.isArray(chapterCache?.events)) {
      return chapterCache.events.length;
    }
    
    return 0;
  },

  createEmptyEvent: (currentChapter, eventIdx, eventData = null) => {
    return {
      chapter: currentChapter,
      chapterIdx: currentChapter,
      eventNum: eventIdx,
      eventIdx: eventIdx,
      event_id: eventData?.event_id ?? eventIdx,
      relations: [],
      characters: [],
      start: eventData?.start ?? null,
      end: eventData?.end ?? null,
      ...(eventData || {})
    };
  },

  updateGraphDataRef: (ref, elements, eventIdx, chapterIdx) => {
    if (!ref || !ref.current) {
      return;
    }
    
    ref.current = {
      elements: Array.isArray(elements) ? elements : [],
      eventIdx: Number.isFinite(eventIdx) ? eventIdx : 0,
      chapterIdx: Number.isFinite(chapterIdx) ? chapterIdx : 0
    };
  }
};

export const transitionUtils = {
  getInitialState: () => ({
    type: null,
    inProgress: false,
    error: false,
    direction: null
  }),

  reset: (setTransitionState) => {
    setTransitionState(transitionUtils.getInitialState());
  }
};

export const bookUtils = {
  isApiBook: (book, bookId = null) => {
    if (book && (typeof book.id === 'number' || book.isFromAPI === true)) {
      return true;
    }
    if (bookId && (typeof bookId === 'number' || !isNaN(parseInt(bookId, 10)))) {
      return true;
    }
    return false;
  }
};