/** macro/fine graph API·manifest 로드 (RelationGraph 전용) */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getMacroGraph, getFineGraph } from '../../utils/api/api.js';
import { anchorToLocators } from '../../utils/common/locatorUtils';
import {
  resolveMaxChapter,
  loadGraphDataWithCache,
  hasMacroGraphStorageCache,
  hasMacroSessionCache,
  prefetchMacroGraphToCache,
} from '../../utils/graph/graphData';
import { useErrorHandler } from '../common/useErrorHandler';
import { resolveEventIdxOrFallback } from '../common/hooksShared';
import { ensureBookManifest } from '../common/manifestEnsure';
import { cacheKeyUtils } from '../../utils/viewer/viewerCoreStateUtils';

const ERROR_DISPLAY_DURATION = 5000;

export function useApiGraphData(
  serverBookId,
  currentChapter,
  currentEvent,
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

  const fineEpochRef = useRef(0);
  const isFineGraphLoadingRef = useRef(false);
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
    const chapterIdx = Number(currentChapter);
    const safeChapterIdx = Number.isFinite(chapterIdx) && chapterIdx >= 1 ? chapterIdx : 1;
    const eventIdx = resolveEventIdxOrFallback(currentEvent, 1);
    return `${serverBookId}:${safeChapterIdx}:${eventIdx}`;
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

    const outcome = await ensureBookManifest(targetBookId);

    if (outcome.manifest) {
      setManifestData(outcome.manifest);
      setApiMaxChapter(resolveMaxChapter(targetBookId, outcome.manifest));
    } else if (!outcome.ok && !outcome.skipped) {
      setApiMaxChapter(initialMaxChapter);
      if (outcome.error) {
        const errorInfo = handleError(outcome.error, 'Manifest 로드 중 오류', {
          metadata: { bookId: targetBookId },
          autoClear: false,
        });
        setApiError(errorInfo);
      } else {
        const manifestError = new Error('Manifest 로드 실패');
        manifestError.status = outcome.response?.code || null;
        const errorInfo = handleError(manifestError, 'Manifest API 응답 실패', {
          metadata: { bookId: targetBookId, response: outcome.response },
          autoClear: false,
        });
        setApiError(errorInfo);
      }
    }

    setManifestReady(true);
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
      const cacheKey = cacheKeyUtils.macroGraphStorage(targetBookId, chapter);
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
    if (!manifestReady) {
      resetFineLoadingState(false);
      return;
    }
    if (!serverBookId) {
      resetFineLoadingState(false);
      return;
    }

    const targetBookId = serverBookId;
    const chapterIdx = Number(currentChapter);
    if (!Number.isFinite(chapterIdx) || chapterIdx < 1) {
      resetFineLoadingState(false);
      return;
    }
    const eventIdx = resolveEventIdxOrFallback(currentEvent, 1);
    const atLocator = anchorToLocators(currentEvent?.anchor).startLocator;

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
      const cacheKey = cacheKeyUtils.fineGraphStorage(targetBookId, chapterIdx, eventIdx);
      await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter: chapterIdx,
        eventIdx,
        cacheKey,
        // 강제 이벤트: locator→이벤트 재해석이 덮어쓰지 않도록 eventIdx 고정 경로만 사용
        apiCall: () =>
          getFineGraph(targetBookId, chapterIdx, eventIdx, atLocator),
        macroData: null,
        onSuccess: (data) => {
          if (signal.aborted) return;
          setRawFineData(data);
        },
        onError: (error) => {
          if (signal.aborted) return;
          const errorInfo = handleError(error, 'Fine Graph 로드 실패', {
            metadata: { bookId: targetBookId, chapterIdx, eventIdx },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      if (signal.aborted) return;
      const errorInfo = handleError(error, 'Fine Graph 로드 중 예외', {
        metadata: { bookId: targetBookId, chapterIdx, eventIdx },
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
    manifestReady,
    serverBookId,
    currentChapter,
    currentEvent,
    handleError,
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
