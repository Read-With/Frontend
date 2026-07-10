/** 간선 툴팁: 관계 타임라인 API·캐시 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { isSamePair } from '../../utils/graph/relationUtils';
import { getFineGraph } from '../../utils/api/api';
import { cacheKeyUtils, eventUtils } from '../../utils/viewer/viewerCoreStateUtils';
import {
  hasFineGraphEventSlot,
  pickFineGraphResult,
} from '../../utils/viewer/viewerGraphUtils';
import { resolvePositiveBookId } from '../common/hooksShared';
import { resolveFineGraphEventToLocator, resolveLastEventIdxForFineGraph } from '../../utils/common/cache/manifestCache';
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
    const pair = eventUtils.resolveRelationNodeIds(data);
    return isSamePair(pair, id1, id2);
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

const PROBE_EVENT_HARD_MAX = 512;

function emptyChapterRelationResult() {
  return { relationEvents: [], firstIdx: null, lastIdx: null };
}

function toChapterRelationResult(relationEvents) {
  return {
    relationEvents,
    firstIdx: relationEvents.length ? relationEvents[0].idx : null,
    lastIdx: relationEvents.length ? relationEvents[relationEvents.length - 1].idx : null,
  };
}

function collectRelationEventsFromChapterCache(chapterPayload, id1, id2, lastEventIdx, lastOnly) {
  const relationEvents = [];

  if (lastOnly) {
    for (let idx = lastEventIdx; idx >= 1; idx -= 1) {
      const state = reconstructChapterGraphState(chapterPayload, idx);
      const edge = findRelationInElements(state?.elements, id1, id2);
      if (edge) {
        relationEvents.push({ idx, positivity: relationPointFromElement(edge) });
        break;
      }
    }
    return toChapterRelationResult(relationEvents);
  }

  for (let idx = 1; idx <= lastEventIdx; idx += 1) {
    const state = reconstructChapterGraphState(chapterPayload, idx);
    const edge = findRelationInElements(state?.elements, id1, id2);
    if (!edge) continue;
    relationEvents.push({ idx, positivity: relationPointFromElement(edge) });
  }

  return toChapterRelationResult(relationEvents);
}

async function probeLastEventIdxByApi(fetchEventData, chapter) {
  let low = 1;
  let high = 1;
  let lastGood = 0;

  while (high <= PROBE_EVENT_HARD_MAX) {
    try {
      const searchData = await fetchEventData(chapter, high);
      const searchResult = pickFineGraphResult(searchData);
      const hasRealData =
        searchData?.isSuccess &&
        hasFineGraphEventSlot(searchResult);

      if (hasRealData) {
        lastGood = high;
        low = high + 1;
        high *= 2;
      } else {
        break;
      }
    } catch (_error) {
      break;
    }
  }

  if (lastGood === 0) return 0;

  let left = low;
  let right = Math.min(high - 1, PROBE_EVENT_HARD_MAX);
  let chapterLastEventIdx = lastGood;

  while (left <= right) {
    const mid = Math.floor((left + right) / 2);
    try {
      const searchData = await fetchEventData(chapter, mid);
      const searchResult = pickFineGraphResult(searchData);
      const hasRealData =
        searchData?.isSuccess &&
        hasFineGraphEventSlot(searchResult);

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

  return chapterLastEventIdx;
}

async function resolveChapterLastEventIdx(bookId, chapter, fetchEventData) {
  const fromManifest = resolveLastEventIdxForFineGraph(bookId, chapter);
  if (Number.isFinite(fromManifest) && fromManifest >= 1) {
    return fromManifest;
  }

  const cached = getCachedChapterEvents(bookId, chapter);
  const cachedMax = Number(cached?.maxEventIdx);
  if (Number.isFinite(cachedMax) && cachedMax >= 1) {
    return cachedMax;
  }

  return probeLastEventIdxByApi(fetchEventData, chapter);
}

async function fetchApiRelationTimelineCumulativeFromAPI(bookId, id1, id2, selectedChapter) {
  if (!bookId || selectedChapter < 1) {
    return { points: [], labelInfo: [] };
  }

  try {
    const eventCache = new Map();
    const chapterRelationCache = new Map();

    const fetchEventData = async (chapter, eventIdx) => {
      const cacheKey = cacheKeyUtils.createCacheKey(chapter, eventIdx);
      if (eventCache.has(cacheKey)) {
        return eventCache.get(cacheKey);
      }
      const atLocator = resolveFineGraphEventToLocator(bookId, chapter, eventIdx);
      const data = await getFineGraph(bookId, chapter, eventIdx, atLocator);
      eventCache.set(cacheKey, data);
      return data;
    };

    const getRelationEventsForChapter = async (chapter, { lastOnly = false } = {}) => {
      const cacheKey = `${chapter}:${lastOnly ? 'last' : 'all'}`;
      if (chapterRelationCache.has(cacheKey)) {
        return chapterRelationCache.get(cacheKey);
      }

      const chapterPayload = getCachedChapterEvents(bookId, chapter);
      if (chapterPayload?.baseSnapshot) {
        const cachedMax = Number(chapterPayload.maxEventIdx);
        const lastEventIdx =
          Number.isFinite(cachedMax) && cachedMax >= 1
            ? cachedMax
            : await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);

        if (!(lastEventIdx > 0)) {
          const empty = emptyChapterRelationResult();
          chapterRelationCache.set(cacheKey, empty);
          return empty;
        }

        const fromCache = collectRelationEventsFromChapterCache(
          chapterPayload,
          id1,
          id2,
          lastEventIdx,
          lastOnly
        );
        chapterRelationCache.set(cacheKey, fromCache);
        return fromCache;
      }

      const chapterLastEventIdx = await resolveChapterLastEventIdx(bookId, chapter, fetchEventData);
      const relationEvents = [];

      if (chapterLastEventIdx > 0) {
        if (lastOnly) {
          for (let idx = chapterLastEventIdx; idx >= 1; idx -= 1) {
            try {
              const fineData = await fetchEventData(chapter, idx);
              const fineResult = pickFineGraphResult(fineData);
              const hasRealData =
                fineData?.isSuccess &&
                hasFineGraphEventSlot(fineResult);

              if (!hasRealData) continue;

              if (Array.isArray(fineResult?.relations) && fineResult.relations.length > 0) {
                const relation = fineResult.relations.find((rel) => isSamePair(rel, id1, id2));
                if (relation) {
                  relationEvents.push({
                    idx,
                    positivity: relation.positivity || 0,
                  });
                  break;
                }
              }
            } catch (_error) {
              // continue probing earlier events
            }
          }
        } else {
          for (let idx = 1; idx <= chapterLastEventIdx; idx += 1) {
            try {
              const fineData = await fetchEventData(chapter, idx);
              const fineResult = pickFineGraphResult(fineData);
              const hasRealData =
                fineData?.isSuccess &&
                hasFineGraphEventSlot(fineResult);

              if (!hasRealData) continue;

              if (Array.isArray(fineResult?.relations) && fineResult.relations.length > 0) {
                const relation = fineResult.relations.find((rel) => isSamePair(rel, id1, id2));
                if (relation) {
                  relationEvents.push({
                    idx,
                    positivity: relation.positivity || 0,
                  });
                }
              }
            } catch (_error) {
              // skip event
            }
          }
        }
      }

      const chapterResult = toChapterRelationResult(relationEvents);
      chapterRelationCache.set(cacheKey, chapterResult);
      return chapterResult;
    };

    let firstAppearanceChapter = null;
    const previousChapterPairs = [];
    let currentChapterPairs = [];

    for (let chapter = 1; chapter <= selectedChapter; chapter += 1) {
      const lastOnly = chapter < selectedChapter;
      const { relationEvents } = await getRelationEventsForChapter(chapter, { lastOnly });
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
    if (Array.isArray(result?.points) && result.points.length > 0) {
      setCachedData(cacheKey, result);
    }
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
        const atLocator = resolveFineGraphEventToLocator(bookId, chapterNum, idx);
        const fineData = await getFineGraph(bookId, chapterNum, idx, atLocator);
        cachedEvents.set(idx, fineData);
        const fineResult = pickFineGraphResult(fineData);

        const hasRealData =
          fineData?.isSuccess &&
          hasFineGraphEventSlot(fineResult);

        if (!hasRealData) {
          continue;
        }

        if (firstAppearanceIdx === null && Array.isArray(fineResult?.relations)) {
          const relation = fineResult.relations.find((rel) => isSamePair(rel, id1, id2));
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

    for (let idx = firstAppearanceIdx; idx <= eventNum; idx += 1) {
      try {
        let fineData = cachedEvents.get(idx);
        if (!fineData) {
          const atLocator = resolveFineGraphEventToLocator(bookId, chapterNum, idx);
          fineData = await getFineGraph(bookId, chapterNum, idx, atLocator);
        }
        const fineResult = pickFineGraphResult(fineData);

        let positivityForEvent = 0;
        if (Array.isArray(fineResult?.relations) && fineResult.relations.length > 0) {
          const relation = fineResult.relations.find((rel) => isSamePair(rel, id1, id2));
          if (relation) {
            positivityForEvent = relation.positivity || 0;
          }
        }
        points.push(positivityForEvent);
        labelInfo.push(`E${idx}`);
      } catch (_error) {
        points.push(0);
        labelInfo.push(`E${idx}`);
      }
    }

    return withNoRelation({ points, labelInfo });
  } catch (_error) {
    return { points: [], labelInfo: [], noRelation: true };
  }
}

export function useRelationData(mode, id1, id2, chapterNum, eventNum, bookId = null) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  const numericBookId = useMemo(() => resolvePositiveBookId(bookId), [bookId]);

  const fetchData = useCallback(async () => {
    if (!numericBookId || !id1 || !id2 || !chapterNum) {
      requestIdRef.current += 1;
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
      setError('필수 매개변수가 누락되었습니다.');
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
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

      if (requestId !== requestIdRef.current) return;

      const { points, labelInfo, noRelation: resultNoRelation } = result;
      const { points: paddedPoints, labels: paddedLabels } = padSingleEvent(points, labelInfo);

      setTimeline(paddedPoints);
      setLabels(paddedLabels);
      setNoRelation(resultNoRelation || paddedPoints.filter((value) => value !== null).length === 0);
    } catch (_err) {
      if (requestId !== requestIdRef.current) return;
      setTimeline([]);
      setLabels([]);
      setNoRelation(true);
      setError('데이터를 가져오는 중 오류가 발생했습니다.');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [numericBookId, id1, id2, chapterNum, eventNum, mode]);

  useEffect(() => {
    fetchData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchData]);

  return useMemo(
    () => ({
      timeline,
      labels,
      loading,
      noRelation,
      error,
      fetchData,
    }),
    [timeline, labels, loading, noRelation, error, fetchData]
  );
}

