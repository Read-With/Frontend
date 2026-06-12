/** 간선 툴팁: 관계 타임라인 API·캐시 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { toNumberOrNull } from '../../utils/common/numberUtils';
import { isSamePair } from '../../utils/graph/relationUtils';
import { getFineGraph } from '../../utils/api/api';
import {
  getCachedChapterEvents,
  reconstructChapterGraphState,
} from '../../utils/common/cache/chapterEventCache';
import { registerCache, getCacheItem, setCacheItem, enforceCacheSizeLimit } from '../../utils/common/cache/cacheManager';

const CACHE_DURATION = 5 * 60 * 1000;
const CACHE_PREFIX = 'relation-timeline-';
const MAX_CACHE_SIZE = 50;

const relationTimelineCache = new Map();
registerCache('relationTimelineCache', relationTimelineCache, {
  maxSize: MAX_CACHE_SIZE,
  ttl: CACHE_DURATION,
  cleanupInterval: 300000,
  storageType: 'sessionStorage'
});

function getCacheKey(bookId, chapterNum, id1, id2) {
  return `${CACHE_PREFIX}${bookId}-${chapterNum}-${id1}-${id2}`;
}

function getCachedData(cacheKey) {
  const cached = getCacheItem('relationTimelineCache', cacheKey);
  if (cached && cached.result) {
    return cached.result;
  }
  return null;
}

function setCachedData(cacheKey, result) {
  setCacheItem('relationTimelineCache', cacheKey, {
    result,
    timestamp: Date.now()
  });
  enforceCacheSizeLimit('relationTimelineCache');
}

function withNoRelation(result, fallbackNoRelation = true) {
  const safeResult = result ?? { points: [], labelInfo: [] };
  const points = Array.isArray(safeResult.points) ? safeResult.points : [];
  return {
    ...safeResult,
    points,
    labelInfo: Array.isArray(safeResult.labelInfo) ? safeResult.labelInfo : [],
    noRelation: safeResult.noRelation ?? (points.length === 0 ? fallbackNoRelation : false),
  };
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

function findRelationInElements(elements, id1, id2) {
  if (!Array.isArray(elements)) return null;
  return elements.find((element) => {
    const data = element?.data;
    if (!data?.source || !data?.target) return false;
    return isSamePair(data, id1, id2);
  }) ?? null;
}

function relationPointFromElement(edgeElement) {
  const raw = edgeElement?.data?.positivity;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? Math.max(-1, Math.min(1, numeric)) : 0;
}

function fetchCachedRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum) {
  const chapterPayload = getCachedChapterEvents(bookId, chapterNum);
  if (!chapterPayload?.baseSnapshot) {
    return null;
  }

  const points = [];
  const labelInfo = [];
  let firstAppearanceIdx = null;

  for (let idx = 1; idx <= eventNum; idx += 1) {
    const state = reconstructChapterGraphState(chapterPayload, idx);
    const edge = findRelationInElements(state?.elements, id1, id2);

    if (edge && firstAppearanceIdx === null) {
      firstAppearanceIdx = idx;
    }

    if (firstAppearanceIdx !== null) {
      points.push(edge ? relationPointFromElement(edge) : 0);
      labelInfo.push(`E${idx}`);
    }
  }

  if (firstAppearanceIdx === null) {
    return { points: [], labelInfo: [], noRelation: true };
  }

  return { points, labelInfo, noRelation: false };
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
        } catch (_error) {
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
          } catch (_error) {
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
  } catch (_error) {
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
    return withNoRelation(cached);
  }

  try {
    const result = await fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter);
    setCachedData(cacheKey, result);
    return withNoRelation(result);
  } catch (_error) {
    return { points: [], labelInfo: [], noRelation: true };
  }
}

async function fetchApiRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum) {
  if (!bookId || chapterNum < 1 || eventNum < 1) {
    return { points: [], labelInfo: [], noRelation: true };
  }

  const cachedTimeline = fetchCachedRelationTimelineViewer(bookId, id1, id2, chapterNum, eventNum);
  if (cachedTimeline) {
    return cachedTimeline;
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
      } catch (_error) {
        // ignore per-event errors
      }
    }

    if (firstAppearanceIdx === null) {
      return { points: [], labelInfo: [], noRelation: true };
    }

    const points = [];
    const labelInfo = [];

    for (let idx = 1; idx <= eventNum; idx += 1) {
      try {
        let fineData = cachedEvents.get(idx);
        if (!fineData) {
          fineData = await getFineGraph(bookId, chapterNum, idx);
        }

        let positivityForEvent = 0;
        if (fineData?.result?.relations?.length) {
          const relation = fineData.result.relations.find((rel) => isSamePair(rel, id1, id2));
          if (relation) {
            positivityForEvent = relation.positivity || 0;
          }
        }
        points.push(positivityForEvent);
        labelInfo.push(`E${idx}`);
      } catch (_error) {
        // 이벤트 단위 오류는 해당 지점을 중립값으로 유지하고 진행
        points.push(0);
        labelInfo.push(`E${idx}`);
      }
    }

    return withNoRelation({ points, labelInfo });
  } catch (_error) {
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
    } catch (_err) {
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

