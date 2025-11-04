/**
 * 책 manifest 데이터 캐시 관리
 * maxChapter 등 manifest에서 추출한 정보를 메모리에 저장
 */

const manifestCache = new Map();

/**
 * 책의 maxChapter 저장
 * @param {number} bookId - 책 ID
 * @param {number} maxChapter - 최대 챕터 수
 */
export function setMaxChapter(bookId, maxChapter) {
  if (!bookId || typeof bookId !== 'number') return;
  if (typeof maxChapter !== 'number' || maxChapter < 1) return;
  
  manifestCache.set(`maxChapter:${bookId}`, maxChapter);
}

/**
 * 책의 maxChapter 조회
 * @param {number} bookId - 책 ID
 * @returns {number|null} 최대 챕터 수 (없으면 null)
 */
export function getMaxChapter(bookId) {
  if (!bookId || typeof bookId !== 'number') return null;
  
  const maxChapter = manifestCache.get(`maxChapter:${bookId}`);
  return maxChapter || null;
}

/**
 * 책의 manifest 데이터 저장
 * @param {number} bookId - 책 ID
 * @param {Object} manifestData - manifest 데이터
 */
export function setManifestData(bookId, manifestData) {
  if (!bookId || typeof bookId !== 'number') return;
  if (!manifestData) return;
  
  // progressMetadata에서 maxChapter 추출
  const maxChapter = manifestData.progressMetadata?.maxChapter;
  if (maxChapter && typeof maxChapter === 'number' && maxChapter > 0) {
    setMaxChapter(bookId, maxChapter);
  }
  
  // 각 챕터의 최대 이벤트 수 계산 및 저장
  const chapters = manifestData.chapters || [];
  const chapterMaxEvents = new Map();
  
  for (const chapter of chapters) {
    const chapterIdx = chapter?.idx || chapter?.chapterIdx || chapter?.chapter || chapter?.index || chapter?.number || chapter?.id;
    if (chapterIdx && typeof chapterIdx === 'number') {
      // events 배열의 길이를 최대 이벤트 수로 사용
      const events = chapter?.events || [];
      const maxEvent = Array.isArray(events) ? events.length : 0;
      chapterMaxEvents.set(chapterIdx, maxEvent);
    }
  }
  
  if (chapterMaxEvents.size > 0) {
    manifestCache.set(`chapterMaxEvents:${bookId}`, chapterMaxEvents);
  }
  
  // 전체 manifest 데이터도 저장 (필요시 사용)
  manifestCache.set(`manifest:${bookId}`, manifestData);
}

/**
 * 책의 manifest 데이터 조회
 * @param {number} bookId - 책 ID
 * @returns {Object|null} manifest 데이터 (없으면 null)
 */
export function getManifestData(bookId) {
  if (!bookId || typeof bookId !== 'number') return null;
  return manifestCache.get(`manifest:${bookId}`) || null;
}

/**
 * 특정 챕터의 최대 이벤트 수 조회
 * @param {number} bookId - 책 ID
 * @param {number} chapterIdx - 챕터 인덱스
 * @returns {number|null} 최대 이벤트 수 (없으면 null)
 */
export function getChapterMaxEvent(bookId, chapterIdx) {
  if (!bookId || typeof bookId !== 'number') return null;
  if (!chapterIdx || typeof chapterIdx !== 'number') return null;
  
  const chapterMaxEvents = manifestCache.get(`chapterMaxEvents:${bookId}`);
  if (!chapterMaxEvents || !(chapterMaxEvents instanceof Map)) return null;
  
  return chapterMaxEvents.get(chapterIdx) || null;
}

/**
 * 특정 챕터의 이벤트가 유효한지 확인
 * @param {number} bookId - 책 ID
 * @param {number} chapterIdx - 챕터 인덱스
 * @param {number} eventIdx - 이벤트 인덱스 (0-based)
 * @returns {boolean} 유효한 이벤트인지 여부
 */
export function isValidEvent(bookId, chapterIdx, eventIdx) {
  if (!bookId || !chapterIdx || eventIdx === undefined || eventIdx === null) return false;
  if (eventIdx < 1) return false; // eventIdx는 1-based
  
  const maxEvent = getChapterMaxEvent(bookId, chapterIdx);
  if (maxEvent === null) return true; // 정보가 없으면 일단 true (기존 동작 유지)
  
  return eventIdx <= maxEvent;
}

/**
 * 특정 책의 캐시 삭제
 * @param {number} bookId - 책 ID
 */
export function clearBookCache(bookId) {
  if (!bookId || typeof bookId !== 'number') return;
  manifestCache.delete(`maxChapter:${bookId}`);
  manifestCache.delete(`manifest:${bookId}`);
  manifestCache.delete(`chapterMaxEvents:${bookId}`);
}

/**
 * 모든 캐시 삭제
 */
export function clearAllCache() {
  manifestCache.clear();
}

