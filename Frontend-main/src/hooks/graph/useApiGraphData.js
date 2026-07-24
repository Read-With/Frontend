/** book-scope 그래프 API·manifest·POV·관계 타임라인 (RelationGraph 전용) */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getBookScopeRelationshipGraph } from '../../utils/api/graphApi.js';
import {
  getChapterPovSummaries,
  normalizeChapterPovSummariesResult,
} from '../../utils/api/booksApi';
import {
  loadGraphDataWithCache,
  hasMacroGraphStorageCache,
  hasMacroSessionCache,
  prefetchMacroGraphToCache,
  padSingleEvent,
  fetchRelationTimelineCumulative,
  fetchRelationTimelineViewer,
  FETCH_STATUS,
  GRAPH_LOAD_SOURCE,
} from '../../utils/graph/graphFetch';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';
import { toPositiveNumberOrNull, toPositiveInt } from '../../utils/common/valueUtils';
import {
  useErrorHandler,
  useManifestLoaded,
  useAsyncRequestGuard,
} from '../common/hooksShared';
import { cacheKeyUtils } from '../../utils/viewer/viewerCore';
import { enrichGraphPayload } from '../../utils/graph/graphCore';

const ERROR_DISPLAY_DURATION = 5000;
const FALLBACK_NOTICE_DURATION = 8000;

export function useApiGraphData(serverBookId, currentChapter) {
  const {
    loaded: manifestLoaded,
    ready: manifestReady,
    manifest: manifestData,
    error: manifestLoadError,
  } = useManifestLoaded(serverBookId);
  const [apiBookGraphData, setApiBookGraphData] = useState(null);
  const [fallbackNotice, setFallbackNotice] = useState(null);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();
  const prevBookIdRef = useRef(undefined);
  const loadedGraphKeyRef = useRef(null);

  // manifest 없을 때 fallback:1로 잘못된 챕터 API를 치지 않음
  const apiMaxChapter = useMemo(
    () => getMaxChapter(serverBookId, manifestData, { fallback: 0 }),
    [serverBookId, manifestData]
  );

  const clearError = useCallback(() => setApiError(null), []);
  const clearFallbackNotice = useCallback(() => setFallbackNotice(null), []);

  useEffect(() => {
    if (!serverBookId || !manifestLoaded) return;
    if (manifestLoadError && !manifestReady) {
      setApiError(
        handleError(manifestLoadError, 'Manifest 로드 중 오류', {
          metadata: { bookId: serverBookId },
        })
      );
      return;
    }
    if (manifestData) {
      setApiError(null);
    }
  }, [
    serverBookId,
    manifestLoaded,
    manifestReady,
    manifestLoadError,
    manifestData,
    handleError,
  ]);

  useEffect(() => {
    const bookChanged = prevBookIdRef.current !== serverBookId;
    prevBookIdRef.current = serverBookId;

    if (bookChanged) {
      setApiBookGraphData(null);
      setUserCurrentChapter(null);
      setFallbackNotice(null);
      loadedGraphKeyRef.current = null;
      return;
    }

    if (!serverBookId) return;

    if (!hasMacroSessionCache(serverBookId, currentChapter)) {
      setApiBookGraphData(null);
    }
  }, [serverBookId, currentChapter]);

  const loadMacroGraphData = useCallback(async () => {
    const chapter = toPositiveInt(currentChapter);
    if (!serverBookId || !manifestReady || chapter == null || apiMaxChapter < 1) {
      setIsGraphLoading(false);
      return;
    }
    if (chapter > apiMaxChapter) {
      setIsGraphLoading(false);
      return;
    }

    const requestId = nextRequestId();
    const targetBookId = serverBookId;
    const graphKey = `${targetBookId}:${chapter}`;
    let loadingKickTimer = null;

    if (loadedGraphKeyRef.current === graphKey && hasMacroSessionCache(targetBookId, chapter)) {
      setIsGraphLoading(false);
      return;
    }

    const fail = (error, message, metadata) => {
      if (isStale(requestId)) return;
      loadedGraphKeyRef.current = null;
      setApiBookGraphData(null);
      setFallbackNotice(null);
      setApiError(handleError(error, message, { metadata }));
    };

    if (hasMacroGraphStorageCache(targetBookId, chapter)) {
      loadingKickTimer = globalThis.setTimeout(() => {
        if (!isStale(requestId)) setIsGraphLoading(true);
      }, 40);
    } else {
      setIsGraphLoading(true);
    }

    try {
      await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter,
        eventIdx: null,
        cacheKey: cacheKeyUtils.macroGraphStorage(targetBookId, chapter),
        apiCall: () => getBookScopeRelationshipGraph(targetBookId, chapter),
        onSuccess: (data, meta = {}) => {
          if (isStale(requestId)) return;
          setApiError(null);
          setApiBookGraphData(enrichGraphPayload(data, targetBookId));
          loadedGraphKeyRef.current = graphKey;
          const source = meta.source ?? GRAPH_LOAD_SOURCE.API;
          const status = meta.status ?? FETCH_STATUS.OK;
          if (status === FETCH_STATUS.FALLBACK || source === GRAPH_LOAD_SOURCE.FALLBACK) {
            setFallbackNotice({
              message: '캐시된 그래프 데이터를 표시합니다. 최신 정보가 아닐 수 있습니다.',
              timestamp: Date.now(),
            });
          } else {
            setFallbackNotice(null);
          }
          if (data.userCurrentChapter !== undefined) {
            setUserCurrentChapter(data.userCurrentChapter);
          }
        },
        onError: (error) => {
          fail(error, '책 범위 관계 그래프 로드 실패', {
            bookId: targetBookId,
            uptoChapter: chapter,
          });
        },
      });
    } catch (error) {
      fail(error, '책 범위 관계 그래프 로드 중 예외', { bookId: targetBookId });
    } finally {
      if (loadingKickTimer != null) globalThis.clearTimeout(loadingKickTimer);
      if (!isStale(requestId)) setIsGraphLoading(false);
    }
  }, [
    serverBookId,
    currentChapter,
    manifestReady,
    apiMaxChapter,
    handleError,
    nextRequestId,
    isStale,
  ]);

  useEffect(() => {
    loadMacroGraphData();
    return () => {
      invalidate();
    };
  }, [loadMacroGraphData, invalidate]);

  useEffect(() => {
    if (!serverBookId || !apiBookGraphData || apiMaxChapter <= 1) return;
    const chapter = toPositiveInt(currentChapter);
    if (chapter == null) return;
    const nextCh = chapter + 1;
    if (nextCh > apiMaxChapter || hasMacroSessionCache(serverBookId, nextCh)) return;
    prefetchMacroGraphToCache(serverBookId, nextCh, () =>
      getBookScopeRelationshipGraph(serverBookId, nextCh)
    );
  }, [serverBookId, currentChapter, apiBookGraphData, apiMaxChapter]);

  useEffect(() => {
    if (!apiError?.timestamp) return undefined;
    const timeout = setTimeout(clearError, ERROR_DISPLAY_DURATION);
    return () => clearTimeout(timeout);
  }, [apiError, clearError]);

  useEffect(() => {
    if (!fallbackNotice?.timestamp) return undefined;
    const timeout = setTimeout(clearFallbackNotice, FALLBACK_NOTICE_DURATION);
    return () => clearTimeout(timeout);
  }, [fallbackNotice, clearFallbackNotice]);

  return {
    manifest: {
      data: manifestData,
      loaded: manifestLoaded,
      ready: manifestReady,
    },
    graph: {
      data: apiBookGraphData,
      maxChapter: apiMaxChapter,
      userCurrentChapter,
      isLoading: isGraphLoading,
    },
    error: apiError,
    fallbackNotice,
    clearError,
    clearFallbackNotice,
    retryGraph: loadMacroGraphData,
  };
}

export function useChapterPovSummaries(bookId, chapterIdx) {
  const [povSummaries, setPovSummaries] = useState(null);
  const [error, setError] = useState(null);
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();

  const fetchSummaries = useCallback(async () => {
    const bid = toPositiveNumberOrNull(bookId);
    const ch = toPositiveInt(chapterIdx);
    if (bid == null || ch == null) {
      setPovSummaries(null);
      setError(null);
      return;
    }

    const requestId = nextRequestId();
    setError(null);

    try {
      const response = await getChapterPovSummaries(bid, ch);
      if (isStale(requestId)) return;

      if (response.isSuccess) {
        setPovSummaries(normalizeChapterPovSummariesResult(response.result));
        setError(null);
      } else {
        setPovSummaries(null);
        setError(response.message || 'POV 요약을 불러오지 못했습니다.');
      }
    } catch (err) {
      if (isStale(requestId)) return;
      setPovSummaries(null);
      setError(err?.message || 'POV 요약을 불러오는 중 오류가 발생했습니다.');
    }
  }, [bookId, chapterIdx, nextRequestId, isStale]);

  useEffect(() => {
    void fetchSummaries();
    return () => {
      invalidate();
    };
  }, [fetchSummaries, invalidate]);

  const retry = useCallback(() => {
    void fetchSummaries();
  }, [fetchSummaries]);

  return { povSummaries, error, retry };
}

function buildRelationFetchKey(mode, bookId, id1, id2, chapterNum, eventNum) {
  return `${mode}:${bookId}:${id1}:${id2}:${chapterNum}:${eventNum ?? ''}`;
}

export function useRelationData(mode, id1, id2, chapterNum, eventNum, bookId = null) {
  const [timeline, setTimeline] = useState([]);
  const [labels, setLabels] = useState([]);
  const [loading, setLoading] = useState(false);
  const [noRelation, setNoRelation] = useState(false);
  const [error, setError] = useState(null);
  const [incomplete, setIncomplete] = useState(false);
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();
  const lastSuccessKeyRef = useRef('');

  const numericBookId = useMemo(() => toPositiveNumberOrNull(bookId), [bookId]);
  const numericChapter = useMemo(() => toPositiveInt(chapterNum), [chapterNum]);

  const resetError = useCallback((message, { bumpRequest = true } = {}) => {
    if (bumpRequest) invalidate();
    lastSuccessKeyRef.current = '';
    setTimeline([]);
    setLabels([]);
    setNoRelation(false);
    setIncomplete(false);
    setError(message);
    setLoading(false);
  }, [invalidate]);

  const resetEmpty = useCallback((message, { bumpRequest = true } = {}) => {
    if (bumpRequest) invalidate();
    lastSuccessKeyRef.current = '';
    setTimeline([]);
    setLabels([]);
    setNoRelation(true);
    setIncomplete(false);
    setError(message || null);
    setLoading(false);
  }, [invalidate]);

  const fetchData = useCallback(async (options = {}) => {
    const force = options?.force === true;

    if (!numericBookId || !id1 || !id2 || numericChapter == null) {
      resetEmpty('관계 타임라인을 불러올 수 없습니다.');
      return;
    }

    const normalizedEvent = toPositiveInt(eventNum, 1);
    const fetchKey = buildRelationFetchKey(
      mode,
      numericBookId,
      id1,
      id2,
      numericChapter,
      normalizedEvent
    );

    if (!force && lastSuccessKeyRef.current === fetchKey) {
      return;
    }

    const requestId = nextRequestId();
    setLoading(true);
    setError(null);
    setIncomplete(false);

    try {
      const result =
        mode === 'cumulative'
          ? await fetchRelationTimelineCumulative(numericBookId, id1, id2, numericChapter)
          : await fetchRelationTimelineViewer(
              numericBookId,
              id1,
              id2,
              numericChapter,
              normalizedEvent
            );

      if (isStale(requestId)) return;

      if (result?.status === FETCH_STATUS.ERROR) {
        resetError(
          result.error?.message || '관계 데이터를 불러오는 중 오류가 발생했습니다.',
          { bumpRequest: false }
        );
        return;
      }

      const { points, labelInfo, noRelation: resultNoRelation } = result;
      const { points: paddedPoints, labels: paddedLabels } = padSingleEvent(points, labelInfo);
      const emptyPoints = paddedPoints.filter((value) => value !== null).length === 0;

      setTimeline(paddedPoints);
      setLabels(paddedLabels);
      setNoRelation(Boolean(resultNoRelation) || emptyPoints);
      setIncomplete(Boolean(result.incomplete));
      setError(null);
      lastSuccessKeyRef.current = fetchKey;
    } catch {
      if (isStale(requestId)) return;
      resetError('관계 데이터를 불러오는 중 오류가 발생했습니다.', { bumpRequest: false });
    } finally {
      if (!isStale(requestId)) setLoading(false);
    }
  }, [
    numericBookId,
    id1,
    id2,
    numericChapter,
    eventNum,
    mode,
    resetEmpty,
    resetError,
    nextRequestId,
    isStale,
  ]);

  useEffect(() => {
    void fetchData();
    return () => {
      invalidate();
    };
  }, [fetchData, invalidate]);

  const retryFetch = useCallback(() => fetchData({ force: true }), [fetchData]);

  return useMemo(
    () => ({
      timeline,
      labels,
      loading,
      noRelation,
      error,
      incomplete,
      fetchData: retryFetch,
    }),
    [timeline, labels, loading, noRelation, error, incomplete, retryFetch]
  );
}
