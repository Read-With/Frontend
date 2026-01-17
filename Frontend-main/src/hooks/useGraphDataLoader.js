import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { toNumberOrNull } from '../utils/numberUtils';
import { sortEventsByIdx, normalizeEventIdx, filterEventsUpTo, filterEventsBefore, getMaxEventIdx } from '../utils/eventUtils';
import { createCharacterMaps, aggregateCharactersFromEvents, buildNodeWeights, normalizeCharacterId } from '../utils/characterUtils';
import { convertRelationsToElements, calcGraphDiff } from '../utils/graphDataUtils';
import { normalizeRelation, isValidRelation } from '../utils/relationUtils';
import { getCachedChapterEvents, reconstructChapterGraphState, getGraphBookCache } from '../utils/common/cache/chapterEventCache';
import { getMaxChapter, getManifestFromCache } from '../utils/common/cache/manifestCache';

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

    const cachedMax = getMaxChapter(numericBookId);
    if (cachedMax && cachedMax > 0) {
      setMaxChapter(cachedMax);
      return;
    }

    const manifest = getManifestFromCache(numericBookId);
    if (Array.isArray(manifest?.chapters) && manifest.chapters.length > 0) {
      setMaxChapter(manifest.chapters.length);
      return;
    }

    const graphSummary = getGraphBookCache(numericBookId);
    if (graphSummary?.maxChapter && graphSummary.maxChapter > 0) {
      setMaxChapter(graphSummary.maxChapter);
      return;
    }

    setMaxChapter(1);
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

  const loadData = useCallback(
    async (bookIdNum, chapter, requestedEventIdx, isCancelledRef) => {
      if (!bookIdNum || !chapter) {
        resetState();
        setIsDataEmpty(true);
        return;
      }

      try {
        const chapterEvents = await getChapterEvents(bookIdNum, chapter);
        
        if (isCancelledRef?.current) return;
        const eventsArray = Array.isArray(chapterEvents?.events)
          ? sortEventsByIdx(chapterEvents.events)
          : [];

        const maxEventIdxInChapter =
          toNumberOrNull(chapterEvents?.maxEventIdx) ||
          getMaxEventIdx(eventsArray);

        if (isCancelledRef?.current) return;
        
        setMaxEventNum(maxEventIdxInChapter);

        const targetIdx = normalizeEventIdx(requestedEventIdx, maxEventIdxInChapter);

        if (!maxEventIdxInChapter) {
          if (!isCancelledRef?.current) {
            setEmptyState(targetIdx || 0);
          }
          return;
        }

        const hasDiffCache =
          chapterEvents?.baseSnapshot &&
          Array.isArray(chapterEvents?.diffs);

        if (hasDiffCache) {
          const currentState = reconstructChapterGraphState(
            chapterEvents,
            targetIdx
          );

          if (currentState) {
            if (isCancelledRef?.current) return;
            const baseEventIdx =
              Number(chapterEvents?.baseSnapshot?.eventIdx) || 1;
            let previousElements = [];
            if ((currentState.eventIdx || baseEventIdx) > baseEventIdx) {
              const previousState = reconstructChapterGraphState(
                chapterEvents,
                Math.max((currentState.eventIdx || baseEventIdx) - 1, baseEventIdx)
              );
              previousElements = previousState?.elements || [];
            }
            const diff = calcGraphDiff(
              previousElements,
              currentState?.elements || []
            );

            const newNodes = extractNewNodeIds(diff);

            if (!isCancelledRef?.current) {
              setElements(currentState.elements || []);
              setCurrentChapterData({
                characters: currentState.characters || []
              });
              setNewNodeIds(newNodes);
              setEventNum(currentState.eventIdx || targetIdx);
              setError(null);
              setIsDataEmpty((currentState.elements || []).length === 0);
            }
            return;
          }
        }

        if (!eventsArray.length) {
          if (!isCancelledRef?.current) {
            setEmptyState(targetIdx || 0);
          }
          return;
        }

        const currentEvents = filterEventsUpTo(eventsArray, targetIdx);
        const previousEvents = filterEventsBefore(eventsArray, targetIdx);

        if (isCancelledRef?.current) return;

        const currentPayload = buildGraphPayload(currentEvents);
        const previousPayload = buildGraphPayload(previousEvents);

        if (isCancelledRef?.current) return;

        setElements(currentPayload.elements);
        setCurrentChapterData({ characters: currentPayload.characters });

        const diff = calcGraphDiff(
          previousPayload.elements || [],
          currentPayload.elements || []
        );

        const newNodes = extractNewNodeIds(diff);

        if (!isCancelledRef?.current) {
          setNewNodeIds(newNodes);
          setEventNum(targetIdx);
          setError(null);
          setIsDataEmpty((currentPayload.elements || []).length === 0);
        }
      } catch (err) {
        if (!isCancelledRef?.current) {
          setEmptyState(0);
          setError(
            err?.message
              ? `그래프 데이터를 불러오는 중 오류가 발생했습니다: ${err.message}`
              : '그래프 데이터를 불러오는 중 오류가 발생했습니다.'
          );
        }
      }
    },
    [buildGraphPayload, getChapterEvents, resetState, setEmptyState, extractNewNodeIds]
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