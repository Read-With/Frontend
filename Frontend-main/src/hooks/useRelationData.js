import { useState, useEffect, useCallback, useMemo } from 'react';
import { safeNum, isSamePair } from '../utils/relationUtils';
import { 
  getChapterLastEventNums, 
  getEventDataByIndex,
  getMaxEventCount,
  getDetectedMaxChapter,
  getFolderKeyFromFilename
} from '../utils/graphData';
import { getFineGraph } from '../utils/api/graphApi';

const MIN_POSITIVITY = 1;

function findRelation(relations, id1, id2) {
  if (!Array.isArray(relations) || relations.length === 0) return null;
  
  return relations
    .filter(r => {
      if (!r) return false;
      const rid1 = safeNum(r.id1 ?? r.source);
      const rid2 = safeNum(r.id2 ?? r.target);
      return rid1 !== 0 && rid2 !== 0 && rid1 !== rid2;
    })
    .find(r => isSamePair(r, id1, id2));
}

/**
 * 제한된 최대 이벤트 수를 계산하는 함수
 * @param {string} folderKey - 폴더 키
 * @param {number} maxChapter - 최대 챕터 수
 * @returns {number} 최대 이벤트 수
 */
function getMaxEventCountLimited(folderKey, maxChapter) {
  if (!folderKey) return MIN_POSITIVITY;
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    const lastEventNums = getChapterLastEventNums(folderKey);
    
    if (!Array.isArray(lastEventNums) || lastEventNums.length === 0) {
      return MIN_POSITIVITY;
    }
    
    if (actualMaxChapter >= lastEventNums.length) {
      return Math.max(getMaxEventCount(folderKey), MIN_POSITIVITY);
    }
    
    const limitedEventNums = lastEventNums.slice(0, actualMaxChapter);
    return Math.max(...limitedEventNums, MIN_POSITIVITY);
  } catch (error) {
    return MIN_POSITIVITY;
  }
}

/**
 * 공통 데이터 수집 함수
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} startChapter - 시작 챕터
 * @param {number} endChapter - 끝 챕터
 * @param {number} startEvent - 시작 이벤트
 * @param {number} endEvent - 끝 이벤트
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 포인트와 라벨 정보
 */
function collectRelationData(id1, id2, startChapter, endChapter, startEvent, endEvent, folderKey) {
  if (!folderKey || startChapter > endChapter || startEvent > endEvent) {
    return { points: [], labelInfo: [] };
  }
  
  const points = [];
  const labelInfo = [];
  
  try {
    const lastEventNums = getChapterLastEventNums(folderKey);
    
    for (let ch = startChapter; ch <= endChapter; ch++) {
      const lastEv = ch === endChapter ? endEvent : (lastEventNums[ch - 1] || 0);
      const startEv = ch === startChapter ? startEvent : 1;
      
      for (let i = startEv; i <= lastEv; i++) {
        const json = getEventDataByIndex(folderKey, ch, i);
        
        if (!json) {
          points.push(0);
          labelInfo.push(`챕터${ch} 이벤트${i}`);
          continue;
        }
        
        const found = findRelation(json.relations, id1, id2);
        points.push(found ? found.positivity : 0);
        labelInfo.push(`E${i}`);
      }
    }
  } catch (error) {
  }
  
  return { points, labelInfo };
}

/**
 * 처음 등장 시점 찾기 함수
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} maxChapter - 최대 챕터 수
 * @param {string} folderKey - 폴더 키
 * @returns {Object|null} 첫 등장 정보 또는 null
 */
function findFirstAppearance(id1, id2, maxChapter, folderKey) {
  if (!folderKey || maxChapter < 1) return null;
  
  try {
    const lastEventNums = getChapterLastEventNums(folderKey);
    
    for (let ch = 1; ch <= maxChapter; ch++) {
      const lastEv = lastEventNums[ch - 1] || 0;
      for (let i = 1; i <= lastEv; i++) {
        const json = getEventDataByIndex(folderKey, ch, i);
        if (!json) continue;
        
        const found = findRelation(json.relations, id1, id2);
        if (found) {
          return { chapter: ch, event: i };
        }
      }
    }
  } catch (error) {
  }
  
  return null;
}

/**
 * 독립 실행 모드용 관계 타임라인 데이터 가져오기
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호
 * @param {number} maxChapter - 최대 챕터 수
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 타임라인 데이터
 */
function fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey) {
  if (!folderKey || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    // 처음 등장한 시점 찾기
    const firstAppearance = findFirstAppearance(id1, id2, Math.min(chapterNum, actualMaxChapter), folderKey);
    
    if (!firstAppearance) {
      return { points: [], labelInfo: [] };
    }
    
    // 처음 등장한 시점부터 현재 이벤트까지 데이터 수집
    return collectRelationData(
      id1, id2, 
      firstAppearance.chapter, chapterNum, 
      firstAppearance.event, eventNum, 
      folderKey
    );
  } catch (error) {
    return { points: [], labelInfo: [] };
  }
}

/**
 * 그래프 온리 페이지용 누적 모드 관계 타임라인 데이터 가져오기 (로컬 데이터)
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} selectedChapter - 선택된 챕터 번호
 * @param {number} maxChapter - 최대 챕터 수
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 타임라인 데이터
 */
function fetchRelationTimelineCumulative(id1, id2, selectedChapter, maxChapter, folderKey) {
  if (!folderKey || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    // 처음 등장한 시점 찾기 (전체 범위에서)
    const firstAppearance = findFirstAppearance(id1, id2, actualMaxChapter, folderKey);
    
    if (!firstAppearance) {
      return { points: [], labelInfo: [] };
    }

    const lastEventNums = getChapterLastEventNums(folderKey);
    
    if (selectedChapter === firstAppearance.chapter) {
      // 첫 등장 챕터인 경우: 등장 시점부터 챕터 마지막까지
      const lastEvent = lastEventNums[selectedChapter - 1] || 0;
      return collectRelationData(
        id1, id2,
        selectedChapter, selectedChapter,
        firstAppearance.event, lastEvent,
        folderKey
      );
    } else if (selectedChapter > firstAppearance.chapter) {
      // 이후 챕터인 경우: 처음 등장 챕터부터 이전 챕터까지의 모든 마지막 이벤트 정보 + 현재 챕터 전체
      const currentLastEvent = lastEventNums[selectedChapter - 1] || 0;
      
      // 처음 등장 챕터부터 이전 챕터까지의 모든 마지막 이벤트 데이터 수집
      const allPrevChaptersData = { points: [], labelInfo: [] };
      
      for (let ch = firstAppearance.chapter; ch < selectedChapter; ch++) {
        const chapterLastEvent = lastEventNums[ch - 1] || 0;
        
        // 각 챕터의 마지막 이벤트 데이터만 가져오기
        const chapterData = collectRelationData(
          id1, id2,
          ch, ch,
          chapterLastEvent, chapterLastEvent,
          folderKey
        );
        
        allPrevChaptersData.points.push(...chapterData.points);
        allPrevChaptersData.labelInfo.push(...chapterData.labelInfo.map(() => `Ch${ch}`));
      }
      
      // 현재 챕터의 전체 데이터
      const currentChapterData = collectRelationData(
        id1, id2,
        selectedChapter, selectedChapter,
        1, currentLastEvent,
        folderKey
      );
      
      // 데이터 병합 (라벨 수정: 이전 챕터들은 Ch표시, 현재 챕터는 E표시)
      return {
        points: [...allPrevChaptersData.points, ...currentChapterData.points],
        labelInfo: [
          ...allPrevChaptersData.labelInfo,  // 이전 챕터들: Ch1, Ch2, Ch3...
          ...currentChapterData.labelInfo    // 현재 챕터는 E1, E2, E3... 형태로 표시
        ]
      };
    } else {
      // 아직 등장하지 않은 챕터인 경우
      return { points: [], labelInfo: [] };
    }
  } catch (error) {
    return { points: [], labelInfo: [] };
  }
}

// 캐시 설정
const CACHE_DURATION = 5 * 60 * 1000; // 5분 (밀리초)
const CACHE_PREFIX = 'relation-timeline-';
const MAX_CACHE_SIZE = 50; // 최대 캐시 항목 수

/**
 * 캐시 키 생성
 */
function getCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

/**
 * sessionStorage에서 캐시 데이터 가져오기
 */
function getCachedData(cacheKey) {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    
    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const data = JSON.parse(cached);
    const cacheTime = data.timestamp;
    const now = Date.now();
    
    // 캐시 만료 시간 체크
    if (now - cacheTime >= CACHE_DURATION) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }
    
    return data.result;
  } catch (error) {
    // JSON 파싱 에러 등 처리
    try {
      sessionStorage.removeItem(cacheKey);
    } catch (e) {
      // 무시
    }
    return null;
  }
}

/**
 * sessionStorage에 캐시 데이터 저장 (메모리 관리 포함)
 */
function setCachedData(cacheKey, result) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    
    // 캐시 크기 관리: 오래된 캐시부터 삭제
    cleanupOldCache();
    
    sessionStorage.setItem(cacheKey, JSON.stringify({
      result,
      timestamp: Date.now()
    }));
  } catch (error) {
    // sessionStorage 용량 초과 등 처리
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      // 캐시 공간 확보를 위해 일부 삭제 후 재시도
      clearOldestCache(10);
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          result,
          timestamp: Date.now()
        }));
      } catch (e) {
        // 재시도 실패 시 무시
      }
    }
  }
}

/**
 * sessionStorage에서 캐시 키 순회 헬퍼 함수
 */
function iterateCacheKeys(callback) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        callback(key);
      }
    }
  } catch (error) {
    // 무시
  }
}

/**
 * 오래된 캐시 정리 (만료된 캐시 삭제)
 */
function cleanupOldCache() {
  try {
    const now = Date.now();
    const keysToRemove = [];
    
    iterateCacheKeys((key) => {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) {
          const data = JSON.parse(cached);
          if (now - data.timestamp >= CACHE_DURATION) {
            keysToRemove.push(key);
          }
        }
      } catch (e) {
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
  } catch (error) {
    // 무시
  }
}

/**
 * 가장 오래된 캐시 삭제 (LRU 방식)
 */
function clearOldestCache(count = 10) {
  try {
    const cacheEntries = [];
    
    iterateCacheKeys((key) => {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) {
          const data = JSON.parse(cached);
          cacheEntries.push({ key, timestamp: data.timestamp });
        }
      } catch (e) {
        // 파싱 실패한 항목은 삭제 대상
        sessionStorage.removeItem(key);
      }
    });
    
    // 타임스탬프 기준으로 정렬 (오래된 것부터)
    cacheEntries.sort((a, b) => a.timestamp - b.timestamp);
    
    // 가장 오래된 항목들 삭제
    cacheEntries.slice(0, Math.min(count, cacheEntries.length)).forEach(entry => {
      sessionStorage.removeItem(entry.key);
    });
  } catch (error) {
    // 무시
  }
}

/**
 * 특정 책/챕터의 관련 캐시 무효화
 */
function invalidateCache(bookId, chapterNum = null) {
  try {
    const keysToRemove = [];
    const keyPattern = chapterNum !== null 
      ? `${CACHE_PREFIX}${bookId}-${chapterNum}-`
      : `${CACHE_PREFIX}${bookId}-`;
    
    iterateCacheKeys((key) => {
      if (key.startsWith(keyPattern)) {
        keysToRemove.push(key);
      }
    });
    
    keysToRemove.forEach(key => sessionStorage.removeItem(key));
  } catch (error) {
    // 무시
  }
}

/**
 * 실제 API 호출 로직 (내부 함수)
 */
async function fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    // 이진 탐색으로 마지막 이벤트 인덱스 찾기 (빠른 탐색)
    let chapterLastEventIdx = null;
    let firstAppearanceEventIdx = null;
    const cachedData = new Map();
    
    // 이진 탐색으로 마지막 이벤트 찾기
    let left = 1;
    let right = 100;
    let lastValidIdx = 0;
    
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      try {
        const searchData = await getFineGraph(bookId, selectedChapter, mid);
        const hasRealData = searchData?.isSuccess && searchData?.result && 
                           (searchData.result.characters || 
                            (searchData.result.relations && searchData.result.relations.length > 0) ||
                            searchData.result.event);
        
        if (hasRealData) {
          lastValidIdx = mid;
          cachedData.set(mid, searchData);
          left = mid + 1; // 더 큰 인덱스 확인
        } else {
          right = mid - 1; // 더 작은 인덱스 확인
        }
      } catch (error) {
        right = mid - 1; // 에러면 더 작은 인덱스 확인
      }
    }
    
    chapterLastEventIdx = lastValidIdx;
    
    // 마지막 이벤트를 찾았으면, 1부터 마지막까지 순회하며 관계 데이터 수집
    if (chapterLastEventIdx > 0) {
      let consecutive404Count = 0;
      const MAX_CONSECUTIVE_404 = 2; // 연속 2번 404면 중단
      
      for (let searchEventIdx = 1; searchEventIdx <= chapterLastEventIdx && consecutive404Count < MAX_CONSECUTIVE_404; searchEventIdx++) {
        try {
          let searchData = cachedData.get(searchEventIdx);
          if (!searchData) {
            searchData = await getFineGraph(bookId, selectedChapter, searchEventIdx);
            cachedData.set(searchEventIdx, searchData);
          }
          
          const hasRealData = searchData?.isSuccess && searchData?.result && 
                             (searchData.result.characters || 
                              (searchData.result.relations && searchData.result.relations.length > 0) ||
                              searchData.result.event);
          
          if (hasRealData) {
            consecutive404Count = 0; // 데이터가 있으면 카운터 리셋
            
            // 관계가 처음 등장한 이벤트 찾기
            if (firstAppearanceEventIdx === null && searchData?.result?.relations && searchData.result.relations.length > 0) {
              const relation = searchData.result.relations.find(rel => 
                isSamePair(rel, id1, id2)
              );
              if (relation) {
                firstAppearanceEventIdx = searchEventIdx;
              }
            }
          } else {
            consecutive404Count++;
            if (consecutive404Count >= MAX_CONSECUTIVE_404) {
              break; // 연속 404면 중단
            }
          }
        } catch (error) {
          consecutive404Count++;
          if (consecutive404Count >= MAX_CONSECUTIVE_404) {
            break;
          }
        }
      }
    }
    
    if (chapterLastEventIdx === null) {
      // 챕터에 이벤트가 없음
      return { points: [], labelInfo: [] };
    }
    
    // 관계가 전혀 등장하지 않은 경우
    if (firstAppearanceEventIdx === null) {
      return { points: [], labelInfo: [] };
    }
    
    const allPrevChaptersData = { points: [], labelInfo: [] };
    
    // 이전 챕터들의 마지막 이벤트 데이터 수집
    // 최적화: 각 챕터마다 마지막 이벤트를 찾는 대신, 큰 eventIdx로 한 번에 확인
    for (let ch = 1; ch < selectedChapter; ch++) {
      try {
        // 챕터의 마지막 이벤트를 찾기 시도
        // 이벤트는 연속적으로 존재하므로, 큰 숫자부터 역순으로 확인하다가
        // 첫 번째로 실제 데이터가 있는 이벤트를 찾으면 그것이 마지막 이벤트
        let lastEventInChapter = null;
        let lastEventData = null; // 이미 조회한 데이터 저장
        
        // 큰 숫자부터 역순으로 확인 (빠른 탐색)
        // 이벤트는 연속적으로 존재하므로, 한 번 404가 나오면 그 이후는 모두 없음
        let foundFirstValid = false;
        let prevChapter404Count = 0;
        const MAX_PREV_CHAPTER_404 = 3;
        
        for (let testIdx = 50; testIdx >= 1 && !foundFirstValid && prevChapter404Count < MAX_PREV_CHAPTER_404; testIdx--) {
          try {
            const fineData = await getFineGraph(bookId, ch, testIdx);
            
            // isSuccess가 true이고 실제 데이터가 있는지 확인
            // getFineGraph는 404일 때도 isSuccess: true를 반환하지만, result가 비어있음
            if (fineData?.isSuccess && fineData?.result) {
              // 실제 이벤트 데이터가 있는지 확인 (404가 아닌 경우)
              // 404일 때는 result.relations가 빈 배열이지만, 다른 필드도 체크
              const hasRealData = fineData.result.characters || 
                                  (fineData.result.relations && fineData.result.relations.length > 0) ||
                                  fineData.result.event;
              
              if (hasRealData) {
                // 첫 번째로 찾은 유효한 데이터가 마지막 이벤트 (이벤트는 연속적이므로)
                lastEventInChapter = testIdx;
                lastEventData = fineData;
                foundFirstValid = true;
                prevChapter404Count = 0; // 리셋
              } else {
                // 404인 경우 카운터 증가
                prevChapter404Count++;
              }
            } else {
              prevChapter404Count++;
            }
          } catch (error) {
            // 에러 발생 시 카운터 증가
            prevChapter404Count++;
          }
        }
        
        // 마지막 이벤트가 있으면 해당 이벤트의 관계 데이터 확인
        // 최적화: 이미 조회한 데이터 재사용 (중복 API 호출 방지)
        if (lastEventInChapter !== null && lastEventData) {
          if (lastEventData?.isSuccess && lastEventData?.result?.relations) {
            const relation = lastEventData.result.relations.find(rel => 
              isSamePair(rel, id1, id2)
            );
            
            // relation 객체가 있을 때만 표시 (positivity=0도 관계가 있는 것이므로 포함)
            if (relation) {
              allPrevChaptersData.points.push(relation.positivity || 0);
              allPrevChaptersData.labelInfo.push(`Ch${ch}`);
            }
          }
        }
      } catch (error) {
        // 에러 무시 (데이터 없는 챕터는 표시하지 않음)
      }
    }
    
    // 현재 챕터의 데이터 수집: 관계가 처음 등장한 이벤트부터 챕터의 마지막 이벤트까지
    // 최적화: 캐시된 데이터를 우선 사용하여 불필요한 API 호출 방지
    const currentChapterData = { points: [], labelInfo: [] };
    
    if (firstAppearanceEventIdx !== null && chapterLastEventIdx !== null) {
      // 관계가 처음 등장한 이벤트부터 챕터의 마지막 이벤트까지 범위에서
      // 관계가 실제로 있는 이벤트만 수집
      for (let eventIdx = firstAppearanceEventIdx; eventIdx <= chapterLastEventIdx; eventIdx++) {
        try {
          // 캐시된 데이터가 있으면 재사용, 없으면 API 호출
          let fineData = cachedData.get(eventIdx);
          
          if (!fineData) {
            fineData = await getFineGraph(bookId, selectedChapter, eventIdx);
          }
          
          // getFineGraph는 404 에러 시 빈 데이터를 반환하므로 isSuccess 체크 필요
          if (fineData?.isSuccess && fineData?.result?.relations && fineData.result.relations.length > 0) {
            const relation = fineData.result.relations.find(rel => 
              isSamePair(rel, id1, id2)
            );
            
            // relation 객체가 있을 때만 표시 (positivity=0도 관계가 있는 것이므로 포함)
            if (relation) {
              currentChapterData.points.push(relation.positivity || 0);
              currentChapterData.labelInfo.push(`E${eventIdx}`);
            }
            // 관계가 없는 이벤트는 무시 (해당 이벤트에서 이 두 인물 간 관계가 없음)
          }
          // 빈 데이터는 무시하고 계속 진행 (chapterLastEventIdx 범위 내이므로)
        } catch (error) {
          // chapterLastEventIdx 범위 내이므로 에러가 발생하면 해당 이벤트만 건너뜀
        }
      }
      
    }
    
    // 데이터 병합
    const mergedResult = {
      points: [...allPrevChaptersData.points, ...currentChapterData.points],
      labelInfo: [...allPrevChaptersData.labelInfo, ...currentChapterData.labelInfo]
    };
    
    return mergedResult;
  } catch (error) {
    console.error('API 누적 관계 타임라인 조회 실패:', error);
    return { points: [], labelInfo: [] };
  }
}

/**
 * API 책용 누적 모드 관계 타임라인 데이터 가져오기 (하이브리드 방식)
 * sessionStorage 캐싱 + API 호출
 * @param {number} bookId - 책 ID
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} selectedChapter - 선택된 챕터 번호
 * @returns {Promise<Object>} 타임라인 데이터
 */
async function fetchApiRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }
  
  // 캐시 키 생성
  const cacheKey = getCacheKey(bookId, selectedChapter, id1, id2);
  
  // 1. 캐시 확인
  const cachedResult = getCachedData(cacheKey);
  if (cachedResult) {
    // 개발 환경에서만 간단한 로그 출력
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ [캐시 히트] 챕터 ${selectedChapter} 간선 (${id1}-${id2})`);
    }
    return cachedResult;
  }
  
  // 2. 캐시가 없거나 만료된 경우 API 호출
  if (process.env.NODE_ENV === 'development') {
    console.log(`🌐 [API 호출] 챕터 ${selectedChapter} 간선 (${id1}-${id2})`);
  }
  
  try {
    const result = await fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter);
    
    // 3. API 결과를 캐시에 저장
    if (process.env.NODE_ENV === 'development') {
      console.log(`💾 [캐시 저장] 챕터 ${selectedChapter} 간선 (${id1}-${id2})`);
    }
    setCachedData(cacheKey, result);
    
    return result;
  } catch (error) {
    console.error('API 누적 관계 타임라인 조회 실패:', error);
    
    // 에러 발생 시에도 만료된 캐시가 있으면 사용 (선택적)
    // 주의: 오래된 데이터일 수 있으므로 주석 처리
    // const expiredCache = getCachedData(cacheKey, true); // 만료된 것도 허용
    // if (expiredCache) return expiredCache;
    
    return { points: [], labelInfo: [] };
  }
}

/**
 * 뷰어 모드용 관계 타임라인 데이터 가져오기 (관계가 처음 등장하는 이벤트부터 현재 이벤트까지)
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호
 * @param {string} folderKey - 폴더 키
 * @returns {Object} 타임라인 데이터
 */
function fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey) {
  if (!folderKey || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [], noRelation: true };
  }
  
  try {
    // 현재 챕터에서 관계가 처음 등장하는 이벤트 찾기
    let firstAppearanceInChapter = null;
    
    for (let i = 1; i <= eventNum; i++) {
      const json = getEventDataByIndex(folderKey, chapterNum, i);
      if (!json) continue;
      
      const found = findRelation(json.relations, id1, id2);
      if (found) {
        firstAppearanceInChapter = i;
        break; // 첫 번째 등장을 찾으면 중단
      }
    }
    
    // 관계가 현재 챕터에서 전혀 등장하지 않은 경우
    if (!firstAppearanceInChapter) {
      return { points: [], labelInfo: [], noRelation: true };
    }
    
    // 관계가 처음 등장한 이벤트부터 현재 이벤트까지 데이터 수집
    const result = collectRelationData(
      id1, id2, 
      chapterNum, chapterNum, 
      firstAppearanceInChapter, eventNum, // 관계 첫 등장부터 현재 이벤트까지
      folderKey
    );
    
    return {
      points: result.points,
      labelInfo: result.labelInfo,
      noRelation: false
    };
  } catch (error) {
    return { points: [], labelInfo: [], noRelation: true };
  }
}

/**
 * 단일 이벤트 패딩 함수
 * @param {Array} points - 포인트 배열
 * @param {Array} labels - 라벨 배열
 * @returns {Object} 패딩된 데이터
 */
function padSingleEvent(points, labels) {
  if (!Array.isArray(points) || !Array.isArray(labels) || points.length !== 1) {
    return { points, labels };
  }
  
  const paddedLabels = Array(11).fill('').map((_, index) => 
    index === 5 ? labels[0] : ''
  );
  const paddedTimeline = Array(11).fill(null).map((_, index) => 
    index === 5 ? points[0] : null
  );
  
  return { points: paddedTimeline, labels: paddedLabels };
}

/**
 * 간선 관계 데이터를 가져오는 커스텀 훅
 * @param {string} mode - 'standalone' | 'viewer' | 'cumulative'
 * @param {number} id1 - 첫 번째 노드 ID
 * @param {number} id2 - 두 번째 노드 ID
 * @param {number} chapterNum - 현재 챕터 번호
 * @param {number} eventNum - 현재 이벤트 번호 (cumulative 모드에서는 사용하지 않음)
 * @param {number} maxChapter - 최대 챕터 수 (standalone, cumulative 모드에서 사용)
 * @param {string} filename - 파일명 (예: "gatsby.epub", "alice.epub")
 * @param {number} bookId - API 책 ID (API 책인 경우)
 * @returns {object} 차트 데이터와 로딩 상태
 */
export function useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter, filename, bookId = null) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);

  // API 책 여부 판단
  const isApiBook = useMemo(() => {
    return !!bookId;
  }, [bookId]);

  // filename을 기반으로 folderKey 결정 (로컬 책인 경우에만)
  const folderKey = useMemo(() => {
    if (isApiBook) return null;
    try {
      return getFolderKeyFromFilename(filename);
    } catch (error) {
      return null;
    }
  }, [filename, isApiBook]);

  // 메모이제이션된 최대 이벤트 수
  // API 책인 경우 timeline/labels의 길이를 사용, 로컬 책인 경우 기존 로직 사용
  const maxEventCount = useMemo(() => {
    if (isApiBook) {
      // API 책인 경우: timeline 또는 labels의 길이 사용 (데이터가 로드되면)
      // 데이터가 없으면 기본값 1 반환
      return Math.max(timeline?.length || labels?.length || 1, 1);
    }
    // 로컬 책인 경우: 기존 로직 사용
    return getMaxEventCountLimited(folderKey, maxChapter);
  }, [isApiBook, folderKey, maxChapter, timeline, labels]);

  // 데이터 가져오기 함수
  const fetchData = useCallback(async () => {
    // API 책인 경우
    if (isApiBook) {
      if (!bookId || !id1 || !id2 || !chapterNum) {
        setTimeline([]);
        setLabels([]);
        setNoRelation(true);
        setError('필수 매개변수가 누락되었습니다.');
        return;
      }

      setLoading(true);
      setError(null);
      
      try {
        let result;
        
        if (mode === 'cumulative') {
          result = await fetchApiRelationTimelineCumulative(bookId, id1, id2, chapterNum);
        } else {
          // viewer, standalone 모드는 아직 API 지원 안 함
          result = { points: [], labelInfo: [], noRelation: true };
        }
        
        const { points, labels } = padSingleEvent(result.points, result.labelInfo);
        
        setTimeline(points);
        setLabels(labels);
        setNoRelation(result.noRelation || false);
      } catch (error) {
        console.error('API 관계 데이터 조회 실패:', error);
        setError('데이터를 가져오는 중 오류가 발생했습니다.');
        setTimeline([]);
        setLabels([]);
        setNoRelation(true);
      } finally {
        setLoading(false);
      }
      return;
    }

    // 로컬 책인 경우
    if (!folderKey || !id1 || !id2 || !chapterNum || !eventNum) {
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
      setError('필수 매개변수가 누락되었습니다.');
      return;
    }

    setLoading(true);
    setError(null);
    
    try {
      let result;
      
      if (mode === 'viewer') {
        result = fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey);
      } else if (mode === 'cumulative') {
        result = fetchRelationTimelineCumulative(id1, id2, chapterNum, maxChapter, folderKey);
      } else {
        result = fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey);
      }
      
      const { points, labels } = padSingleEvent(result.points, result.labelInfo);
      
      setTimeline(points);
      setLabels(labels);
      setNoRelation(result.noRelation || false);
    } catch (error) {
      setError('데이터를 가져오는 중 오류가 발생했습니다.');
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
    } finally {
      setLoading(false);
    }
  }, [mode, id1, id2, chapterNum, eventNum, maxChapter, folderKey, isApiBook, bookId]);

  // 의존성이 변경될 때 자동으로 데이터 가져오기
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 메모이제이션된 반환값으로 불필요한 리렌더링 방지
  return useMemo(() => ({
    timeline,
    labels,
    loading,
    noRelation,
    error,
    fetchData,
    getMaxEventCount: () => maxEventCount,
  }), [timeline, labels, loading, noRelation, error, fetchData, maxEventCount]);
}

// 캐시 무효화 함수 export (필요시 사용)
export function clearRelationTimelineCache(bookId, chapterNum = null) {
  invalidateCache(bookId, chapterNum);
}
