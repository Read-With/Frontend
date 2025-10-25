/**
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
 * 10. 에러 처리: 통일된 에러 로깅 및 처리
 * 
 * - CFI 기반 정확한 위치 계산 (전역 진행률 → 챕터 내 글자수)
 * - Fallback: 단락 기반 추정 (평균 글자수 × 단락 번호)
 * - 로마 숫자(I~M) → 아라비아 숫자 변환
 */

// 통일된 에러 처리 유틸리티
export const errorUtils = {
  logError: (context, error, additionalData = {}) => {
    console.error(`❌ ${context} 실패:`, error, additionalData);
  },
  
  logWarning: (context, message, additionalData = {}) => {
    console.warn(`⚠️ ${context}: ${message}`, additionalData);
  },
  
  logInfo: (context, message, additionalData = {}) => {
    console.log(`ℹ️ ${context}: ${message}`, additionalData);
  },
  
  logSuccess: (context, message, additionalData = {}) => {
    console.log(`✅ ${context}: ${message}`, additionalData);
  },
  
  handleError: (context, error, fallbackValue = null, additionalData = {}) => {
    this.logError(context, error, additionalData);
    return fallbackValue;
  }
};

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
    const settings = storageUtils.get("epub_viewer_settings");
    const loadedSettings = settings ? JSON.parse(settings) : defaultSettings;

    if (loadedSettings.pageMode === "leftOnly") {
      loadedSettings.pageMode = "double";
    }

    if (loadedSettings.showGraph === undefined) {
      loadedSettings.showGraph = defaultSettings.showGraph;
    }
    storageUtils.set("epub_viewer_settings", JSON.stringify(loadedSettings));

    return loadedSettings;
  } catch (error) {
    return errorUtils.handleError('loadSettings', error, defaultSettings, { 
      settings: storageUtils.get("epub_viewer_settings") 
    });
  }
}

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

// 이벤트에서 노드와 엣지 ID 추출 (Set 기반 최적화)
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

// CFI 처리 공통 유틸리티
export const cfiUtils = {
  // CFI에서 챕터 번호 추출
  extractChapterNumber(cfi, label = null) {
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
  },

  // CFI 유효성 검사 (기본)
  isValidCfi(cfi) {
    return cfi && typeof cfi === 'string' && cfi.trim().length > 0;
  },

  // CFI에서 페이지 번호 추출
  extractPageNumber(cfi) {
    if (!this.isValidCfi(cfi)) return null;
    
    const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
    return pageMatch ? parseInt(pageMatch[1]) : null;
  },

  // CFI에서 단락 번호 추출
  extractParagraphNumber(cfi) {
    if (!this.isValidCfi(cfi)) return null;
    
    const paragraphMatch = cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
    return paragraphMatch ? parseInt(paragraphMatch[1]) : null;
  },

  // CFI에서 글자 오프셋 추출
  extractCharOffset(cfi) {
    if (!this.isValidCfi(cfi)) return null;
    
    const offsetMatch = cfi.match(/\[chapter-\d+\]\/(\d+)\/1:(\d+)\)$/);
    return offsetMatch ? parseInt(offsetMatch[2]) : null;
  },
  
  // 현재 위치의 CFI를 강제로 재계산
  async calculateCurrentCfi(book, rendition) {
    try {
      console.log('🔄 CFI 재계산 시작');
      
      // 여러 방법으로 CFI 계산 시도
      let currentCfi = null;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries && !currentCfi) {
        try {
          const currentLocation = rendition.currentLocation();
          console.log(`📍 CFI 계산 시도 (${retryCount + 1}/${maxRetries}):`, currentLocation);
          
          if (currentLocation && currentLocation.start && currentLocation.start.cfi) {
            currentCfi = currentLocation.start.cfi;
            console.log('✅ CFI 발견:', currentCfi);
            break;
          }
          
          // CFI가 없다면 잠시 대기 후 재시도
          if (retryCount < maxRetries - 1) {
            console.log(`⏳ CFI 대기 중... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 300));
          }
          
          retryCount++;
        } catch (error) {
          console.error(`❌ CFI 계산 시도 ${retryCount + 1} 실패:`, error);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 300));
          }
        }
      }
      
      if (!currentCfi) {
        console.warn('⚠️ CFI 계산 실패 - 모든 시도 후에도 CFI를 찾을 수 없습니다');
        return null;
      }
      
      return currentCfi;
    } catch (error) {
      console.error('❌ CFI 계산 중 오류:', error);
      return null;
    }
  },
  
  // CFI 구조 상세 분석
  analyzeCfiStructure(cfi) {
    if (!cfi || typeof cfi !== 'string') {
      return {
        isValid: false,
        error: '유효하지 않은 CFI'
      };
    }
    
    const analysis = {
      isValid: true,
      fullCfi: cfi,
      parts: cfi.split('/'),
      hasChapterPattern: false,
      hasPgepubidPattern: false,
      hasPathPattern: false,
      hasPgHeaderPattern: false,
      hasLastNumberPattern: false,
      chapterNumber: null,
      fileId: null,
      pathNumbers: [],
      lastNumber: null,
      patterns: []
    };
    
    // [chapter-X] 패턴 분석
    const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
      if (chapterMatch) {
      analysis.hasChapterPattern = true;
      analysis.chapterNumber = parseInt(chapterMatch[1]);
      analysis.patterns.push('chapter');
    }
    
    // [pgepubidXXXXX] 패턴 분석
    const pgepubidMatch = cfi.match(/\[pgepubid(\d+)\]/);
    if (pgepubidMatch) {
      analysis.hasPgepubidPattern = true;
      analysis.fileId = parseInt(pgepubidMatch[1]);
      analysis.patterns.push('pgepubid');
    }
    
    // 경로 패턴 분석 (숫자:숫자)
    const pathMatch = cfi.match(/(\d+):(\d+)$/);
    if (pathMatch) {
      analysis.hasPathPattern = true;
      analysis.pathNumbers = [parseInt(pathMatch[1]), parseInt(pathMatch[2])];
      analysis.patterns.push('path');
    }
    
    // [pg-header] 패턴 분석
    if (cfi.includes('[pg-header]')) {
      analysis.hasPgHeaderPattern = true;
      analysis.patterns.push('pg-header');
    }
    
    // 마지막 숫자 패턴 분석
    const lastNumberMatch = cfi.match(/(\d+)(?!.*\d)/);
    if (lastNumberMatch) {
      analysis.hasLastNumberPattern = true;
      analysis.lastNumber = parseInt(lastNumberMatch[1]);
      analysis.patterns.push('last-number');
    }
    
    return analysis;
  },
  
  // 다양한 CFI 계산 방법들
  calculateNextCfiVariants(currentCfi, cfiAnalysis) {
    const variants = [];
    
    // 방법 1: Chapter 패턴 기반
    if (cfiAnalysis.hasChapterPattern) {
      const nextChapter = cfiAnalysis.chapterNumber + 1;
      const chapterVariant = currentCfi.replace(/\[chapter-\d+\]/, `[chapter-${nextChapter}]`);
      variants.push({
        method: 'chapter',
        cfi: chapterVariant,
        confidence: 0.9,
        description: `Chapter ${cfiAnalysis.chapterNumber} → ${nextChapter}`
      });
    }
    
    // 방법 2: Pgepubid 패턴 기반
    if (cfiAnalysis.hasPgepubidPattern) {
      const nextFileId = cfiAnalysis.fileId + 1;
      const pgepubidVariant = currentCfi.replace(/\[pgepubid\d+\]/, `[pgepubid${nextFileId}]`);
      variants.push({
        method: 'pgepubid',
        cfi: pgepubidVariant,
        confidence: 0.8,
        description: `File ID ${cfiAnalysis.fileId} → ${nextFileId}`
      });
    }
    
    // 방법 3: 경로 패턴 기반
    if (cfiAnalysis.hasPathPattern) {
      const [currentPath, currentOffset] = cfiAnalysis.pathNumbers;
        const nextPath = currentPath + 1;
      const pathVariant = currentCfi.replace(/\d+:\d+$/, `${nextPath}:0`);
      variants.push({
        method: 'path',
        cfi: pathVariant,
        confidence: 0.7,
        description: `Path ${currentPath} → ${nextPath}`
      });
    }
    
    // 방법 4: Pg-header 패턴 기반
    if (cfiAnalysis.hasPgHeaderPattern) {
      const pgHeaderVariants = [
        currentCfi.replace(/\[pg-header\]/, '[pg-start-separator]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-content]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-body]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-text]'),
        currentCfi.replace(/\[pg-header\]/, '[pg-chapter]')
      ];
      
      pgHeaderVariants.forEach((variant, index) => {
        variants.push({
          method: 'pg-header',
          cfi: variant,
          confidence: 0.6 - (index * 0.1),
          description: `Pg-header → Section ${index + 1}`
        });
      });
    }
    
    // 방법 5: 마지막 숫자 패턴 기반
    if (cfiAnalysis.hasLastNumberPattern) {
      const nextNumber = cfiAnalysis.lastNumber + 1;
      const lastNumberVariant = currentCfi.replace(/\d+(?!.*\d)/, nextNumber.toString());
      variants.push({
        method: 'last-number',
        cfi: lastNumberVariant,
        confidence: 0.5,
        description: `Last number ${cfiAnalysis.lastNumber} → ${nextNumber}`
      });
    }
    
    // 방법 6: 복합 패턴 (여러 패턴 조합)
    if (cfiAnalysis.patterns.length > 1) {
      const combinedVariant = this.createCombinedVariant(currentCfi, cfiAnalysis);
      if (combinedVariant) {
        variants.push({
          method: 'combined',
          cfi: combinedVariant,
          confidence: 0.85,
          description: 'Combined pattern approach'
        });
      }
    }
    
    // 신뢰도 순으로 정렬
    return variants.sort((a, b) => b.confidence - a.confidence);
  },
  
  // 복합 패턴 CFI 생성
  createCombinedVariant(currentCfi, cfiAnalysis) {
    let variant = currentCfi;
    
    // Chapter 패턴이 있으면 우선 적용
    if (cfiAnalysis.hasChapterPattern) {
      const nextChapter = cfiAnalysis.chapterNumber + 1;
      variant = variant.replace(/\[chapter-\d+\]/, `[chapter-${nextChapter}]`);
    }
    
    // Pgepubid 패턴이 있으면 적용
    if (cfiAnalysis.hasPgepubidPattern) {
      const nextFileId = cfiAnalysis.fileId + 1;
      variant = variant.replace(/\[pgepubid\d+\]/, `[pgepubid${nextFileId}]`);
    }
    
    // 경로 패턴이 있으면 적용
    if (cfiAnalysis.hasPathPattern) {
      const [currentPath] = cfiAnalysis.pathNumbers;
      const nextPath = currentPath + 1;
      variant = variant.replace(/\d+:\d+$/, `${nextPath}:0`);
    }
    
    return variant !== currentCfi ? variant : null;
  },
  
  // CFI를 이용한 다음 위치 계산 (다양한 CFI 처리)
  async getNextCfi(book, rendition, currentCfi) {
    errorUtils.logInfo('getNextCfi', '다양한 CFI 처리 시작', { currentCfi });
    
    try {
      // CFI 구조 상세 분석
      const cfiAnalysis = this.analyzeCfiStructure(currentCfi);
      errorUtils.logInfo('getNextCfi', 'CFI 구조 상세 분석 완료', cfiAnalysis);
      
      if (!cfiAnalysis.isValid) {
        errorUtils.logError('getNextCfi', 'CFI 분석 실패', cfiAnalysis.error);
        return null;
      }
      
      // 다양한 CFI 계산 방법들 생성
      const cfiVariants = this.calculateNextCfiVariants(currentCfi, cfiAnalysis);
      errorUtils.logInfo('getNextCfi', 'CFI 변형들 생성 완료', { count: cfiVariants.length });
      
      // Navigation Document 우선 확인 (Chapter 패턴이 있는 경우)
      if (cfiAnalysis.hasChapterPattern) {
        const currentChapter = cfiAnalysis.chapterNumber;
        const nextChapter = currentChapter + 1;
        
        errorUtils.logInfo('getNextCfi', '[chapter-X] 패턴 발견', { currentChapter, nextChapter });
        
        // Navigation Document에서 다음 챕터의 href 확인
        if (book.navigation?.toc) {
          const nextChapterItem = book.navigation.toc.find(item => {
            const chapterMatch = item.cfi?.match(/\[chapter-(\d+)\]/);
            return chapterMatch && parseInt(chapterMatch[1]) === nextChapter;
          });
          
          if (nextChapterItem?.href) {
            errorUtils.logSuccess('getNextCfi', 'Navigation Document에서 다음 챕터 href 발견', { href: nextChapterItem.href });
            return nextChapterItem.href; // href 기반 대안 반환
          }
        }
      }
      
      // CFI 변형들을 신뢰도 순으로 시도
      for (const variant of cfiVariants) {
        errorUtils.logInfo('getNextCfi', `${variant.method} 방법 시도`, {
          cfi: variant.cfi,
          confidence: variant.confidence,
          description: variant.description
        });
        
        // CFI 유효성 검사
        if (this.validateCfi(variant.cfi)) {
          errorUtils.logSuccess('getNextCfi', `${variant.method} 방법 유효한 CFI 생성`, { cfi: variant.cfi });
          return variant.cfi;
        } else {
          errorUtils.logWarning('getNextCfi', `${variant.method} 방법 CFI 유효성 검사 실패`, { cfi: variant.cfi });
        }
      }
      
      errorUtils.logWarning('getNextCfi', '모든 CFI 계산 방법 실패');
      return null;
    } catch (error) {
      errorUtils.logError('getNextCfi', error);
      return null;
    }
  },
  
  // CFI 상세 유효성 검사 (고급)
  validateCfi(cfi) {
    if (!this.isValidCfi(cfi)) return false;
    
    // 기본 CFI 형식 검사
    if (!cfi.includes('epubcfi')) return false;
    
    // CFI 길이 검사 (너무 짧거나 긴 경우)
    if (cfi.length < 10 || cfi.length > 1000) return false;
    
    // CFI 구조 검사
    const cfiParts = cfi.split('/');
    if (cfiParts.length < 3) return false;
    
    // 숫자 패턴 검사
    const hasValidNumbers = /\d+/.test(cfi);
    if (!hasValidNumbers) return false;
    
    // 특수 문자 검사 (유효하지 않은 문자 제외)
    const hasInvalidChars = /[<>"']/.test(cfi);
    if (hasInvalidChars) return false;
    
    return true;
  },
  
  // 이전 CFI 계산 방법들
  calculatePrevCfiVariants(currentCfi, cfiAnalysis) {
    const variants = [];
    
    // 방법 1: Chapter 패턴 기반
    if (cfiAnalysis.hasChapterPattern && cfiAnalysis.chapterNumber > 1) {
      const prevChapter = cfiAnalysis.chapterNumber - 1;
      const chapterVariant = currentCfi.replace(/\[chapter-\d+\]/, `[chapter-${prevChapter}]`);
      variants.push({
        method: 'chapter',
        cfi: chapterVariant,
        confidence: 0.9,
        description: `Chapter ${cfiAnalysis.chapterNumber} → ${prevChapter}`
      });
    }
    
    // 방법 2: Pgepubid 패턴 기반
    if (cfiAnalysis.hasPgepubidPattern && cfiAnalysis.fileId > 0) {
      const prevFileId = cfiAnalysis.fileId - 1;
      const pgepubidVariant = currentCfi.replace(/\[pgepubid\d+\]/, `[pgepubid${prevFileId}]`);
      variants.push({
        method: 'pgepubid',
        cfi: pgepubidVariant,
        confidence: 0.8,
        description: `File ID ${cfiAnalysis.fileId} → ${prevFileId}`
      });
    }
    
    // 방법 3: 경로 패턴 기반
    if (cfiAnalysis.hasPathPattern && cfiAnalysis.pathNumbers[0] > 0) {
      const [currentPath] = cfiAnalysis.pathNumbers;
      const prevPath = currentPath - 1;
      const pathVariant = currentCfi.replace(/\d+:\d+$/, `${prevPath}:0`);
      variants.push({
        method: 'path',
        cfi: pathVariant,
        confidence: 0.7,
        description: `Path ${currentPath} → ${prevPath}`
      });
    }
    
    // 방법 4: 마지막 숫자 패턴 기반
    if (cfiAnalysis.hasLastNumberPattern && cfiAnalysis.lastNumber > 0) {
      const prevNumber = cfiAnalysis.lastNumber - 1;
      const lastNumberVariant = currentCfi.replace(/\d+(?!.*\d)/, prevNumber.toString());
      variants.push({
        method: 'last-number',
        cfi: lastNumberVariant,
        confidence: 0.5,
        description: `Last number ${cfiAnalysis.lastNumber} → ${prevNumber}`
      });
    }
    
    // 신뢰도 순으로 정렬
    return variants.sort((a, b) => b.confidence - a.confidence);
  },
  
  // CFI를 이용한 이전 위치 계산 (다양한 CFI 처리)
  async getPrevCfi(book, rendition, currentCfi) {
    console.log('🔄 getPrevCfi 함수 시작 (다양한 CFI 처리)', { currentCfi });
    
    try {
      // CFI 구조 상세 분석
      const cfiAnalysis = this.analyzeCfiStructure(currentCfi);
      console.log('🔍 CFI 구조 상세 분석:', cfiAnalysis);
      
      if (!cfiAnalysis.isValid) {
        console.error('❌ CFI 분석 실패:', cfiAnalysis.error);
          return null;
        }
      
      // 다양한 CFI 계산 방법들 생성
      const cfiVariants = this.calculatePrevCfiVariants(currentCfi, cfiAnalysis);
      console.log('🎯 생성된 CFI 변형들:', cfiVariants);
      
      // Navigation Document 우선 확인 (Chapter 패턴이 있는 경우)
      if (cfiAnalysis.hasChapterPattern && cfiAnalysis.chapterNumber > 1) {
        const currentChapter = cfiAnalysis.chapterNumber;
        const prevChapter = currentChapter - 1;
        
        console.log('📍 [chapter-X] 패턴 발견:', { currentChapter, prevChapter });
        
        // Navigation Document에서 이전 챕터의 href 확인
        if (book.navigation?.toc) {
          const prevChapterItem = book.navigation.toc.find(item => {
            const chapterMatch = item.cfi?.match(/\[chapter-(\d+)\]/);
            return chapterMatch && parseInt(chapterMatch[1]) === prevChapter;
          });
          
          if (prevChapterItem?.href) {
            console.log('✅ Navigation Document에서 이전 챕터 href 발견:', prevChapterItem.href);
            return prevChapterItem.href; // href 기반 대안 반환
          }
        }
      }
      
      // CFI 변형들을 신뢰도 순으로 시도
      for (const variant of cfiVariants) {
        console.log(`🔄 ${variant.method} 방법 시도:`, {
          cfi: variant.cfi,
          confidence: variant.confidence,
          description: variant.description
        });
        
        // CFI 유효성 검사
        if (this.validateCfi(variant.cfi)) {
          console.log(`✅ ${variant.method} 방법 유효한 CFI 생성:`, variant.cfi);
          return variant.cfi;
        } else {
          console.log(`⚠️ ${variant.method} 방법 CFI 유효성 검사 실패:`, variant.cfi);
        }
      }
      
      console.warn('⚠️ 모든 CFI 계산 방법 실패');
      return null;
    } catch (error) {
      console.error('❌ 이전 CFI 계산 중 오류:', error);
          return null;
        }
  },
  
  // Spine 기반 직접 이동 (CFI 실패 시 대안)
  async getSpineNavigation(book, rendition, direction) {
    console.log('🔄 getSpineNavigation 함수 시작', { direction });
    
    try {
      // 현재 위치에서 spine 인덱스 찾기
      const currentLocation = rendition.currentLocation();
      if (!currentLocation?.start?.spinePos && currentLocation?.start?.spinePos !== 0) {
        console.warn('⚠️ 현재 spine 위치를 찾을 수 없습니다');
        return null;
      }
      
      const currentSpineIndex = currentLocation.start.spinePos;
      const totalSpineItems = book.spine?.length || 0;
      
      console.log('📍 현재 spine 정보:', {
        currentSpineIndex,
        totalSpineItems,
        direction
      });
      
      let targetSpineIndex;
      
      if (direction === 'next') {
        targetSpineIndex = currentSpineIndex + 1;
        if (targetSpineIndex >= totalSpineItems) {
          console.log('ℹ️ 마지막 spine 항목입니다');
          return null;
        }
      } else if (direction === 'prev') {
        targetSpineIndex = currentSpineIndex - 1;
        if (targetSpineIndex < 0) {
          console.log('ℹ️ 첫 번째 spine 항목입니다');
          return null;
        }
      } else {
        console.warn('⚠️ 잘못된 방향입니다:', direction);
          return null;
        }
        
      // 대상 spine 항목 가져오기
      const targetSpineItem = book.spine.get(targetSpineIndex);
      if (!targetSpineItem) {
        console.warn('⚠️ 대상 spine 항목을 찾을 수 없습니다:', targetSpineIndex);
        return null;
      }
      
      console.log('✅ Spine 기반 이동 대상:', {
        targetSpineIndex,
        href: targetSpineItem.href,
        direction
      });
      
      // spine 인덱스 또는 href 반환
      return {
        type: 'spine',
        index: targetSpineIndex,
        href: targetSpineItem.href
      };
      
    } catch (error) {
      console.error('❌ Spine 기반 이동 계산 중 오류:', error);
      return null;
    }
  },
  
  // 개선된 하이브리드 탐색 (다층적 fallback 체인)
  async navigateWithFallback(book, rendition, direction) {
    console.log('🚀 navigateWithFallback 시작 (개선된 하이브리드)', { direction });
    
    try {
      // 뷰어 로드 상태 확인
      console.log('🔍 뷰어 로드 상태 확인:', {
        hasBook: !!book,
        hasSpine: !!book?.spine,
        hasRendition: !!rendition,
        renditionStarted: rendition?.started,
        renditionDisplaying: rendition?.displaying,
        spineLength: book?.spine?.length || 0
      });
      
      // 뷰어가 완전히 로드되지 않은 경우 대기
      if (!book?.spine || !rendition?.started || rendition?.displaying === undefined) {
        console.warn('⚠️ 뷰어가 아직 완전히 로드되지 않았습니다. 대기 중...', {
          hasSpine: !!book?.spine,
          renditionStarted: rendition?.started,
          renditionDisplaying: rendition?.displaying,
          spineLength: book?.spine?.length || 0
        });
        
        // 최대 5초 대기 (더 긴 대기 시간)
        let retryCount = 0;
        const maxRetries = 15; // 15회 × 300ms = 4.5초
        
        while (retryCount < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 300));
          
          // 더 엄격한 조건 확인
          const isFullyLoaded = book?.spine && 
                               rendition?.started && 
                               rendition?.displaying !== undefined &&
                               book?.spine?.length > 0;
          
          if (isFullyLoaded) {
            console.log('✅ 뷰어 완전 로드 확인:', {
              hasSpine: !!book?.spine,
              spineLength: book?.spine?.length,
              renditionStarted: rendition?.started,
              renditionDisplaying: rendition?.displaying
            });
            break;
          }
          
          retryCount++;
          console.log(`⏳ 뷰어 로드 대기 중... (${retryCount}/${maxRetries})`, {
            hasSpine: !!book?.spine,
            spineLength: book?.spine?.length || 0,
            renditionStarted: rendition?.started,
            renditionDisplaying: rendition?.displaying
          });
        }
        
        // 여전히 로드되지 않은 경우 기본 메서드 사용
        const isStillNotLoaded = !book?.spine || !rendition?.started || rendition?.displaying === undefined;
        if (isStillNotLoaded) {
          console.warn('⚠️ 뷰어 로드 대기 시간 초과, 기본 메서드 사용', {
            hasSpine: !!book?.spine,
            spineLength: book?.spine?.length || 0,
            renditionStarted: rendition?.started,
            renditionDisplaying: rendition?.displaying
          });
          
          try {
            const basicMethod = direction === 'next' ? rendition.next() : rendition.prev();
            await basicMethod;
            return { success: true, method: 'basic_fallback', target: direction };
          } catch (basicError) {
            console.error('❌ 기본 메서드도 실패:', basicError);
            return { success: false, error: `뷰어 로드 실패: ${basicError.message}` };
          }
        }
      }
      
      // 1차: CFI 기반 정확한 이동
      console.log('📍 1차: CFI 기반 이동 시도');
      const currentLocation = rendition.currentLocation();
      const currentCfi = currentLocation?.start?.cfi;
      
      if (currentCfi) {
        let targetCfi;
        if (direction === 'next') {
          targetCfi = await this.getNextCfi(book, rendition, currentCfi);
        } else {
          targetCfi = await this.getPrevCfi(book, rendition, currentCfi);
        }
        
        if (targetCfi) {
          console.log('✅ CFI 기반 이동 시도:', targetCfi);
          await rendition.display(targetCfi);
          return { success: true, method: 'cfi', target: targetCfi };
        }
      }
      
      // 2차: Navigation Document 기반 이동
      console.log('📍 2차: Navigation Document 기반 이동 시도');
      if (book.navigation?.toc) {
        const currentChapter = currentCfi?.match(/\[chapter-(\d+)\]/)?.[1];
        if (currentChapter) {
          const currentChapterNum = parseInt(currentChapter);
          const targetChapterNum = direction === 'next' ? currentChapterNum + 1 : currentChapterNum - 1;
          
          const targetChapterItem = book.navigation.toc.find(item => {
            const chapterMatch = item.cfi?.match(/\[chapter-(\d+)\]/);
            return chapterMatch && parseInt(chapterMatch[1]) === targetChapterNum;
          });
          
          if (targetChapterItem?.cfi) {
            console.log('✅ Navigation Document 기반 이동 시도:', targetChapterItem.cfi);
            await rendition.display(targetChapterItem.cfi);
            return { success: true, method: 'navigation', target: targetChapterItem.cfi };
          }
        }
      }
      
      // 3차: Spine 기반 직접 이동
      console.log('📍 3차: Spine 기반 직접 이동 시도');
      const spineNavigation = await this.getSpineNavigation(book, rendition, direction);
      if (spineNavigation) {
        console.log('✅ Spine 기반 이동 시도:', spineNavigation);
        await rendition.display(spineNavigation.index);
        return { success: true, method: 'spine', target: spineNavigation };
      }
      
      // 4차: 기본 메서드 (최후의 수단)
      console.log('📍 4차: 기본 메서드 시도');
      const basicMethod = direction === 'next' ? rendition.next() : rendition.prev();
      await basicMethod;
      return { success: true, method: 'basic', target: direction };
      
    } catch (error) {
      console.error('❌ 모든 탐색 방법 실패:', error);
      return { success: false, error: error.message };
    }
  }
};

// extractChapterNumber는 cfiUtils.extractChapterNumber로 통합됨

// CFI 매핑을 통한 정확한 챕터 감지 (EpubViewer에서 사용)
export function detectCurrentChapter(cfi, chapterCfiMap = null) {
  let detectedChapter = cfiUtils.extractChapterNumber(cfi);
  
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

// localStorage 캐시 관리
class StorageCache {
  constructor() {
    this.cache = new Map();
    this.maxSize = 50;
    this.ttl = 5 * 60 * 1000; // 5분
  }

  get(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.value;
    }
    
    const value = localStorage.getItem(key);
    this._setCache(key, value);
    return value;
  }

  set(key, value) {
    localStorage.setItem(key, value);
    this._setCache(key, value);
  }

  remove(key) {
    localStorage.removeItem(key);
    this.cache.delete(key);
  }

  getJson(key, defaultValue = {}) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.ttl && cached.parsed) {
      return cached.value;
    }

    try {
      const value = JSON.parse(localStorage.getItem(key) || '{}');
      this._setCache(key, value, true);
      return value;
    } catch {
      this._setCache(key, defaultValue, true);
      return defaultValue;
    }
  }

  setJson(key, value) {
    const jsonValue = JSON.stringify(value);
    localStorage.setItem(key, jsonValue);
    this._setCache(key, value, true);
  }

  _setCache(key, value, parsed = false) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      parsed
    });
  }

  clear() {
    this.cache.clear();
  }
}

const storageCache = new StorageCache();

export const storageUtils = {
  get: (key) => storageCache.get(key),
  set: (key, value) => storageCache.set(key, value),
  remove: (key) => storageCache.remove(key),
  getJson: (key, defaultValue = {}) => storageCache.getJson(key, defaultValue),
  setJson: (key, value) => storageCache.setJson(key, value),
  clearCache: () => storageCache.clear()
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
  // 안전한 페이지 이동 처리 (CFI 기반만)
  async safeNavigate(book, rendition, action, direction = 'next', setIsNavigating, setNavigationError, storageKeys) {
    console.log(`🔄 safeNavigate 함수 진입: ${direction}`, {
      hasBook: !!book,
      hasRendition: !!rendition,
      hasAction: typeof action === 'function',
      hasSetIsNavigating: typeof setIsNavigating === 'function',
      hasSetNavigationError: typeof setNavigationError === 'function'
    });
    
    if (!book || !rendition) {
      errorUtils.logWarning('safeNavigate', 'book 또는 rendition이 없습니다', { hasBook: !!book, hasRendition: !!rendition });
      return;
    }
    
    console.log(`🔄 safeNavigate 시작: ${direction}`, {
      hasBook: !!book,
      hasRendition: !!rendition,
      renditionMethods: rendition ? Object.keys(rendition) : null
    });
    
    setIsNavigating(true);
    setNavigationError(null);

    try {
      // 현재 위치 확인 (동기적 처리)
      let currentLocation;
      try {
        currentLocation = rendition.currentLocation();
        console.log('📍 이동 전 현재 위치:', currentLocation);
      } catch (err) {
        console.warn('⚠️ 현재 위치 조회 실패:', err);
        currentLocation = null;
      }
      
      // 무조건 CFI 기반 이동만 시도
      console.log(`🚀 ${direction} 이동 시도 중...`);
      const result = await action();
      console.log(`✅ ${direction} 이동 결과:`, result);
      
      // 네비게이션 완료 후 잠시 대기
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 이동 후 위치 확인 (동기적 처리)
      let newLocation;
      try {
        newLocation = rendition.currentLocation();
        console.log('📍 이동 후 새로운 위치:', newLocation);
      } catch (err) {
        console.warn('⚠️ 이동 후 위치 조회 실패:', err);
        newLocation = null;
      }
      
      errorUtils.logSuccess('safeNavigate', `${direction} 페이지 이동 완료`);
      
    } catch (error) {
      console.error(`❌ ${direction} 이동 실패:`, error);
      errorUtils.logError('safeNavigate', error);
      setNavigationError('페이지 이동 중 오류가 발생했습니다.');
    } finally {
      // 네비게이션 상태 리셋
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