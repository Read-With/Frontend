import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getFineGraph } from '../../utils/api/api';
import { getGraphEventState, getCachedChapterEvents } from '../../utils/common/cache/chapterEventCache';
import { buildNodeWeights, createCharacterMaps } from '../../utils/graph/characterUtils';
import { convertRelationsToElements } from '../../utils/graph/graphDataUtils';
import {
  cacheKeyUtils,
  eventUtils,
  graphDataCacheUtils,
  graphDataTransformUtils,
} from '../../utils/viewer/viewerUtils';
import { resolveServerEventMatch } from '../../utils/viewer/serverEventMatcher';

function buildFallbackElementsFromRelations(relationsInput) {
  const relations = Array.isArray(relationsInput) ? relationsInput : [];
  if (relations.length === 0) return [];

  const nodeIds = new Set();
  relations.forEach((rel) => {
    const source = rel?.source ?? rel?.id1;
    const target = rel?.target ?? rel?.id2;
    if (source != null && String(source).trim() !== '') nodeIds.add(String(source));
    if (target != null && String(target).trim() !== '') nodeIds.add(String(target));
  });

  const nodes = Array.from(nodeIds).map((id) => ({
    data: { id, label: id, name: id },
  }));

  const edges = relations
    .map((rel, idx) => {
      const source = rel?.source ?? rel?.id1;
      const target = rel?.target ?? rel?.id2;
      if (source == null || target == null) return null;
      const s = String(source).trim();
      const t = String(target).trim();
      if (!s || !t) return null;
      const relationArr = Array.isArray(rel?.relation)
        ? rel.relation
        : rel?.relation != null && rel?.relation !== ''
          ? [rel.relation]
          : [];
      const label = String(rel?.label ?? rel?.type ?? relationArr[0] ?? '').trim();
      return {
        data: {
          id: `${s}-${t}-${idx}`,
          source: s,
          target: t,
          relation: relationArr,
          label,
          count: Number(rel?.count ?? 1) || 1,
          positivity: Number(rel?.positivity ?? 0) || 0,
        },
      };
    })
    .filter(Boolean);

  return [...nodes, ...edges];
}

export function useFineGraphLoader({
  book,
  currentChapter,
  currentEvent,
  graphActions,
  manifestLoaded,
  setElements,
  setEvents,
  setFineGraphLoading,
  setIsDataReady,
  setLoading,
  resetTransition,
}) {
  const [apiError, setApiError] = useState(null);
  const apiEventCacheRef = useRef(new Map());
  const apiCallRef = useRef(null);
  const fineGraphDebounceTimerRef = useRef(null);
  const fineGraphLoadKickTimerRef = useRef(null);
  const initialGraphEventLoadedRef = useRef(false);
  const setElementsRef = useRef(setElements);
  const previousGraphDataRef = useRef({ elements: [], eventIdx: 0, chapterIdx: 0 });
  const retryTimeoutRef = useRef(null);

  const clearRetryTimeout = useCallback(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const clearFineGraphDebounceTimer = useCallback(() => {
    if (fineGraphDebounceTimerRef.current) {
      globalThis.clearTimeout(fineGraphDebounceTimerRef.current);
      fineGraphDebounceTimerRef.current = null;
    }
  }, []);

  const updateLoadingState = useCallback((isReady, isLoading, error = null, shouldResetTransition = true) => {
    setIsDataReady(isReady);
    setLoading(isLoading);
    if (shouldResetTransition) resetTransition();
    setApiError(error);
  }, [resetTransition, setIsDataReady, setLoading]);

  const clearGraphElements = useCallback((eventIdx, chapterIdx) => {
    eventUtils.updateGraphDataRef(previousGraphDataRef, [], eventIdx || 0, chapterIdx || 0);
    setElementsRef.current([]);
  }, []);

  const isFineGraphCacheWarm = useCallback((numericBookId, chapter, apiEventIdx) => {
    if (!numericBookId || !chapter || apiEventIdx < 1) return false;
    if (getGraphEventState(numericBookId, chapter, apiEventIdx)) return true;
    const ck = cacheKeyUtils.createCacheKey(chapter, apiEventIdx);
    return Boolean(apiEventCacheRef.current?.get(ck));
  }, []);

  const triggerGraphRetry = useCallback((resetInitialGraphEvent = false) => {
    clearRetryTimeout();
    setApiError(null);
    apiCallRef.current = null;
    if (resetInitialGraphEvent) {
      initialGraphEventLoadedRef.current = false;
    }
    setLoading((prev) => !prev);
  }, [clearRetryTimeout, setLoading]);

  const buildGraphLoadError = useCallback((details, retryHandler) => ({
    message: '그래프 데이터를 불러오지 못했습니다.',
    details,
    retry: retryHandler,
  }), []);

  const resetGraphOnNotFound = useCallback(() => {
    clearGraphElements(0, currentChapter);
    updateLoadingState(true, false);
  }, [clearGraphElements, currentChapter, updateLoadingState]);

  const resolveFineGraphCallContext = useCallback(() => {
    const match = resolveServerEventMatch({
      book,
      currentChapter,
      event: currentEvent,
      eventUtils,
    });
    const numericBookId = Number(match.bookId);
    const apiEventIdx = Number(match.eventIdx ?? 0);
    if (!numericBookId || !currentChapter) return null;
    const callKey = cacheKeyUtils.createEventKey(numericBookId, currentChapter, apiEventIdx);
    return { numericBookId, apiEventIdx, callKey };
  }, [book, currentChapter, currentEvent]);

  useEffect(() => {
    apiEventCacheRef.current.clear();
  }, [book?.id, currentChapter]);

  useEffect(() => {
    setElementsRef.current = setElements;
  }, [setElements]);

  useEffect(() => {
    initialGraphEventLoadedRef.current = false;
    apiCallRef.current = null;
    setApiError(null);
  }, [book?.id]);

  useEffect(() => {
    apiCallRef.current = null;
  }, [book?.id, currentChapter]);

  useEffect(() => {
    const apiEventCache = apiEventCacheRef.current;
    return () => {
      clearRetryTimeout();
      clearFineGraphDebounceTimer();
      apiEventCache.clear();
    };
  }, [clearRetryTimeout, clearFineGraphDebounceTimer]);

  useLayoutEffect(() => {
    if (!manifestLoaded) return;
    const ctx = resolveFineGraphCallContext();
    if (!ctx || ctx.apiEventIdx < 1) return;
    if (ctx.callKey !== apiCallRef.current) {
      if (!isFineGraphCacheWarm(ctx.numericBookId, currentChapter, ctx.apiEventIdx)) {
        setFineGraphLoading(true);
      }
    }
  }, [currentChapter, isFineGraphCacheWarm, manifestLoaded, resolveFineGraphCallContext, setFineGraphLoading]);

  useEffect(() => {
    let isMounted = true;

    const loadGraphData = async () => {
      if (!manifestLoaded) return;

      const ctx = resolveFineGraphCallContext();
      if (!ctx) return;

      const { numericBookId, apiEventIdx, callKey } = ctx;
      if (!numericBookId || !currentChapter || apiEventIdx < 1) {
        updateLoadingState(true, false);
        return;
      }

      if (apiCallRef.current === callKey) return;

      if (fineGraphLoadKickTimerRef.current) {
        globalThis.clearTimeout(fineGraphLoadKickTimerRef.current);
        fineGraphLoadKickTimerRef.current = null;
      }
      clearFineGraphDebounceTimer();
      fineGraphDebounceTimerRef.current = globalThis.setTimeout(async () => {
        if (!isMounted) return;

        apiCallRef.current = callKey;
        const warmFg = isFineGraphCacheWarm(numericBookId, currentChapter, apiEventIdx);
        if (warmFg) {
          fineGraphLoadKickTimerRef.current = globalThis.setTimeout(() => {
            fineGraphLoadKickTimerRef.current = null;
            if (isMounted && apiCallRef.current === callKey) setFineGraphLoading(true);
          }, 40);
        } else {
          setFineGraphLoading(true);
        }

        try {
          const chapterEventApiKey = cacheKeyUtils.createEventKey(numericBookId, currentChapter, apiEventIdx);
          const hasCalledApiForEvent = initialGraphEventLoadedRef.current === chapterEventApiKey;
          if (!hasCalledApiForEvent) {
            initialGraphEventLoadedRef.current = chapterEventApiKey;
          }

          const { resultData, usedCache } = await graphDataCacheUtils.getGraphDataFromApiOrCache(
            numericBookId,
            currentChapter,
            apiEventIdx,
            getFineGraph,
            getGraphEventState,
            eventUtils,
            apiEventCacheRef,
            hasCalledApiForEvent,
            null,
            undefined
          );

          if (!isMounted || apiCallRef.current !== callKey) {
            if (!isMounted) {
              apiCallRef.current = null;
              initialGraphEventLoadedRef.current = false;
            }
            return;
          }

          const cacheKey = cacheKeyUtils.createCacheKey(currentChapter, apiEventIdx);
          const hasCacheElements = Array.isArray(resultData?.elements) && resultData.elements.length > 0;
          const hasApiRelations = Array.isArray(resultData?.relations) && resultData.relations.length > 0;
          const hasApiCharacters = Array.isArray(resultData?.characters) && resultData.characters.length > 0;
          const hasGraphData = hasCacheElements || hasApiRelations || hasApiCharacters;

          if (!hasGraphData) {
            const chapterPayload = getCachedChapterEvents(numericBookId, currentChapter);
            const chapterEvents = Array.isArray(chapterPayload?.events) ? chapterPayload.events : [];
            const resolveEvtIdx = (evt) =>
              Number(evt?.eventNum ?? evt?.idx ?? evt?.eventIdx ?? evt?.event?.eventNum ?? 0);
            const matchedEvent = chapterEvents.find((evt) => resolveEvtIdx(evt) === apiEventIdx);
            const directRelations = Array.isArray(matchedEvent?.relations) ? matchedEvent.relations : [];
            const fallbackFromCache = buildFallbackElementsFromRelations(directRelations);
            if (fallbackFromCache.length > 0 && isMounted) {
              eventUtils.updateGraphDataRef(previousGraphDataRef, fallbackFromCache, apiEventIdx, currentChapter);
              setElementsRef.current(fallbackFromCache);
              if (graphActions.setIsDataEmpty) graphActions.setIsDataEmpty(false);
              updateLoadingState(true, false);
              return;
            }

            clearGraphElements(apiEventIdx, currentChapter);
            updateLoadingState(true, false);
            return;
          }

          apiEventCacheRef.current.set(cacheKey, resultData);

          if (!isMounted || apiCallRef.current !== callKey) return;

          const normalizedEvent = graphDataTransformUtils.normalizeApiEvent(resultData.event);
          const convertedElements = graphDataTransformUtils.convertToElements(
            { ...resultData, relations: resultData.relations || [] },
            usedCache,
            normalizedEvent,
            createCharacterMaps,
            buildNodeWeights,
            convertRelationsToElements
          );

          eventUtils.updateGraphDataRef(previousGraphDataRef, convertedElements, apiEventIdx, currentChapter);
          setElementsRef.current(convertedElements);
          setEvents((prev) => eventUtils.updateEventsInState(
            prev,
            graphDataTransformUtils.createNextEventData(
              normalizedEvent,
              currentChapter,
              apiEventIdx,
              { ...resultData, relations: resultData.relations || [] },
              eventUtils
            ),
            currentChapter
          ));
          if (graphActions.setIsDataEmpty) graphActions.setIsDataEmpty(convertedElements.length === 0);
          updateLoadingState(true, false);
        } catch (error) {
          if (!isMounted) return;
          const status = error?.status;
          const message = error?.message || '';
          const isNotFound = status === 404 || message.includes('404') || message.includes('찾을 수 없습니다');
          if (isNotFound) {
            resetGraphOnNotFound();
          } else {
            setApiError(buildGraphLoadError(
              message || '알 수 없는 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
              () => triggerGraphRetry(true)
            ));
            updateLoadingState(true, false);
          }
        } finally {
          if (fineGraphLoadKickTimerRef.current) {
            globalThis.clearTimeout(fineGraphLoadKickTimerRef.current);
            fineGraphLoadKickTimerRef.current = null;
          }
          if (isMounted) setFineGraphLoading(false);
          fineGraphDebounceTimerRef.current = null;
        }
      }, 120);
    };

    loadGraphData();

    return () => {
      isMounted = false;
      clearRetryTimeout();
      clearFineGraphDebounceTimer();
      if (fineGraphLoadKickTimerRef.current) {
        globalThis.clearTimeout(fineGraphLoadKickTimerRef.current);
        fineGraphLoadKickTimerRef.current = null;
      }
      setFineGraphLoading(false);
    };
  }, [
    buildGraphLoadError,
    clearGraphElements,
    clearFineGraphDebounceTimer,
    clearRetryTimeout,
    currentChapter,
    currentEvent,
    graphActions,
    isFineGraphCacheWarm,
    manifestLoaded,
    resetGraphOnNotFound,
    resolveFineGraphCallContext,
    setEvents,
    setFineGraphLoading,
    triggerGraphRetry,
    updateLoadingState,
  ]);

  return { apiError, setApiError, triggerGraphRetry };
}
