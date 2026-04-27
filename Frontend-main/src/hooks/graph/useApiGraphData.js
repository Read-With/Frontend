import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getMacroGraph, getFineGraph, getBookManifest } from '../../utils/api/api.js';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { resolveMaxChapter } from '../../utils/graph/maxChapterResolver';
import { loadGraphDataWithCache, hasMacroGraphStorageCache, hasMacroSessionCache, prefetchMacroGraphToCache } from '../../utils/graph/graphDataLoader';
import { useErrorHandler } from '../common/useErrorHandler';

const ERROR_DISPLAY_DURATION = 5000;
const resolveFineEventIdx = (currentEvent, forcedChapterEventIdx) => {
  const eventNumValue = Number(currentEvent);
  let eventIdx = Number.isFinite(eventNumValue) && eventNumValue >= 1 ? eventNumValue : 1;
  const forcedIdx = Number(forcedChapterEventIdx);
  const hasForcedIdx = Number.isFinite(forcedIdx) && forcedIdx >= 1;
  if (hasForcedIdx) {
    eventIdx = forcedIdx;
  }
  return { eventIdx, hasForcedIdx };
};

export function useApiGraphData(
  serverBookId,
  currentChapter,
  currentEvent,
  forcedChapterEventIdx = null,
  options = {},
) {
  const { macroOnly = false } = options;
  const [manifestData, setManifestData] = useState(null);
  const [manifestReady, setManifestReady] = useState(false);
  const [fullMacroData, setFullMacroData] = useState(null);
  const [rawFineData, setRawFineData] = useState(null);
  const [apiMaxChapter, setApiMaxChapter] = useState(1);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [apiFineLoading, setApiFineLoading] = useState(false);

  const fineAbortRef = useRef(null);          // AbortController for the in-flight fine graph request
  const prevFineTargetKeyRef = useRef(null);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);

  const resetFineLoadingState = useCallback((clearFineData = false) => {
    isFineGraphLoadingRef.current = false;
    setApiFineLoading(false);
    if (clearFineData) {
      setRawFineData(null);
    }
  }, []);

  const apiFineData = useMemo(() => {
    if (macroOnly) return fullMacroData;
    return rawFineData;
  }, [macroOnly, fullMacroData, rawFineData]);

  const fineTargetKey = useMemo(() => {
    if (!serverBookId) return '';
    const evRaw = Number(currentEvent);
    const ev = Number.isFinite(evRaw) && evRaw >= 1 ? evRaw : 1;
    return `${serverBookId}:${currentChapter}:${ev}`;
  }, [serverBookId, currentChapter, currentEvent]);

  useEffect(() => {
    if (!serverBookId) {
      prevFineTargetKeyRef.current = null;
      return;
    }
    if (!fineTargetKey) return;
    const prevKey = prevFineTargetKeyRef.current;
    if (prevKey === fineTargetKey) return;
    prevFineTargetKeyRef.current = fineTargetKey;
    if (prevKey == null) {
      return; // first load — don't wipe anything
    }
    fineAbortRef.current?.abort();
    resetFineLoadingState(true);
  }, [serverBookId, fineTargetKey, resetFineLoadingState]);

  const loadManifestData = useCallback(async () => {
    if (!serverBookId) {
      setManifestReady(true);
      return;
    }

    const targetBookId = serverBookId;
    setManifestReady(false);

    const initialMaxChapter = resolveMaxChapter(targetBookId, null);

    const cachedManifest = getManifestFromCache(targetBookId);
    if (cachedManifest) {
      setManifestData(cachedManifest);
      const maxChapter = resolveMaxChapter(targetBookId, cachedManifest);
      setApiMaxChapter(maxChapter);
      setManifestReady(true);
      return;
    }

    try {
      const manifestResponse = await getBookManifest(targetBookId);

      if (manifestResponse?.isSuccess && manifestResponse?.result) {
        const uiManifest =
          manifestResponse.fromCache === true
            ? manifestResponse.result
            : (getManifestFromCache(targetBookId) ?? manifestResponse.result);
        setManifestData(uiManifest);
        const maxChapter = resolveMaxChapter(targetBookId, uiManifest);
        setApiMaxChapter(maxChapter);
      } else {
        setApiMaxChapter(initialMaxChapter);
        const manifestError = new Error('Manifest 로드 실패');
        manifestError.status = manifestResponse?.code || null;
        const errorInfo = handleError(manifestError, 'Manifest API 응답 실패', {
          metadata: { bookId: targetBookId, response: manifestResponse },
          autoClear: false,
        });
        setApiError(errorInfo);
      }
    } catch (error) {
      setApiMaxChapter(initialMaxChapter);
      const errorInfo = handleError(error, 'Manifest 로드 중 오류', {
        metadata: { bookId: targetBookId },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      setManifestReady(true);
    }
  }, [serverBookId, handleError]);

  useEffect(() => {
    if (!serverBookId) return;
    setFullMacroData(null);
    setRawFineData(null);
    fineEpochRef.current += 1;
    resetFineLoadingState(false);
  }, [serverBookId, resetFineLoadingState]);

  useEffect(() => {
    if (!serverBookId) return;
    // 세션 캐시가 있으면 clear 스킵 — loadMacroGraphData가 즉시 덮어씀
    if (!hasMacroSessionCache(serverBookId, currentChapter)) {
      setFullMacroData(null);
    }
  }, [serverBookId, currentChapter]);

  const loadMacroGraphData = useCallback(async () => {
    if (!serverBookId) return;
    const chapter = Number(currentChapter);
    if (!Number.isFinite(chapter) || chapter < 1) return;

    const targetBookId = serverBookId;
    let loadingKickTimer = null;
    const warmMacro = hasMacroGraphStorageCache(targetBookId, chapter);
    if (warmMacro) {
      loadingKickTimer = globalThis.setTimeout(() => {
        setIsGraphLoading(true);
      }, 40);
    } else {
      setIsGraphLoading(true);
    }

    try {
      const cacheKey = `graph_macro_${targetBookId}_upto_${chapter}`;
      await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter,
        eventIdx: null,
        cacheKey,
        apiCall: () => getMacroGraph(targetBookId, chapter, null),
        onSuccess: (data) => {
          setFullMacroData(data);
          if (data.userCurrentChapter !== undefined) {
            setUserCurrentChapter(data.userCurrentChapter);
          }
        },
        onError: (error) => {
          setFullMacroData(null);
          const errorInfo = handleError(error, 'Macro Graph 로드 실패', {
            metadata: { bookId: targetBookId, uptoChapter: chapter },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      setFullMacroData(null);
      const errorInfo = handleError(error, 'Macro Graph 로드 중 예외', {
        metadata: { bookId: targetBookId },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      if (loadingKickTimer != null) {
        globalThis.clearTimeout(loadingKickTimer);
      }
      setIsGraphLoading(false);
    }
  }, [serverBookId, currentChapter, handleError]);

  const loadFineGraphData = useCallback(async () => {
    if (macroOnly) {
      resetFineLoadingState(false);
      return;
    }
    if (!serverBookId) {
      resetFineLoadingState(false);
      return;
    }

    const targetBookId = serverBookId;
    const { eventIdx, hasForcedIdx } = resolveFineEventIdx(currentEvent, forcedChapterEventIdx);

    if (eventIdx < 1) {
      resetFineLoadingState(false);
      return;
    }

    // Cancel any previous in-flight request and start a new one.
    fineAbortRef.current?.abort();
    const controller = new AbortController();
    fineAbortRef.current = controller;
    const { signal } = controller;

    setApiFineLoading(true);

    try {
      const cacheKey = `graph_fine_${targetBookId}_${currentChapter}_${eventIdx}`;
      await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter: currentChapter,
        eventIdx,
        cacheKey,
        // 강제 이벤트: locator→이벤트 재해석이 덮어쓰지 않도록 eventIdx 고정 경로만 사용
        apiCall: () =>
          getFineGraph(
            targetBookId,
            currentChapter,
            eventIdx,
            null,
            hasForcedIdx ? { useCallerEventIdxOnly: true } : undefined
          ),
        macroData: null,
        onSuccess: (data) => {
          if (signal.aborted) return;
          setRawFineData(data);
        },
        onError: (error) => {
          if (signal.aborted) return;
          const errorInfo = handleError(error, 'Fine Graph 로드 실패', {
            metadata: { bookId: targetBookId, chapter: currentChapter, eventIdx },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      if (signal.aborted) return;
      const errorInfo = handleError(error, 'Fine Graph 로드 중 예외', {
        metadata: { bookId: targetBookId, chapter: currentChapter, eventIdx },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      if (!signal.aborted) {
        resetFineLoadingState(false);
      }
    }
  }, [
    macroOnly,
    serverBookId,
    currentChapter,
    currentEvent,
    handleError,
    forcedChapterEventIdx,
    resetFineLoadingState,
  ]);

  useEffect(() => {
    loadManifestData();
  }, [loadManifestData]);

  useEffect(() => {
    loadMacroGraphData();
  }, [loadMacroGraphData]);

  useEffect(() => {
    if (macroOnly) {
      resetFineLoadingState(false);
      return;
    }
    loadFineGraphData();
  }, [macroOnly, loadFineGraphData, resetFineLoadingState]);

  useEffect(() => {
    return () => { fineAbortRef.current?.abort(); };
  }, []);

  // 현재 챕터 로드 완료 후 다음 챕터를 백그라운드 프리페치
  useEffect(() => {
    if (!serverBookId || !fullMacroData || apiMaxChapter <= 1) return;
    const nextCh = Number(currentChapter) + 1;
    if (nextCh > apiMaxChapter) return;
    if (hasMacroSessionCache(serverBookId, nextCh)) return;
    prefetchMacroGraphToCache(serverBookId, nextCh, () => getMacroGraph(serverBookId, nextCh, null));
  }, [serverBookId, currentChapter, fullMacroData, apiMaxChapter]);

  useEffect(() => {
    if (apiError && apiError.timestamp) {
      const timeout = setTimeout(() => {
        setApiError(null);
      }, ERROR_DISPLAY_DURATION);
      return () => clearTimeout(timeout);
    }
  }, [apiError]);

  return {
    manifestData,
    manifestReady,
    apiMacroData: fullMacroData,
    apiFineData,
    apiMaxChapter,
    userCurrentChapter,
    isGraphLoading,
    apiFineLoading,
    apiError,
    clearError: () => setApiError(null),
  };
}
