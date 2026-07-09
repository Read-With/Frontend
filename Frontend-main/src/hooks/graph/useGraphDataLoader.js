/** 챕터·이벤트 캐시 기반 그래프 elements 로드·diff */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  sortEventsByIdx,
  clampEventIdxToMax,
  filterEventsUpTo,
  filterEventsBefore,
  getMaxEventIdx,
  resolveMaxChapter,
} from '../../utils/graph/graphData';
import { createCharacterMaps, aggregateCharactersFromEvents, buildNodeWeightsFromEvents, toNodeWeightsOrNull } from '../../utils/graph/characterUtils';
import { resolvePositiveBookId } from '../common/hooksShared';
import { convertRelationsToElements, calcGraphDiff } from '../../utils/graph/graphDataUtils';
import { normalizeRelation, isValidRelation, relationEventMetaPassthrough } from '../../utils/graph/relationUtils';
import {
  getCachedChapterEvents,
  reconstructChapterGraphState,
} from '../../utils/common/cache/chapterEventCache';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { graphDataTransformUtils } from '../../utils/viewer/viewerGraphUtils';

const createEmptyLastComputedGraph = () => ({
  cacheKey: null,
  chapterIdx: null,
  eventIdx: null,
  elements: [],
});

function shouldMergeWithLastComputed(last, cacheKey, chapter, eventIdx) {
  const lastChapter = Number(last?.chapterIdx);
  const currentChapter = Number(chapter);
  if (
    !last?.elements?.length ||
    !Number.isFinite(lastChapter) ||
    !Number.isFinite(currentChapter)
  ) {
    return false;
  }

  return (
    (last.cacheKey === cacheKey && Number(eventIdx) >= Number(last.eventIdx || 0)) ||
    currentChapter > lastChapter
  );
}

function mergeWithLastComputed(elements, last, cacheKey, chapter, eventIdx) {
  if (!shouldMergeWithLastComputed(last, cacheKey, chapter, eventIdx)) {
    return elements;
  }

  return graphDataTransformUtils.mergeElementsWithPrevious(
    elements,
    {
      elements: last.elements,
      eventIdx: last.eventIdx,
      chapterIdx: last.chapterIdx,
    },
    chapter,
    eventIdx
  );
}

export function useGraphDataLoader(bookId, chapterIdx, eventIdx = null) {
  const [elements, setElements] = useState([]);
  const [currentChapterData, setCurrentChapterData] = useState(null);
  const [maxChapter, setMaxChapter] = useState(1);
  const [loading, setLoading] = useState(true);
  const [isDataEmpty, setIsDataEmpty] = useState(false);
  const [cacheVersion, setCacheVersion] = useState(0);

  const lastComputedRef = useRef(createEmptyLastComputedGraph());

  const numericBookId = useMemo(() => resolvePositiveBookId(bookId), [bookId]);

  const setEmptyState = useCallback(() => {
    setElements([]);
    setCurrentChapterData({ characters: [] });
    setIsDataEmpty(true);
  }, []);

  const resetState = useCallback(() => {
    setElements([]);
    setCurrentChapterData(null);
    setIsDataEmpty(false);
    lastComputedRef.current = createEmptyLastComputedGraph();
  }, []);

  const ensureMaxChapter = useCallback(() => {
    if (!numericBookId) {
      setMaxChapter(1);
      return;
    }

    const manifest = getManifestFromCache(numericBookId);
    setMaxChapter(resolveMaxChapter(numericBookId, manifest));
  }, [numericBookId]);

  useEffect(() => {
    resetState();
    ensureMaxChapter();
  }, [numericBookId, resetState, ensureMaxChapter]);

  const getChapterEvents = useCallback(
    (bookIdNum, chapter) => {
      if (!bookIdNum || !chapter) return null;
      return getCachedChapterEvents(bookIdNum, chapter) ?? null;
    },
    []
  );

  const isChapterEventsReadySync = useCallback((bookIdNum, chapter) => {
    if (!bookIdNum || !chapter) return false;
    return Boolean(getCachedChapterEvents(bookIdNum, chapter));
  }, []);

  const extractNewNodeIds = useCallback((diff) => {
    return (diff?.added || [])
      .filter(
        (el) =>
          el &&
          el.data &&
          !el.data.source &&
          el.data.id !== undefined &&
          el.data.id !== null
      )
      .map((el) => el.data.id);
  }, []);

  const buildGraphPayload = useCallback((eventList) => {
    if (!Array.isArray(eventList) || eventList.length === 0) {
      return { elements: [], characters: [] };
    }

    const aggregatedRelations = [];
    const charactersMap = aggregateCharactersFromEvents(eventList);
    let latestEventMeta = null;

    eventList.forEach((entry) => {
      if (!entry) return;

      const relations = Array.isArray(entry.relations) ? entry.relations : [];
      relations.forEach((rel) => aggregatedRelations.push(rel));

      if (entry.event) {
        latestEventMeta = entry.event;
      }
    });

    const aggregatedCharacters = Array.from(charactersMap.values());
    const {
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      idToProfileImage
    } = createCharacterMaps(aggregatedCharacters);

    const normalizedRelations = aggregatedRelations
      .map((raw) => {
        const n = normalizeRelation(raw);
        if (!n || !isValidRelation(n)) return null;
        return { ...n, ...relationEventMetaPassthrough(raw) };
      })
      .filter(Boolean);

    const nodeWeights = buildNodeWeightsFromEvents(eventList);

    const elements = convertRelationsToElements(
      normalizedRelations,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      'api',
      toNodeWeightsOrNull(nodeWeights),
      null,
      latestEventMeta,
      idToProfileImage,
      aggregatedCharacters.length > 0 ? aggregatedCharacters : null
    );

    return {
      elements,
      characters: aggregatedCharacters
    };
  }, []);

  const checkCancelled = useCallback((isCancelledRef) => {
    return isCancelledRef?.current === true;
  }, []);

  const processDiffCacheState = useCallback((chapterEvents, targetIdx, isCancelledRef) => {
    if (checkCancelled(isCancelledRef)) return null;

    const currentState = reconstructChapterGraphState(chapterEvents, targetIdx);
    if (!currentState) return null;

    if (checkCancelled(isCancelledRef)) return null;

    const baseEventIdx = Number(chapterEvents?.baseSnapshot?.eventIdx) || 1;
    let previousElements = [];
    
    if ((currentState.eventIdx || baseEventIdx) > baseEventIdx) {
      const previousState = reconstructChapterGraphState(
        chapterEvents,
        Math.max((currentState.eventIdx || baseEventIdx) - 1, baseEventIdx)
      );
      previousElements = previousState?.elements || [];
    }

    const diff = calcGraphDiff(previousElements, currentState?.elements || []);
    const newNodes = extractNewNodeIds(diff);

    if (checkCancelled(isCancelledRef)) return null;

    return {
      elements: currentState.elements || [],
      characters: currentState.characters || [],
      newNodes,
      eventIdx: currentState.eventIdx || targetIdx,
      isEmpty: (currentState.elements || []).length === 0
    };
  }, [extractNewNodeIds, checkCancelled]);

  // cachedPrevElements: if the caller already has elements for (targetIdx-1), pass them to skip
  // a full re-aggregation of previousEvents.
  const processEventsArray = useCallback((eventsArray, targetIdx, isCancelledRef, cachedPrevElements = null) => {
    if (checkCancelled(isCancelledRef)) return null;

    const currentEvents = filterEventsUpTo(eventsArray, targetIdx);

    if (checkCancelled(isCancelledRef)) return null;

    const currentPayload = buildGraphPayload(currentEvents);

    let prevElements;
    if (cachedPrevElements !== null) {
      prevElements = cachedPrevElements;
    } else {
      const previousEvents = filterEventsBefore(eventsArray, targetIdx);
      prevElements = buildGraphPayload(previousEvents).elements || [];
    }

    if (checkCancelled(isCancelledRef)) return null;

    const diff = calcGraphDiff(prevElements, currentPayload.elements || []);
    const newNodes = extractNewNodeIds(diff);

    return {
      elements: currentPayload.elements,
      characters: currentPayload.characters,
      newNodes,
      eventIdx: targetIdx,
      isEmpty: (currentPayload.elements || []).length === 0
    };
  }, [buildGraphPayload, extractNewNodeIds, checkCancelled]);

  const loadData = useCallback(
    async (bookIdNum, chapter, requestedEventIdx, isCancelledRef) => {
      if (!bookIdNum || !chapter) {
        resetState();
        setIsDataEmpty(true);
        return;
      }

      try {
        const cacheKey = `${bookIdNum}-${chapter}`;
        const chapterEvents = await getChapterEvents(bookIdNum, chapter);

        if (checkCancelled(isCancelledRef)) return;

        if (!chapterEvents) {
          return;
        }

        const eventsArray = Array.isArray(chapterEvents?.events)
          ? sortEventsByIdx(chapterEvents.events)
          : [];

        const maxEventIdxInChapter =
          toNumberOrNull(chapterEvents?.maxEventIdx) ||
          getMaxEventIdx(eventsArray);

        if (checkCancelled(isCancelledRef)) return;
        
        const targetIdx = clampEventIdxToMax(requestedEventIdx, maxEventIdxInChapter);

        if (!maxEventIdxInChapter) {
          if (!checkCancelled(isCancelledRef)) {
            setEmptyState();
          }
          return;
        }

        const hasDiffCache =
          chapterEvents?.baseSnapshot &&
          Array.isArray(chapterEvents?.diffs);

        if (hasDiffCache) {
          const diffState = processDiffCacheState(chapterEvents, targetIdx, isCancelledRef);
          if (diffState) {
            if (!checkCancelled(isCancelledRef)) {
              const last = lastComputedRef.current;
              const nextEls = mergeWithLastComputed(
                diffState.elements,
                last,
                cacheKey,
                chapter,
                diffState.eventIdx
              );
              lastComputedRef.current = { cacheKey, chapterIdx: chapter, eventIdx: diffState.eventIdx, elements: nextEls };
              setElements(nextEls);
              setCurrentChapterData({ characters: diffState.characters });
              setIsDataEmpty(false);
            }
            return;
          }
        }

        if (!eventsArray.length) {
          if (!checkCancelled(isCancelledRef)) {
            setEmptyState();
          }
          return;
        }

        const last = lastComputedRef.current;
        const cachedPrev =
          last.cacheKey === cacheKey && last.eventIdx === targetIdx - 1
            ? last.elements
            : null;

        const eventsState = processEventsArray(eventsArray, targetIdx, isCancelledRef, cachedPrev);
        if (eventsState && !checkCancelled(isCancelledRef)) {
          const last = lastComputedRef.current;
          const nextEls = mergeWithLastComputed(eventsState.elements, last, cacheKey, chapter, targetIdx);
          lastComputedRef.current = { cacheKey, chapterIdx: chapter, eventIdx: targetIdx, elements: nextEls };
          setElements(nextEls);
          setCurrentChapterData({ characters: eventsState.characters });
          setIsDataEmpty(false);
        }
      } catch {
        if (!checkCancelled(isCancelledRef)) {
          setEmptyState();
        }
      }
    },
    [getChapterEvents, resetState, setEmptyState, processDiffCacheState, processEventsArray, checkCancelled]
  );

  // When the chapter event cache is not yet available on first load, poll until it is
  // and bump cacheVersion to re-trigger the main loadData effect.
  useEffect(() => {
    if (!numericBookId || !chapterIdx) return;
    if (isChapterEventsReadySync(numericBookId, chapterIdx)) return;

    const intervalId = globalThis.setInterval(() => {
      if (isChapterEventsReadySync(numericBookId, chapterIdx)) {
        globalThis.clearInterval(intervalId);
        setCacheVersion((v) => v + 1);
      }
    }, 80);

    return () => globalThis.clearInterval(intervalId);
  }, [numericBookId, chapterIdx, isChapterEventsReadySync]);

  useEffect(() => {
    if (!numericBookId || !chapterIdx) {
      setLoading(false);
      setIsDataEmpty(true);
      resetState();
      return;
    }

    const cancelledRef = { current: false };
    setIsDataEmpty(false);
    if (!isChapterEventsReadySync(numericBookId, chapterIdx)) {
      setLoading(true);
    }

    loadData(numericBookId, chapterIdx, eventIdx, cancelledRef).finally(() => {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [numericBookId, chapterIdx, eventIdx, cacheVersion, loadData, resetState, isChapterEventsReadySync]);

  return {
    elements,
    setElements,
    setIsDataEmpty,
    currentChapterData,
    maxChapter,
    loading,
    isDataEmpty
  };
}
