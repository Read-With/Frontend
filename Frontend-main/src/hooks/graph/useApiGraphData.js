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
} from '../../utils/graph/graphFetch';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';
import { toPositiveNumberOrNull, toPositiveInt } from '../../utils/common/valueUtils';
import {
  useErrorHandler,
  useManifestLoaded,
  useAsyncRequestGuard,
} from '../common/hooksShared';
import { cacheKeyUtils } from '../../utils/viewer/viewerCore';

const ERROR_DISPLAY_DURATION = 5000;

export function useApiGraphData(serverBookId, currentChapter) {
  const {
    loaded: manifestReady,
    manifest: manifestData,
    error: manifestLoadError,
  } = useManifestLoaded(serverBookId);
  const [apiBookGraphData, setApiBookGraphData] = useState(null);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();
  const prevBookIdRef = useRef(undefined);
  const loadedGraphKeyRef = useRef(null);

  const apiMaxChapter = useMemo(
    () => getMaxChapter(serverBookId, manifestData, { fallback: 1 }),
    [serverBookId, manifestData]
  );

  const clearError = useCallback(() => setApiError(null), []);

  useEffect(() => {
    if (!serverBookId || !manifestReady) return;
    if (manifestLoadError) {
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
  }, [serverBookId, manifestReady, manifestLoadError, manifestData, handleError]);

  // book 전환 → 전체 리셋 / chapter 전환 → 세션 캐시 없으면 그래프만 비움
  useEffect(() => {
    const bookChanged = prevBookIdRef.current !== serverBookId;
    prevBookIdRef.current = serverBookId;

    if (bookChanged) {
      setApiBookGraphData(null);
      setUserCurrentChapter(null);
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
    if (!serverBookId || !manifestReady || chapter == null) {
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
        onSuccess: (data) => {
          if (isStale(requestId)) return;
          setApiError(null);
          setApiBookGraphData(data);
          loadedGraphKeyRef.current = graphKey;
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
  }, [serverBookId, currentChapter, manifestReady, handleError, nextRequestId, isStale]);

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

  return {
    manifest: {
      data: manifestData,
      ready: manifestReady,
    },
    graph: {
      data: apiBookGraphData,
      maxChapter: apiMaxChapter,
      userCurrentChapter,
      isLoading: isGraphLoading,
    },
    error: apiError,
    clearError,
  };
}

export function useChapterPovSummaries(bookId, chapterIdx) {
  const [povSummaries, setPovSummaries] = useState(null);
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();

  useEffect(() => {
    const bid = toPositiveNumberOrNull(bookId);
    const ch = toPositiveInt(chapterIdx);
    if (bid == null || ch == null) {
      setPovSummaries(null);
      return undefined;
    }

    const requestId = nextRequestId();

    const fetchSummaries = async () => {
      try {
        const response = await getChapterPovSummaries(bid, ch);
        if (isStale(requestId)) return;

        if (response.isSuccess) {
          setPovSummaries(normalizeChapterPovSummariesResult(response.result));
        } else {
          setPovSummaries(null);
        }
      } catch {
        if (isStale(requestId)) return;
        setPovSummaries(null);
      }
    };

    void fetchSummaries();

    return () => {
      invalidate();
    };
  }, [bookId, chapterIdx, nextRequestId, isStale, invalidate]);

  return { povSummaries };
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
  const { nextRequestId, isStale, invalidate } = useAsyncRequestGuard();
  const lastSuccessKeyRef = useRef('');

  const numericBookId = useMemo(() => toPositiveNumberOrNull(bookId), [bookId]);
  const numericChapter = useMemo(() => toPositiveInt(chapterNum), [chapterNum]);

  const resetEmpty = useCallback((message, { bumpRequest = true } = {}) => {
    if (bumpRequest) invalidate();
    lastSuccessKeyRef.current = '';
    setTimeline([]);
    setLabels([]);
    setNoRelation(true);
    setError(message);
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

      const { points, labelInfo, noRelation: resultNoRelation } = result;
      const { points: paddedPoints, labels: paddedLabels } = padSingleEvent(points, labelInfo);

      setTimeline(paddedPoints);
      setLabels(paddedLabels);
      setNoRelation(resultNoRelation || paddedPoints.filter((value) => value !== null).length === 0);
      lastSuccessKeyRef.current = fetchKey;
    } catch {
      if (isStale(requestId)) return;
      resetEmpty('관계 데이터를 불러오는 중 오류가 발생했습니다.', { bumpRequest: false });
    } finally {
      if (!isStale(requestId)) setLoading(false);
    }
  }, [numericBookId, id1, id2, numericChapter, eventNum, mode, resetEmpty, nextRequestId, isStale]);

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
      fetchData: retryFetch,
    }),
    [timeline, labels, loading, noRelation, error, retryFetch]
  );
}
