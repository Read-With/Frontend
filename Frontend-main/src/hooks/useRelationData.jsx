import { useState, useEffect, useCallback, useMemo } from 'react';
import { isSamePair } from '../utils/relationUtils';
import { getFineGraph } from '../utils/api/graphApi';

const CACHE_DURATION = 5 * 60 * 1000;
const CACHE_PREFIX = 'relation-timeline-';
const MAX_CACHE_SIZE = 50;

const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

function getCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

function iterateCacheKeys(callback) {
  try {
    if (typeof sessionStorage === 'undefined') return;

    for (let i = 0; i < sessionStorage.length; i += 1) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(CACHE_PREFIX)) {
        callback(key);
      }
    }
  } catch (error) {
    // ignore storage errors
  }
}

function cleanupOldCache() {
  try {
    if (typeof sessionStorage === 'undefined') return;

    const now = Date.now();
    const keysToRemove = [];

    iterateCacheKeys((key) => {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) {
          const data = JSON.parse(cached);
          if (now - (data.timestamp || 0) >= CACHE_DURATION) {
            keysToRemove.push(key);
          }
        }
      } catch (error) {
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach((key) => sessionStorage.removeItem(key));
  } catch (error) {
    // ignore storage errors
  }
}

function clearOldestCache(count = 10) {
  try {
    if (typeof sessionStorage === 'undefined') return;

    const cacheEntries = [];
    iterateCacheKeys((key) => {
      try {
        const cached = sessionStorage.getItem(key);
        if (cached) {
          const data = JSON.parse(cached);
          cacheEntries.push({ key, timestamp: data.timestamp || 0 });
        }
      } catch (error) {
        sessionStorage.removeItem(key);
      }
    });

    cacheEntries
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(0, Math.min(count, cacheEntries.length))
      .forEach((entry) => sessionStorage.removeItem(entry.key));
  } catch (error) {
    // ignore storage errors
  }
}

function getCachedData(cacheKey) {
  try {
    if (typeof sessionStorage === 'undefined') return null;

    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return null;

    const data = JSON.parse(cached);
    if (Date.now() - (data.timestamp || 0) >= CACHE_DURATION) {
      sessionStorage.removeItem(cacheKey);
      return null;
    }

    return data.result;
  } catch (error) {
    try {
      sessionStorage.removeItem(cacheKey);
    } catch (e) {
      // ignore storage errors
    }
    return null;
  }
}

function setCachedData(cacheKey, result) {
  try {
    if (typeof sessionStorage === 'undefined') return;

    cleanupOldCache();
    sessionStorage.setItem(
      cacheKey,
      JSON.stringify({
        result,
        timestamp: Date.now(),
      })
    );
  } catch (error) {
    if (error?.name === 'QuotaExceededError' || error?.code === 22) {
      clearOldestCache(10);
      try {
        sessionStorage.setItem(
          cacheKey,
          JSON.stringify({
            result,
            timestamp: Date.now(),
          })
        );
      } catch (e) {
        // ignore storage errors
      }
    }
  }
}

function invalidateCache(bookId, chapterNum = null) {
  try {
    const keyPattern =
      chapterNum !== null
        ? `${CACHE_PREFIX}${bookId}-${chapterNum}-`
        : `${CACHE_PREFIX}${bookId}-`;

    iterateCacheKeys((key) => {
      if (key.startsWith(keyPattern)) {
        sessionStorage.removeItem(key);
      }
    });
  } catch (error) {
    // ignore storage errors
  }
}

function padSingleEvent(points, labels) {
  if (!Array.isArray(points) || !Array.isArray(labels) || points.length !== 1) {
    return { points, labels };
  }

  const paddedLabels = Array(11)
    .fill('')
    .map((_, index) => (index === 5 ? labels[0] : ''));
  const paddedTimeline = Array(11)
    .fill(null)
    .map((_, index) => (index === 5 ? points[0] : null));

  return { points: paddedTimeline, labels: paddedLabels };
}

async function fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }

  try {
    let chapterLastEventIdx = 0;
    let firstAppearanceEventIdx = null;
    const cachedData = new Map();

    let left = 1;
    let right = 100;

    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      try {
        const searchData = await getFineGraph(bookId, selectedChapter, mid);
        const hasRealData =
          searchData?.isSuccess &&
          searchData?.result &&
          (searchData.result.characters ||
            (searchData.result.relations && searchData.result.relations.length > 0) ||
            searchData.result.event);

        if (hasRealData) {
          chapterLastEventIdx = mid;
          cachedData.set(mid, searchData);
          left = mid + 1;
        } else {
          right = mid - 1;
        }
      } catch (error) {
        right = mid - 1;
      }
    }

    if (chapterLastEventIdx > 0) {
      let consecutiveEmptyCount = 0;
      const MAX_CONSECUTIVE_EMPTY = 2;

      for (let idx = 1; idx <= chapterLastEventIdx && consecutiveEmptyCount < MAX_CONSECUTIVE_EMPTY; idx += 1) {
        try {
          let searchData = cachedData.get(idx);
          if (!searchData) {
            searchData = await getFineGraph(bookId, selectedChapter, idx);
            cachedData.set(idx, searchData);
          }

          const hasRealData =
            searchData?.isSuccess &&
            searchData?.result &&
            (searchData.result.characters ||
              (searchData.result.relations && searchData.result.relations.length > 0) ||
              searchData.result.event);

          if (hasRealData) {
            consecutiveEmptyCount = 0;

            if (
              firstAppearanceEventIdx === null &&
              searchData?.result?.relations &&
              searchData.result.relations.length > 0
            ) {
              const relation = searchData.result.relations.find((rel) => isSamePair(rel, id1, id2));
              if (relation) {
                firstAppearanceEventIdx = idx;
              }
            }
          } else {
            consecutiveEmptyCount += 1;
          }
        } catch (error) {
          consecutiveEmptyCount += 1;
        }
      }
    }

    if (chapterLastEventIdx === 0 || firstAppearanceEventIdx === null) {
      return { points: [], labelInfo: [] };
    }

    const allPrevChapters = { points: [], labelInfo: [] };

    for (let chapter = 1; chapter < selectedChapter; chapter += 1) {
      try {
        let lastEventIdx = 0;
        let lastEventData = null;

        for (let testIdx = 50; testIdx >= 1 && lastEventIdx === 0; testIdx -= 1) {
          try {
            const fineData = await getFineGraph(bookId, chapter, testIdx);
            const hasRealData =
              fineData?.isSuccess &&
              fineData?.result &&
              (fineData.result.characters ||
                (fineData.result.relations && fineData.result.relations.length > 0) ||
                fineData.result.event);

            if (hasRealData) {
              lastEventIdx = testIdx;
              lastEventData = fineData;
            }
          } catch (error) {
            // ignore per-event errors
          }
        }

        if (lastEventIdx > 0 && lastEventData?.result?.relations) {
          const relation = lastEventData.result.relations.find((rel) => isSamePair(rel, id1, id2));
          if (relation) {
            allPrevChapters.points.push(relation.positivity || 0);
            allPrevChapters.labelInfo.push(`Ch${chapter}`);
          }
        }
      } catch (error) {
        // ignore per-chapter errors
      }
    }

    const currentChapterData = { points: [], labelInfo: [] };

    for (let idx = firstAppearanceEventIdx; idx <= chapterLastEventIdx; idx += 1) {
      try {
        let fineData = cachedData.get(idx);
        if (!fineData) {
          fineData = await getFineGraph(bookId, selectedChapter, idx);
        }

        if (fineData?.result?.relations?.length) {
          const relation = fineData.result.relations.find((rel) => isSamePair(rel, id1, id2));
          if (relation) {
            currentChapterData.points.push(relation.positivity || 0);
            currentChapterData.labelInfo.push(`E${idx}`);
          }
        }
      } catch (error) {
        // ignore per-event errors
      }
    }

    return {
      points: [...allPrevChapters.points, ...currentChapterData.points],
      labelInfo: [...allPrevChapters.labelInfo, ...currentChapterData.labelInfo],
    };
  } catch (error) {
    return { points: [], labelInfo: [] };
  }
}

async function fetchApiRelationTimelineCumulative(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [], noRelation: true };
  }

  const cacheKey = getCacheKey(bookId, selectedChapter, id1, id2);
  const cached = getCachedData(cacheKey);
  if (cached) {
    return { ...cached, noRelation: (cached.points || []).length === 0 };
  }

  try {
    const result = await fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter);
    setCachedData(cacheKey, result);
    return { ...result, noRelation: (result.points || []).length === 0 };
  } catch (error) {
    return { points: [], labelInfo: [], noRelation: true };
  }
}

async function fetchApiRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum) {
  if (!bookId || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [], noRelation: true };
  }

  try {
    const cachedEvents = new Map();
    let firstAppearanceIdx = null;

    for (let idx = 1; idx <= eventNum; idx += 1) {
      try {
        const fineData = await getFineGraph(bookId, chapterNum, idx);
        cachedEvents.set(idx, fineData);

        const hasRealData =
          fineData?.isSuccess &&
          fineData?.result &&
          (fineData.result.characters ||
            (fineData.result.relations && fineData.result.relations.length > 0) ||
            fineData.result.event);

        if (!hasRealData) {
          continue;
        }

        if (firstAppearanceIdx === null && fineData.result.relations?.length) {
          const relation = fineData.result.relations.find((rel) => isSamePair(rel, id1, id2));
          if (relation) {
            firstAppearanceIdx = idx;
          }
        }
      } catch (error) {
        // ignore per-event errors
      }
    }

    if (firstAppearanceIdx === null) {
      return { points: [], labelInfo: [], noRelation: true };
    }

    const points = [];
    const labelInfo = [];

    for (let idx = firstAppearanceIdx; idx <= eventNum; idx += 1) {
      try {
        let fineData = cachedEvents.get(idx);
        if (!fineData) {
          fineData = await getFineGraph(bookId, chapterNum, idx);
        }

        if (fineData?.result?.relations?.length) {
          const relation = fineData.result.relations.find((rel) => isSamePair(rel, id1, id2));
          if (relation) {
            points.push(relation.positivity || 0);
            labelInfo.push(`E${idx}`);
          }
        }
      } catch (error) {
        // ignore per-event errors
      }
    }

    return { points, labelInfo, noRelation: points.length === 0 };
  } catch (error) {
    return { points: [], labelInfo: [], noRelation: true };
  }
}

export function useRelationData(mode, id1, id2, chapterNum, eventNum, maxChapter, filename, bookId = null) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);

  const numericBookId = useMemo(() => {
    const parsed = toNumberOrNull(bookId);
    return parsed && parsed > 0 ? parsed : null;
  }, [bookId]);

  const maxEventCount = useMemo(() => {
    const nonNullPoints = Array.isArray(timeline)
      ? timeline.filter((value) => value !== null && value !== undefined).length
      : 0;
    return Math.max(nonNullPoints || 1, 1);
  }, [timeline]);

  const fetchData = useCallback(async () => {
    if (!numericBookId || !id1 || !id2 || !chapterNum) {
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
        result = await fetchApiRelationTimelineCumulative(numericBookId, id1, id2, chapterNum);
      } else {
        result = await fetchApiRelationTimelineViewer(
          numericBookId,
          id1,
          id2,
          chapterNum,
          eventNum ? Math.max(1, eventNum) : 1
        );
      }

      const { points, labelInfo, noRelation: resultNoRelation } = result;
      const { points: paddedPoints, labels: paddedLabels } = padSingleEvent(points, labelInfo);

      setTimeline(paddedPoints);
      setLabels(paddedLabels);
      setNoRelation(resultNoRelation || paddedPoints.filter((value) => value !== null).length === 0);
    } catch (err) {
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
      setError('데이터를 가져오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [numericBookId, id1, id2, chapterNum, eventNum, mode]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return useMemo(
    () => ({
      timeline,
      labels,
      loading,
      noRelation,
      error,
      fetchData,
      getMaxEventCount: () => maxEventCount,
    }),
    [timeline, labels, loading, noRelation, error, fetchData, maxEventCount]
  );
}

export function clearRelationTimelineCache(bookId, chapterNum = null) {
  invalidateCache(bookId, chapterNum);
}

