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
    const eventCache = new Map(); // key: `${chapter}-${eventIdx}`
    const chapterRelationCache = new Map(); // key: chapter -> { relationEvents, firstIdx, lastIdx }

    const fetchEventData = async (chapter, eventIdx) => {
      const cacheKey = `${chapter}-${eventIdx}`;
      if (eventCache.has(cacheKey)) {
        return eventCache.get(cacheKey);
      }
      const data = await getFineGraph(bookId, chapter, eventIdx);
      eventCache.set(cacheKey, data);
      return data;
    };

    const getRelationEventsForChapter = async (chapter) => {
      if (chapterRelationCache.has(chapter)) {
        return chapterRelationCache.get(chapter);
      }

      let chapterLastEventIdx = 0;
      let left = 1;
      let right = 100;

      while (left <= right) {
        const mid = Math.floor((left + right) / 2);
        try {
          const searchData = await fetchEventData(chapter, mid);
          const hasRealData =
            searchData?.isSuccess &&
            searchData?.result &&
            (searchData.result.characters ||
              (searchData.result.relations && searchData.result.relations.length > 0) ||
              searchData.result.event);

          if (hasRealData) {
            chapterLastEventIdx = mid;
            left = mid + 1;
          } else {
            right = mid - 1;
          }
        } catch (error) {
          right = mid - 1;
        }
      }

      const relationEvents = [];

      if (chapterLastEventIdx > 0) {
        for (let idx = 1; idx <= chapterLastEventIdx; idx += 1) {
          try {
            const fineData = await fetchEventData(chapter, idx);
            const hasRealData =
              fineData?.isSuccess &&
              fineData?.result &&
              (fineData.result.characters ||
                (fineData.result.relations && fineData.result.relations.length > 0) ||
                fineData.result.event);

            if (!hasRealData) {
              continue;
            }

            if (fineData?.result?.relations?.length) {
              const relation = fineData.result.relations.find((rel) => isSamePair(rel, id1, id2));
              if (relation) {
                relationEvents.push({
                  idx,
                  positivity: relation.positivity || 0,
                });
              }
            }
          } catch (error) {
          }
        }
      }

      const chapterResult = {
        relationEvents,
        firstIdx: relationEvents.length ? relationEvents[0].idx : null,
        lastIdx: relationEvents.length ? relationEvents[relationEvents.length - 1].idx : null,
      };

      chapterRelationCache.set(chapter, chapterResult);
      return chapterResult;
    };

    let firstAppearanceChapter = null;
    const previousChapterPairs = [];
    let currentChapterPairs = [];

    for (let chapter = 1; chapter <= selectedChapter; chapter += 1) {
      const { relationEvents } = await getRelationEventsForChapter(chapter);
      if (!relationEvents || relationEvents.length === 0) {
        continue;
      }

      if (firstAppearanceChapter === null) {
        firstAppearanceChapter = chapter;
      }

      if (chapter < selectedChapter) {
        const lastEvent = relationEvents[relationEvents.length - 1];
        previousChapterPairs.push({
          chapter,
          label: `Ch${chapter}`,
          value: lastEvent.positivity || 0,
        });
      } else {
        currentChapterPairs = relationEvents.map((event) => ({
          label: `E${event.idx}`,
          value: event.positivity || 0,
        }));
      }
    }

    if (firstAppearanceChapter === null) {
      return { points: [], labelInfo: [] };
    }

    const filteredPreviousPairs = previousChapterPairs.filter(
      (pair) => pair.chapter >= firstAppearanceChapter
    );

    if (filteredPreviousPairs.length === 0 && currentChapterPairs.length === 0) {
      return { points: [], labelInfo: [] };
    }

    const points = [
      ...filteredPreviousPairs.map((pair) => pair.value),
      ...currentChapterPairs.map((event) => event.value),
    ];

    const labelInfo = [
      ...filteredPreviousPairs.map((pair) => pair.label),
      ...currentChapterPairs.map((event) => event.label),
    ];

    return { points, labelInfo };
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

