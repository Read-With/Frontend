/**
 * 챕터별 이벤트 탐색 및 캐싱 유틸리티
 * 
 * 각 챕터마다 eventIdx 1부터 순차적으로 API를 호출하여
 * 마지막 이벤트를 찾고, 결과를 로컬 스토리지에 캐싱합니다.
 */

import { getFineGraph } from './api';
import { getChapterData as getManifestChapterData } from './manifestCache';

const CHAPTER_EVENT_CACHE_PREFIX = 'chapter_events_';
const CACHE_VERSION = 'v1';

/**
 * 챕터별 이벤트 캐시 키 생성
 */
const getChapterEventCacheKey = (bookId, chapterIdx) => {
  return `${CHAPTER_EVENT_CACHE_PREFIX}${CACHE_VERSION}_${bookId}_${chapterIdx}`;
};

/**
 * 캐시된 챕터 이벤트 정보 가져오기
 */
export const getCachedChapterEvents = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    const cached = localStorage.getItem(cacheKey);
    
    if (!cached) return null;
    
    const cacheData = JSON.parse(cached);
    
    // 캐시 유효성 검사 (24시간)
    const now = Date.now();
    const cacheAge = now - (cacheData.timestamp || 0);
    const maxAge = 24 * 60 * 60 * 1000; // 24시간
    
    if (cacheAge > maxAge) {
      localStorage.removeItem(cacheKey);
      return null;
    }
    
    return cacheData;
  } catch (error) {
    console.error('챕터 이벤트 캐시 로드 실패:', error);
    return null;
  }
};

/**
 * 챕터 이벤트 정보 캐시에 저장
 */
export const setCachedChapterEvents = (bookId, chapterIdx, eventData) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    const cacheData = {
      bookId,
      chapterIdx,
      maxEventIdx: eventData.maxEventIdx,
      events: eventData.events,
      timestamp: Date.now()
    };
    
    localStorage.setItem(cacheKey, JSON.stringify(cacheData));
    return true;
  } catch (error) {
    console.error('챕터 이벤트 캐시 저장 실패:', error);
    return false;
  }
};

/**
 * 특정 챕터의 모든 이벤트를 순차적으로 탐색
 * 
 * @param {number} bookId - 책 ID
 * @param {number} chapterIdx - 챕터 인덱스
 * @param {boolean} forceRefresh - 캐시 무시하고 강제로 다시 탐색
 * @returns {Promise<{maxEventIdx: number, events: Array}>}
 */
export const discoverChapterEvents = async (bookId, chapterIdx, forceRefresh = false) => {
  console.log('🔍 챕터 이벤트 탐색 시작:', { bookId, chapterIdx, forceRefresh });
  
  // 캐시 확인 (강제 새로고침이 아닌 경우)
  if (!forceRefresh) {
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (cached) {
      console.log('✅ 캐시된 이벤트 정보 사용:', {
        bookId,
        chapterIdx,
        maxEventIdx: cached.maxEventIdx,
        eventsCount: cached.events?.length || 0
      });
      return cached;
    }
  }
  
  // manifest에서 이벤트 정보 우선 확인
  const manifestChapter = getManifestChapterData(bookId, chapterIdx);
  if (manifestChapter?.events?.length) {
    const normalizedEvents = manifestChapter.events
      .map((rawEvent, index) => {
        if (!rawEvent) return null;

        const rawIdx = rawEvent.idx ?? rawEvent.eventIdx ?? rawEvent.index ?? rawEvent.id;
        const eventIdx = Number(rawIdx ?? index + 1);

        if (!Number.isFinite(eventIdx) || eventIdx <= 0) return null;

        const startPos = typeof rawEvent.startPos === 'number' ? rawEvent.startPos : rawEvent.start;
        const endPos = typeof rawEvent.endPos === 'number' ? rawEvent.endPos : rawEvent.end;

        const normalizedEvent = {
          eventIdx,
          chapterIdx,
          characters: rawEvent.characters || [],
          relations: rawEvent.relations || [],
          event: {
            ...rawEvent,
            idx: eventIdx,
            start: startPos ?? null,
            end: endPos ?? null
          },
          startPos: startPos ?? null,
          endPos: endPos ?? null,
          eventId: rawEvent.eventId ?? rawEvent.event_id ?? rawEvent.id ?? null
        };

        return normalizedEvent;
      })
      .filter(Boolean);

    if (normalizedEvents.length > 0) {
      const maxEventIdx = normalizedEvents.reduce((max, ev) => Math.max(max, ev.eventIdx), 0);

      const resultFromManifest = {
        bookId,
        chapterIdx,
        maxEventIdx,
        events: normalizedEvents,
        timestamp: Date.now(),
        source: 'manifest'
      };

      console.log('📚 manifest 이벤트 정보 사용:', {
        bookId,
        chapterIdx,
        maxEventIdx,
        eventsCount: normalizedEvents.length
      });

      setCachedChapterEvents(bookId, chapterIdx, resultFromManifest);
      return resultFromManifest;
    }
  }

  // API를 통해 이벤트 순차 탐색
  const events = [];
  let currentEventIdx = 1;
  let maxEventIdx = 0;
  let consecutiveEmptyCount = 0;
  const maxConsecutiveEmpty = 1; // 연속 1번 비어있으면 종료
  
  while (true) {
    try {
      console.log(`📡 이벤트 API 호출: eventIdx=${currentEventIdx}`);
      
      const response = await getFineGraph(bookId, chapterIdx, currentEventIdx);
      
      // 응답 검증
      if (!response?.isSuccess || !response?.result) {
        console.warn(`⚠️ 이벤트 ${currentEventIdx}: 응답 실패`);
        consecutiveEmptyCount++;
        
        if (consecutiveEmptyCount >= maxConsecutiveEmpty) {
          console.log(`🛑 연속 ${maxConsecutiveEmpty}번 실패, 탐색 종료`);
          break;
        }
        
        currentEventIdx++;
        continue;
      }
      
      const { characters, relations, event } = response.result;
      
      // 데이터가 있는지 확인
      const hasData = (characters && characters.length > 0) || (relations && relations.length > 0);
      
      if (hasData) {
        // 유효한 이벤트 발견
        maxEventIdx = currentEventIdx;
        consecutiveEmptyCount = 0;
        
        events.push({
          eventIdx: currentEventIdx,
          chapterIdx,
          characters,
          relations,
          event,
          startPos: event?.start,
          endPos: event?.end,
          eventId: event?.event_id
        });
        
        console.log(`✅ 이벤트 ${currentEventIdx}: 데이터 존재 (캐릭터: ${characters?.length || 0}, 관계: ${relations?.length || 0})`);
      } else {
        // 데이터 없음
        console.log(`⚪ 이벤트 ${currentEventIdx}: 데이터 없음`);
        consecutiveEmptyCount++;
        
        if (consecutiveEmptyCount >= maxConsecutiveEmpty) {
          console.log(`🛑 연속 ${maxConsecutiveEmpty}번 비어있음, 탐색 종료`);
          break;
        }
      }
      
      currentEventIdx++;
      
      // 안전장치: 최대 100개 이벤트까지만 탐색
      if (currentEventIdx > 100) {
        console.warn('⚠️ 최대 이벤트 수(100) 도달, 탐색 종료');
        break;
      }
      
      // API 부하 방지를 위한 딜레이
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error(`❌ 이벤트 ${currentEventIdx} 탐색 실패:`, error);
      consecutiveEmptyCount++;
      
      if (consecutiveEmptyCount >= maxConsecutiveEmpty) {
        console.log(`🛑 연속 ${maxConsecutiveEmpty}번 오류, 탐색 종료`);
        break;
      }
      
      currentEventIdx++;
    }
  }
  
  const result = {
    bookId,
    chapterIdx,
    maxEventIdx,
    events,
    timestamp: Date.now()
  };
  
  console.log('🎯 챕터 이벤트 탐색 완료:', {
    bookId,
    chapterIdx,
    maxEventIdx,
    totalEvents: events.length
  });
  
  // 캐시에 저장
  setCachedChapterEvents(bookId, chapterIdx, result);
  
  return result;
};

/**
 * 특정 이벤트 데이터 가져오기 (캐시 우선)
 */
export const getEventData = async (bookId, chapterIdx, eventIdx) => {
  // 캐시된 챕터 이벤트 확인
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  
  if (cached && cached.events) {
    const event = cached.events.find(e => e.eventIdx === eventIdx);
    if (event) {
      console.log('✅ 캐시된 이벤트 사용:', { bookId, chapterIdx, eventIdx });
      return event;
    }
  }
  
  // 캐시에 없으면 API 호출
  try {
    const response = await getFineGraph(bookId, chapterIdx, eventIdx);
    
    if (response?.isSuccess && response?.result) {
      const { characters, relations, event } = response.result;
      
      return {
        eventIdx,
        chapterIdx,
        characters,
        relations,
        event,
        startPos: event?.start,
        endPos: event?.end,
        eventId: event?.event_id
      };
    }
  } catch (error) {
    console.error('이벤트 데이터 가져오기 실패:', error);
  }
  
  return null;
};

/**
 * 챕터의 최대 이벤트 인덱스 가져오기
 */
export const getMaxEventIdx = async (bookId, chapterIdx) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  
  if (cached) {
    return cached.maxEventIdx;
  }
  
  // 캐시에 없으면 탐색
  const result = await discoverChapterEvents(bookId, chapterIdx);
  return result.maxEventIdx;
};

/**
 * 챕터 이벤트 캐시 삭제
 */
export const clearChapterEventCache = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    localStorage.removeItem(cacheKey);
    console.log('🗑️ 챕터 이벤트 캐시 삭제:', { bookId, chapterIdx });
    return true;
  } catch (error) {
    console.error('챕터 이벤트 캐시 삭제 실패:', error);
    return false;
  }
};

/**
 * 모든 챕터 이벤트 캐시 삭제
 */
export const clearAllChapterEventCaches = (bookId) => {
  try {
    const keys = Object.keys(localStorage);
    const prefix = `${CHAPTER_EVENT_CACHE_PREFIX}${CACHE_VERSION}_${bookId}_`;
    
    let count = 0;
    keys.forEach(key => {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
        count++;
      }
    });
    
    console.log(`🗑️ 책 ${bookId}의 모든 챕터 이벤트 캐시 삭제 (${count}개)`);
    return count;
  } catch (error) {
    console.error('모든 챕터 이벤트 캐시 삭제 실패:', error);
    return 0;
  }
};

