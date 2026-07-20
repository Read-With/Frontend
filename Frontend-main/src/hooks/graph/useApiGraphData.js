/** book-scope 그래프 API·manifest·POV·관계 타임라인 (RelationGraph 전용) */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getBookScopeRelationshipGraph } from '../../utils/api/api.js';
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
} from '../../utils/graph/graphData';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';
import { toPositiveNumberOrNull } from '../../utils/common/valueUtils';
import { useErrorHandler, ensureBookManifest } from '../common/hooksShared';
import { cacheKeyUtils } from '../../utils/viewer/viewerCoreStateUtils';

const ERROR_DISPLAY_DURATION = 5000;
const povInflight = new Map();

function fetchChapterPovSummariesOnce(bid, ch) {
  const key = `${bid}:${ch}`;
  const existing = povInflight.get(key);
  if (existing) return existing;

  const pending = getChapterPovSummaries(bid, ch).finally(() => {
    if (povInflight.get(key) === pending) {
      povInflight.delete(key);
    }
  });
  povInflight.set(key, pending);
  return pending;
}

export function useApiGraphData(serverBookId, currentChapter) {
  const [manifestData, setManifestData] = useState(null);
  const [manifestReady, setManifestReady] = useState(false);
  const [apiBookGraphData, setApiBookGraphData] = useState(null);
  const [apiMaxChapter, setApiMaxChapter] = useState(1);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);
  const macroRequestIdRef = useRef(0);
  const manifestRequestIdRef = useRef(0);
  const prevBookIdRef = useRef(undefined);
  const loadedGraphKeyRef = useRef(null);

  const clearError = useCallback(() => setApiError(null), []);

  const loadManifestData = useCallback(async () => {
    if (!serverBookId) {
      manifestRequestIdRef.current += 1;
      setManifestData(null);
      setManifestReady(true);
      return;
    }

    const requestId = ++manifestRequestIdRef.current;
    const targetBookId = serverBookId;
    setManifestReady(false);
    const initialMaxChapter = getMaxChapter(targetBookId, null, { fallback: 1 });

    const outcome = await ensureBookManifest(targetBookId);
    if (requestId !== manifestRequestIdRef.current) return;

    if (outcome.manifest) {
      setManifestData(outcome.manifest);
      setApiMaxChapter(getMaxChapter(targetBookId, outcome.manifest, { fallback: 1 }));
      setApiError(null);
    } else if (!outcome.ok && !outcome.skipped) {
      // skipped: 다른 경로에서 이미 로드 중이거나 불필요 — silent
      setApiMaxChapter(initialMaxChapter);
      const error =
        outcome.error ??
        Object.assign(new Error('Manifest 로드 실패'), {
          status: outcome.response?.code || null,
        });
      setApiError(
        handleError(error, outcome.error ? 'Manifest 로드 중 오류' : 'Manifest API 응답 실패', {
          metadata: outcome.error
            ? { bookId: targetBookId }
            : { bookId: targetBookId, response: outcome.response },
        })
      );
    }

    setManifestReady(true);
  }, [serverBookId, handleError]);

  // book 전환 → 전체 리셋 / chapter 전환 → 세션 캐시 없으면 그래프만 비움
  // manifestReady는 loadManifestData만 관리
  useEffect(() => {
    const bookChanged = prevBookIdRef.current !== serverBookId;
    prevBookIdRef.current = serverBookId;

    if (bookChanged) {
      setApiBookGraphData(null);
      setUserCurrentChapter(null);
      setManifestData(null);
      loadedGraphKeyRef.current = null;
      return;
    }

    if (!serverBookId) return;

    if (!hasMacroSessionCache(serverBookId, currentChapter)) {
      setApiBookGraphData(null);
    }
  }, [serverBookId, currentChapter]);

  const loadMacroGraphData = useCallback(async () => {
    const chapter = Number(currentChapter);
    if (!serverBookId || !Number.isFinite(chapter) || chapter < 1) {
      setIsGraphLoading(false);
      return;
    }

    const requestId = ++macroRequestIdRef.current;
    const targetBookId = serverBookId;
    const graphKey = `${targetBookId}:${chapter}`;
    let loadingKickTimer = null;

    // 동일 챕터를 이미 로드했고 세션 캐시가 있으면 네트워크/로더 재진입 생략
    if (loadedGraphKeyRef.current === graphKey && hasMacroSessionCache(targetBookId, chapter)) {
      setIsGraphLoading(false);
      return;
    }

    const fail = (error, message, metadata) => {
      if (requestId !== macroRequestIdRef.current) return;
      loadedGraphKeyRef.current = null;
      setApiBookGraphData(null);
      setApiError(handleError(error, message, { metadata }));
    };

    if (hasMacroGraphStorageCache(targetBookId, chapter)) {
      loadingKickTimer = globalThis.setTimeout(() => {
        if (requestId === macroRequestIdRef.current) setIsGraphLoading(true);
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
          if (requestId !== macroRequestIdRef.current) return;
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
      if (requestId === macroRequestIdRef.current) setIsGraphLoading(false);
    }
  }, [serverBookId, currentChapter, handleError]);

  useEffect(() => {
    loadManifestData();
    return () => {
      manifestRequestIdRef.current += 1;
    };
  }, [loadManifestData]);

  useEffect(() => {
    loadMacroGraphData();
    return () => {
      macroRequestIdRef.current += 1;
    };
  }, [loadMacroGraphData]);

  useEffect(() => {
    if (!serverBookId || !apiBookGraphData || apiMaxChapter <= 1) return;
    const nextCh = Number(currentChapter) + 1;
    if (nextCh > apiMaxChapter || hasMacroSessionCache(serverBookId, nextCh)) return;
    prefetchMacroGraphToCache(serverBookId, nextCh, () =>
      getBookScopeRelationshipGraph(serverBookId, nextCh)
    );
  }, [serverBookId, currentChapter, apiBookGraphData, apiMaxChapter]);

  // Toast onClose(clearError) + 자동 해제
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
  const [error, setError] = useState(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const bid = Number(bookId);
    const ch = Number(chapterIdx);
    if (!Number.isFinite(bid) || bid < 1 || !Number.isFinite(ch) || ch < 1) {
      setPovSummaries(null);
      setError(null);
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    setError(null);

    const fetchSummaries = async () => {
      try {
        const response = await fetchChapterPovSummariesOnce(bid, ch);
        if (requestId !== requestIdRef.current) return;

        if (response.isSuccess) {
          setPovSummaries(normalizeChapterPovSummariesResult(response.result));
          setError(null);
        } else {
          setPovSummaries(null);
          setError(response.message || 'POV 요약을 불러오지 못했습니다.');
        }
      } catch (err) {
        if (requestId !== requestIdRef.current) return;
        setPovSummaries(null);
        setError(err?.message || 'POV 요약을 불러오는 중 오류가 발생했습니다.');
      }
    };

    void fetchSummaries();

    return () => {
      requestIdRef.current += 1;
    };
  }, [bookId, chapterIdx]);

  return { povSummaries, error };
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
  const requestIdRef = useRef(0);
  const lastSuccessKeyRef = useRef('');

  const numericBookId = useMemo(() => toPositiveNumberOrNull(bookId), [bookId]);

  const resetEmpty = useCallback((message, { bumpRequest = true } = {}) => {
    if (bumpRequest) requestIdRef.current += 1;
    lastSuccessKeyRef.current = '';
    setTimeline([]);
    setLabels([]);
    setNoRelation(true);
    setError(message);
    setLoading(false);
  }, []);

  const fetchData = useCallback(async (options = {}) => {
    const force = options?.force === true;

    if (!numericBookId || !id1 || !id2 || !chapterNum) {
      resetEmpty('관계 타임라인을 불러올 수 없습니다.');
      return;
    }

    const normalizedEvent = eventNum ? Math.max(1, eventNum) : 1;
    const fetchKey = buildRelationFetchKey(
      mode,
      numericBookId,
      id1,
      id2,
      chapterNum,
      normalizedEvent
    );

    if (!force && lastSuccessKeyRef.current === fetchKey) {
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    try {
      const result =
        mode === 'cumulative'
          ? await fetchRelationTimelineCumulative(numericBookId, id1, id2, chapterNum)
          : await fetchRelationTimelineViewer(
              numericBookId,
              id1,
              id2,
              chapterNum,
              normalizedEvent
            );

      if (requestId !== requestIdRef.current) return;

      const { points, labelInfo, noRelation: resultNoRelation } = result;
      const { points: paddedPoints, labels: paddedLabels } = padSingleEvent(points, labelInfo);

      setTimeline(paddedPoints);
      setLabels(paddedLabels);
      setNoRelation(resultNoRelation || paddedPoints.filter((value) => value !== null).length === 0);
      lastSuccessKeyRef.current = fetchKey;
    } catch {
      if (requestId !== requestIdRef.current) return;
      resetEmpty('관계 데이터를 불러오는 중 오류가 발생했습니다.', { bumpRequest: false });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [numericBookId, id1, id2, chapterNum, eventNum, mode, resetEmpty]);

  useEffect(() => {
    void fetchData();
    return () => {
      requestIdRef.current += 1;
    };
  }, [fetchData]);

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
