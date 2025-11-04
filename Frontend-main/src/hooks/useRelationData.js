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

function fetchRelationTimelineStandalone(id1, id2, chapterNum, eventNum, maxChapter, folderKey) {
  if (!folderKey || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    const firstAppearance = findFirstAppearance(id1, id2, Math.min(chapterNum, actualMaxChapter), folderKey);
    
    if (!firstAppearance) {
      return { points: [], labelInfo: [] };
    }
    
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

function fetchRelationTimelineCumulative(id1, id2, selectedChapter, maxChapter, folderKey) {
  if (!folderKey || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    const detectedMaxChapter = getDetectedMaxChapter(folderKey);
    const actualMaxChapter = maxChapter || detectedMaxChapter;
    
    const firstAppearance = findFirstAppearance(id1, id2, actualMaxChapter, folderKey);
    
    if (!firstAppearance) {
      return { points: [], labelInfo: [] };
    }

    const lastEventNums = getChapterLastEventNums(folderKey);
    
    if (selectedChapter === firstAppearance.chapter) {
      const lastEvent = lastEventNums[selectedChapter - 1] || 0;
      return collectRelationData(
        id1, id2,
        selectedChapter, selectedChapter,
        firstAppearance.event, lastEvent,
        folderKey
      );
    } else if (selectedChapter > firstAppearance.chapter) {
      const currentLastEvent = lastEventNums[selectedChapter - 1] || 0;
      
      const allPrevChaptersData = { points: [], labelInfo: [] };
      
      for (let ch = firstAppearance.chapter; ch < selectedChapter; ch++) {
        const chapterLastEvent = lastEventNums[ch - 1] || 0;
        
        const chapterData = collectRelationData(
          id1, id2,
          ch, ch,
          chapterLastEvent, chapterLastEvent,
          folderKey
        );
        
        allPrevChaptersData.points.push(...chapterData.points);
        allPrevChaptersData.labelInfo.push(...chapterData.labelInfo.map(() => `Ch${ch}`));
      }
      
      const currentChapterData = collectRelationData(
        id1, id2,
        selectedChapter, selectedChapter,
        1, currentLastEvent,
        folderKey
      );
      
      return {
        points: [...allPrevChaptersData.points, ...currentChapterData.points],
        labelInfo: [
          ...allPrevChaptersData.labelInfo,
          ...currentChapterData.labelInfo
        ]
      };
    } else {
      return { points: [], labelInfo: [] };
    }
  } catch (error) {
    return { points: [], labelInfo: [] };
  }
}

const CACHE_DURATION = 5 * 60 * 1000;
const CACHE_PREFIX = 'relation-timeline-';
const MAX_CACHE_SIZE = 50;

function getCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

function getCachedData(cacheKey) {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    
    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return null;
    
    const data = JSON.parse(cached);
    const cacheTime = data.timestamp;
    const now = Date.now();
    
    if (now - cacheTime >= CACHE_DURATION) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }
    
    return data.result;
  } catch (error) {
    try {
      sessionStorage.removeItem(cacheKey);
    } catch (e) {
    }
    return null;
  }
}

function setCachedData(cacheKey, result) {
  try {
    if (typeof sessionStorage === 'undefined') return;
    
    cleanupOldCache();
    
    sessionStorage.setItem(cacheKey, JSON.stringify({
      result,
      timestamp: Date.now()
    }));
  } catch (error) {
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      clearOldestCache(10);
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({
          result,
          timestamp: Date.now()
        }));
      } catch (e) {
      }
    }
  }
}

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
  }
}

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
  }
}

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
        sessionStorage.removeItem(key);
      }
    });
    
    cacheEntries.sort((a, b) => a.timestamp - b.timestamp);
    
    cacheEntries.slice(0, Math.min(count, cacheEntries.length)).forEach(entry => {
      sessionStorage.removeItem(entry.key);
    });
  } catch (error) {
  }
}

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
  }
}

async function fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }
  
  try {
    let chapterLastEventIdx = null;
    let firstAppearanceEventIdx = null;
    const cachedData = new Map();
    
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
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      } catch (error) {
        right = mid - 1;
      }
    }
    
    chapterLastEventIdx = lastValidIdx;
    
    if (chapterLastEventIdx > 0) {
      let consecutive404Count = 0;
      const MAX_CONSECUTIVE_404 = 2;
      
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
            consecutive404Count = 0;
            
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
              break;
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
      return { points: [], labelInfo: [] };
    }
    
    if (firstAppearanceEventIdx === null) {
      return { points: [], labelInfo: [] };
    }
    
    const allPrevChaptersData = { points: [], labelInfo: [] };
    
    for (let ch = 1; ch < selectedChapter; ch++) {
      try {
        let lastEventInChapter = null;
        let lastEventData = null;
        
        let foundFirstValid = false;
        let prevChapter404Count = 0;
        const MAX_PREV_CHAPTER_404 = 3;
        
        for (let testIdx = 50; testIdx >= 1 && !foundFirstValid && prevChapter404Count < MAX_PREV_CHAPTER_404; testIdx--) {
          try {
            const fineData = await getFineGraph(bookId, ch, testIdx);
            
            if (fineData?.isSuccess && fineData?.result) {
              const hasRealData = fineData.result.characters || 
                                  (fineData.result.relations && fineData.result.relations.length > 0) ||
                                  fineData.result.event;
              
              if (hasRealData) {
                lastEventInChapter = testIdx;
                lastEventData = fineData;
                foundFirstValid = true;
                prevChapter404Count = 0;
              } else {
                prevChapter404Count++;
              }
            } else {
              prevChapter404Count++;
            }
          } catch (error) {
            prevChapter404Count++;
          }
        }
        
        if (lastEventInChapter !== null && lastEventData) {
          if (lastEventData?.isSuccess && lastEventData?.result?.relations) {
            const relation = lastEventData.result.relations.find(rel => 
              isSamePair(rel, id1, id2)
            );
            
            if (relation) {
              allPrevChaptersData.points.push(relation.positivity || 0);
              allPrevChaptersData.labelInfo.push(`Ch${ch}`);
            }
          }
        }
      } catch (error) {
      }
    }
    
    const currentChapterData = { points: [], labelInfo: [] };
    
    if (firstAppearanceEventIdx !== null && chapterLastEventIdx !== null) {
      for (let eventIdx = firstAppearanceEventIdx; eventIdx <= chapterLastEventIdx; eventIdx++) {
        try {
          let fineData = cachedData.get(eventIdx);
          
          if (!fineData) {
            fineData = await getFineGraph(bookId, selectedChapter, eventIdx);
          }
          
          if (fineData?.isSuccess && fineData?.result?.relations && fineData.result.relations.length > 0) {
            const relation = fineData.result.relations.find(rel => 
              isSamePair(rel, id1, id2)
            );
            
            if (relation) {
              currentChapterData.points.push(relation.positivity || 0);
              currentChapterData.labelInfo.push(`E${eventIdx}`);
            }
          }
        } catch (error) {
        }
      }
      
    }
    
    const mergedResult = {
      points: [...allPrevChaptersData.points, ...currentChapterData.points],
      labelInfo: [...allPrevChaptersData.labelInfo, ...currentChapterData.labelInfo]
    };
    
    return mergedResult;
  } catch (error) {
    return { points: [], labelInfo: [] };
  }
}

async function fetchApiRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }
  
  const cacheKey = getCacheKey(bookId, selectedChapter, id1, id2);
  
  const cachedResult = getCachedData(cacheKey);
  if (cachedResult) {
    return cachedResult;
  }
  
  try {
    const result = await fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter);
    
    setCachedData(cacheKey, result);
    
    return result;
  } catch (error) {
    return { points: [], labelInfo: [] };
  }
}

function fetchRelationTimelineViewer(id1, id2, chapterNum, eventNum, folderKey) {
  if (!folderKey || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [], noRelation: true };
  }
  
  try {
    let firstAppearanceInChapter = null;
    
    for (let i = 1; i <= eventNum; i++) {
      const json = getEventDataByIndex(folderKey, chapterNum, i);
      if (!json) continue;
      
      const found = findRelation(json.relations, id1, id2);
      if (found) {
        firstAppearanceInChapter = i;
        break;
      }
    }
    
    if (!firstAppearanceInChapter) {
      return { points: [], labelInfo: [], noRelation: true };
    }
    
    const result = collectRelationData(
      id1, id2, 
      chapterNum, chapterNum, 
      firstAppearanceInChapter, eventNum,
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

export function useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter, filename, bookId = null) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);

  const isApiBook = useMemo(() => {
    return !!bookId;
  }, [bookId]);

  const folderKey = useMemo(() => {
    if (isApiBook) return null;
    try {
      return getFolderKeyFromFilename(filename);
    } catch (error) {
      return null;
    }
  }, [filename, isApiBook]);

  const maxEventCount = useMemo(() => {
    if (isApiBook) {
      return Math.max(timeline?.length || labels?.length || 1, 1);
    }
    return getMaxEventCountLimited(folderKey, maxChapter);
  }, [isApiBook, folderKey, maxChapter, timeline, labels]);

  const fetchData = useCallback(async () => {
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
          result = { points: [], labelInfo: [], noRelation: true };
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
      return;
    }

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

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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

export function clearRelationTimelineCache(bookId, chapterNum = null) {
  invalidateCache(bookId, chapterNum);
}
