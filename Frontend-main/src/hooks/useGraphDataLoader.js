import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createCharacterMaps } from '../utils/characterUtils';
import { convertRelationsToElements, calcGraphDiff } from '../utils/graphDataUtils';
import { normalizeRelation, isValidRelation } from '../utils/relationUtils';
import { getCachedChapterEvents, reconstructChapterGraphState, getGraphBookCache } from '../utils/common/chapterEventCache';
import { getMaxChapter, getManifestFromCache } from '../utils/common/manifestCache';

const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

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

  const numericBookId = useMemo(() => {
    const parsed = toNumberOrNull(bookId);
    return parsed && parsed > 0 ? parsed : null;
  }, [bookId]);

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
      if (chapterEventsCacheRef.current.has(cacheKey)) {
        return chapterEventsCacheRef.current.get(cacheKey);
      }

      const result = getCachedChapterEvents(bookIdNum, chapter);
      if (result) {
        chapterEventsCacheRef.current.set(cacheKey, result);
      }
      return result;
    },
    []
  );

  const buildGraphPayload = useCallback((eventList) => {
    if (!Array.isArray(eventList) || eventList.length === 0) {
      return { elements: [], characters: [] };
    }

    const aggregatedRelations = [];
    const charactersMap = new Map();
    let latestEventMeta = null;

    eventList.forEach((entry) => {
      if (!entry) return;

      const characters = Array.isArray(entry.characters) ? entry.characters : [];
      characters.forEach((char) => {
        if (!char || char.id === undefined || char.id === null) return;
        const id = String(Math.trunc(char.id));
        charactersMap.set(id, char);
      });

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

    const nodeWeights = {};
    aggregatedCharacters.forEach((char) => {
      if (!char || char.id === undefined || char.id === null) return;
      const id = String(Math.trunc(char.id));
      const weight = typeof char.weight === 'number' ? char.weight : null;
      const count = typeof char.count === 'number' ? char.count : null;
      if (weight !== null || count !== null) {
        nodeWeights[id] = {
          weight: weight ?? 3,
          count: count ?? 0
        };
      }
    });

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
    async (bookIdNum, chapter, requestedEventIdx) => {
      if (!bookIdNum || !chapter) {
        resetState();
        setIsDataEmpty(true);
        return;
      }

      try {
        const chapterEvents = await getChapterEvents(bookIdNum, chapter);
        const eventsArray = Array.isArray(chapterEvents?.events)
          ? [...chapterEvents.events]
          : [];

        eventsArray.sort(
          (a, b) => (Number(a?.eventIdx) || 0) - (Number(b?.eventIdx) || 0)
        );

        const maxEventIdxInChapter =
          Number(chapterEvents?.maxEventIdx) ||
          (eventsArray.length > 0
            ? Number(eventsArray[eventsArray.length - 1].eventIdx) || 0
            : 0);

        setMaxEventNum(maxEventIdxInChapter);

        let targetIdx = toNumberOrNull(requestedEventIdx);
        if (!targetIdx || targetIdx < 1) {
          targetIdx = maxEventIdxInChapter || 1;
        }
        if (maxEventIdxInChapter && targetIdx > maxEventIdxInChapter) {
          targetIdx = maxEventIdxInChapter;
        }

        if (!maxEventIdxInChapter) {
          setElements([]);
          setNewNodeIds([]);
          setCurrentChapterData({ characters: [] });
          setEventNum(targetIdx || 0);
          setIsDataEmpty(true);
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

            const newNodes = (diff?.added || [])
              .filter(
                (el) =>
                  el &&
                  el.data &&
                  !el.data.source &&
                  el.data.id !== undefined &&
                  el.data.id !== null
              )
              .map((el) => el.data.id);

            setElements(currentState.elements || []);
            setCurrentChapterData({
              characters: currentState.characters || []
            });
            setNewNodeIds(newNodes);
            setEventNum(currentState.eventIdx || targetIdx);
            setError(null);
            setIsDataEmpty((currentState.elements || []).length === 0);
            return;
          }
        }

        if (!eventsArray.length) {
          setElements([]);
          setNewNodeIds([]);
          setCurrentChapterData({ characters: [] });
          setEventNum(targetIdx || 0);
          setIsDataEmpty(true);
          return;
        }

        const currentEvents = eventsArray.filter(
          (entry) => Number(entry?.eventIdx) <= targetIdx
        );
        const previousEvents = eventsArray.filter(
          (entry) => Number(entry?.eventIdx) < targetIdx
        );

        const currentPayload = buildGraphPayload(currentEvents);
        const previousPayload = buildGraphPayload(previousEvents);

        setElements(currentPayload.elements);
        setCurrentChapterData({ characters: currentPayload.characters });

        const diff = calcGraphDiff(
          previousPayload.elements || [],
          currentPayload.elements || []
        );

        const newNodes = diff.added
          .filter(
            (el) =>
              el &&
              el.data &&
              !el.data.source &&
              el.data.id !== undefined &&
              el.data.id !== null
          )
          .map((el) => el.data.id);

        setNewNodeIds(newNodes);
        setEventNum(targetIdx);
        setError(null);
        setIsDataEmpty((currentPayload.elements || []).length === 0);
      } catch (err) {
        setElements([]);
        setNewNodeIds([]);
        setCurrentChapterData({ characters: [] });
        setEventNum(0);
        setIsDataEmpty(true);
        setError(
          err?.message
            ? `그래프 데이터를 불러오는 중 오류가 발생했습니다: ${err.message}`
            : '그래프 데이터를 불러오는 중 오류가 발생했습니다.'
        );
      }
    },
    [buildGraphPayload, getChapterEvents, resetState]
  );

  useEffect(() => {
    if (!numericBookId || !chapterIdx) {
      setLoading(false);
      setIsDataEmpty(true);
      resetState();
      return;
    }

    let cancelled = false;
    setError(null);
    setIsDataEmpty(false);
    setLoading(true);

    loadData(numericBookId, chapterIdx, eventIdx).finally(() => {
      if (!cancelled) {
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
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