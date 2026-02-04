import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toNumberOrNull } from '../../utils/numberUtils';
import { sortEventsByIdx, normalizeEventIdx, filterEventsUpTo, filterEventsBefore, getMaxEventIdx } from '../../utils/eventUtils';
import { createCharacterMaps, aggregateCharactersFromEvents, buildNodeWeights } from '../../utils/characterUtils';
import { convertRelationsToElements, calcGraphDiff } from '../../utils/graph/graphDataUtils';
import { normalizeRelation, isValidRelation } from '../../utils/relationUtils';
import { getCachedChapterEvents, reconstructChapterGraphState } from '../../utils/common/cache/chapterEventCache';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { resolveMaxChapter } from '../../utils/graph/maxChapterResolver';

export function useGraphDataLoader(bookId, chapterIdx, eventIdx = null) {
  const [elements, setElements] = useState([]);
  const [newNodeIds, setNewNodeIds] = useState([]);
  const [currentChapterData, setCurrentChapterData] = useState(null);
  const [maxEventNum, setMaxEventNum] = useState(0);
  const [eventNum, setEventNum] = useState(0);
  const [maxChapter, setMaxChapter] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isDataEmpty, setIsDataEmpty] = useState(false);

  const chapterEventsCacheRef = useRef(new Map());
  const MAX_CACHE_SIZE = 50;

  useEffect(() => {
    return () => {
      chapterEventsCacheRef.current.clear();
    };
  }, []);

  const numericBookId = useMemo(() => {
    const parsed = toNumberOrNull(bookId);
    return parsed && parsed > 0 ? parsed : null;
  }, [bookId]);

  const setEmptyState = useCallback((eventNum = 0) => {
    setElements([]);
    setNewNodeIds([]);
    setCurrentChapterData({ characters: [] });
    setEventNum(eventNum);
    setIsDataEmpty(true);
  }, []);

  const resetState = useCallback(() => {
    setElements([]);
    setNewNodeIds([]);
    setCurrentChapterData(null);
    setMaxEventNum(0);
    setEventNum(0);
    setError(null);
    setIsDataEmpty(false);
  }, []);

  const ensureMaxChapter = useCallback(() => {
    if (!numericBookId) {
      setMaxChapter(1);
      return;
    }

    const manifest = getManifestFromCache(numericBookId);
    const maxChapter = resolveMaxChapter(numericBookId, manifest);
    setMaxChapter(maxChapter);
  }, [numericBookId]);

  useEffect(() => {
    resetState();
    ensureMaxChapter();
  }, [numericBookId, resetState, ensureMaxChapter]);

  const getChapterEvents = useCallback(
    async (bookIdNum, chapter) => {
      if (!bookIdNum || !chapter) return null;
      const cacheKey = `${bookIdNum}-${chapter}`;
      const cache = chapterEventsCacheRef.current;
      
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }

      const result = getCachedChapterEvents(bookIdNum, chapter);
      if (result) {
        if (cache.size >= MAX_CACHE_SIZE) {
          const firstKey = cache.keys().next().value;
          cache.delete(firstKey);
        }
        cache.set(cacheKey, result);
      }
      return result;
    },
    []
  );

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
      .map((rel) => normalizeRelation(rel))
      .filter((rel) => isValidRelation(rel));

    const nodeWeights = buildNodeWeights(aggregatedCharacters);

    const elements = convertRelationsToElements(
      normalizedRelations,
      idToName,
      idToDesc,
      idToDescKo,
      idToMain,
      idToNames,
      'api',
      Object.keys(nodeWeights).length ? nodeWeights : null,
      null,
      latestEventMeta,
      idToProfileImage
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

  const processEventsArray = useCallback((eventsArray, targetIdx, isCancelledRef) => {
    if (checkCancelled(isCancelledRef)) return null;

    const currentEvents = filterEventsUpTo(eventsArray, targetIdx);
    const previousEvents = filterEventsBefore(eventsArray, targetIdx);

    if (checkCancelled(isCancelledRef)) return null;

    const currentPayload = buildGraphPayload(currentEvents);
    const previousPayload = buildGraphPayload(previousEvents);

    if (checkCancelled(isCancelledRef)) return null;

    const diff = calcGraphDiff(
      previousPayload.elements || [],
      currentPayload.elements || []
    );
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
        const chapterEvents = await getChapterEvents(bookIdNum, chapter);
        
        if (checkCancelled(isCancelledRef)) return;

        const eventsArray = Array.isArray(chapterEvents?.events)
          ? sortEventsByIdx(chapterEvents.events)
          : [];

        const maxEventIdxInChapter =
          toNumberOrNull(chapterEvents?.maxEventIdx) ||
          getMaxEventIdx(eventsArray);

        if (checkCancelled(isCancelledRef)) return;
        
        setMaxEventNum(maxEventIdxInChapter);

        const targetIdx = normalizeEventIdx(requestedEventIdx, maxEventIdxInChapter);

        if (!maxEventIdxInChapter) {
          if (!checkCancelled(isCancelledRef)) {
            setEmptyState(targetIdx || 0);
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
              setElements(diffState.elements);
              setCurrentChapterData({ characters: diffState.characters });
              setNewNodeIds(diffState.newNodes);
              setEventNum(diffState.eventIdx);
              setError(null);
              setIsDataEmpty(diffState.isEmpty);
            }
            return;
          }
        }

        if (!eventsArray.length) {
          if (!checkCancelled(isCancelledRef)) {
            setEmptyState(targetIdx || 0);
          }
          return;
        }

        const eventsState = processEventsArray(eventsArray, targetIdx, isCancelledRef);
        if (eventsState && !checkCancelled(isCancelledRef)) {
          setElements(eventsState.elements);
          setCurrentChapterData({ characters: eventsState.characters });
          setNewNodeIds(eventsState.newNodes);
          setEventNum(eventsState.eventIdx);
          setError(null);
          setIsDataEmpty(eventsState.isEmpty);
        }
      } catch (err) {
        if (!checkCancelled(isCancelledRef)) {
          setEmptyState(0);
          setError(
            err?.message
              ? `그래프 데이터를 불러오는 중 오류가 발생했습니다: ${err.message}`
              : '그래프 데이터를 불러오는 중 오류가 발생했습니다.'
          );
        }
      }
    },
    [getChapterEvents, resetState, setEmptyState, processDiffCacheState, processEventsArray, checkCancelled]
  );

  useEffect(() => {
    if (!numericBookId || !chapterIdx) {
      setLoading(false);
      setIsDataEmpty(true);
      resetState();
      return;
    }

    const cancelledRef = { current: false };
    setError(null);
    setIsDataEmpty(false);
    setLoading(true);

    loadData(numericBookId, chapterIdx, eventIdx, cancelledRef).finally(() => {
      if (!cancelledRef.current) {
        setLoading(false);
      }
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [numericBookId, chapterIdx, eventIdx, loadData, resetState]);

  return {
    elements,
    setElements,
    setIsDataEmpty,
    newNodeIds,
    currentChapterData,
    maxEventNum,
    eventNum,
    maxChapter,
    loading,
    error,
    isDataEmpty
  };
}