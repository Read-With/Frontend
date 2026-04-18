import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { getMacroGraph, getFineGraph, getBookManifest } from '../../utils/api/api.js';
import {
  getManifestFromCache,
  getEventData,
} from '../../utils/common/cache/manifestCache';
import { resolveMaxChapter } from '../../utils/graph/maxChapterResolver';
import { loadGraphDataWithCache } from '../../utils/graph/graphDataLoader';
import { useErrorHandler } from '../common/useErrorHandler';
import { toLocator, readingLocatorFromGraphEvent, anchorToLocators } from '../../utils/common/locatorUtils';

const ERROR_DISPLAY_DURATION = 5000;

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
  const [fullMacroData, setFullMacroData] = useState(null);  // full-book macro (fetched once per bookId)
  const [rawFineData, setRawFineData] = useState(null);      // event-level fine graph data
  const [apiMaxChapter, setApiMaxChapter] = useState(1);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [apiFineLoading, setApiFineLoading] = useState(false);

  const isFineGraphLoadingRef = useRef(false);
  const fineEpochRef = useRef(0);            // stale-cancellation for fine graph
  const prevFineTargetKeyRef = useRef(null);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);

  // GET /api/v2/graph/macro — 응답 그대로 (relations 에 챕터 필드 없음)
  const apiMacroData = useMemo(() => fullMacroData, [fullMacroData]);

  const apiFineData = useMemo(() => {
    if (macroOnly) return apiMacroData;
    return rawFineData;
  }, [macroOnly, apiMacroData, rawFineData]);

  // ─── Fine graph target key (stale detection) ──────────────────────────────
  const fineTargetKey = useMemo(() => {
    if (!serverBookId) return '';
    const evRaw = Number(currentEvent);
    const ev = Number.isFinite(evRaw) && evRaw >= 1 ? evRaw : 1;
    return `${serverBookId}:${currentChapter}:${ev}`;
  }, [serverBookId, currentChapter, currentEvent]);

  // Reset fine data when chapter/event (or bookId) changes
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
    fineEpochRef.current += 1;
    isFineGraphLoadingRef.current = false;
    setApiFineLoading(false);
    setRawFineData(null);
  }, [serverBookId, fineTargetKey]);

  const forcedLocator = useMemo(() => {
    if (!serverBookId) return null;
    const chapter = Number(currentChapter);
    const forcedIdx = Number(forcedChapterEventIdx);
    if (!Number.isFinite(chapter) || chapter < 1) return null;
    if (!Number.isFinite(forcedIdx) || forcedIdx < 1) return null;

    const eventData = getEventData(serverBookId, chapter, forcedIdx, manifestData);
    const fromEventAnchor = readingLocatorFromGraphEvent(eventData);
    const fromEventField = toLocator(eventData?.startLocator) ?? toLocator(eventData?.locator);
    const resolved = fromEventAnchor ?? fromEventField;

    if (resolved) return resolved;
    return { chapterIndex: chapter, blockIndex: 0, offset: 0 };
  }, [serverBookId, currentChapter, forcedChapterEventIdx, manifestData]);

  const loadManifestData = useCallback(async () => {
    if (!serverBookId) {
      setIsGraphLoading(false);
      setManifestReady(true);
      return;
    }

    const targetBookId = serverBookId;
    setManifestReady(false);
    setIsGraphLoading(true);

    const initialMaxChapter = resolveMaxChapter(targetBookId, null);

    try {
      const cachedManifest = getManifestFromCache(targetBookId);
      if (cachedManifest) {
        setManifestData(cachedManifest);
        const maxChapter = resolveMaxChapter(targetBookId, cachedManifest);
        setApiMaxChapter(maxChapter);
        return;
      }

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
      setIsGraphLoading(false);
      setManifestReady(true);
    }
  }, [serverBookId, handleError]);

  useEffect(() => {
    if (!serverBookId) return;
    setFullMacroData(null);
    setRawFineData(null);
    fineEpochRef.current += 1;
    isFineGraphLoadingRef.current = false;
    setApiFineLoading(false);
  }, [serverBookId]);

  const loadMacroGraphData = useCallback(async () => {
    if (!serverBookId) return;
    const chapter = Number(currentChapter);
    if (!Number.isFinite(chapter) || chapter < 1) return;

    const targetBookId = serverBookId;
    setIsGraphLoading(true);

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
      setIsGraphLoading(false);
    }
  }, [serverBookId, currentChapter, handleError]);

  const loadFineGraphData = useCallback(async () => {
    if (macroOnly) {
      setApiFineLoading(false);
      return;
    }
    if (!serverBookId) {
      setApiFineLoading(false);
      return;
    }

    if (isFineGraphLoadingRef.current) {
      return;
    }

    const targetBookId = serverBookId;

    const eventNumValue = Number(currentEvent);
    let eventIdx = Number.isFinite(eventNumValue) && eventNumValue >= 1 ? eventNumValue : 1;
    const forcedIdx = Number(forcedChapterEventIdx);
    const hasForcedIdx = Number.isFinite(forcedIdx) && forcedIdx >= 1;
    if (hasForcedIdx) {
      eventIdx = forcedIdx;
    }

    if (eventIdx < 1) {
      setApiFineLoading(false);
      return;
    }

    isFineGraphLoadingRef.current = true;
    setApiFineLoading(true);

    const epoch = fineEpochRef.current;

    try {
      const cacheKey = `graph_fine_${targetBookId}_${currentChapter}_${eventIdx}`;
      await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter: currentChapter,
        eventIdx,
        cacheKey,
        apiCall: () => getFineGraph(targetBookId, currentChapter, eventIdx, hasForcedIdx ? forcedLocator : null),
        macroData: null,
        onSuccess: (data) => {
          if (epoch !== fineEpochRef.current) return;
          setRawFineData(data);
        },
        onError: (error) => {
          if (epoch !== fineEpochRef.current) return;
          const errorInfo = handleError(error, 'Fine Graph 로드 실패', {
            metadata: { bookId: targetBookId, chapter: currentChapter, eventIdx },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      if (epoch !== fineEpochRef.current) {
        return;
      }
      const errorInfo = handleError(error, 'Fine Graph 로드 중 예외', {
        metadata: { bookId: targetBookId, chapter: currentChapter, eventIdx },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      if (epoch === fineEpochRef.current) {
        isFineGraphLoadingRef.current = false;
        setApiFineLoading(false);
      }
    }
  }, [
    macroOnly,
    serverBookId,
    currentChapter,
    currentEvent,
    handleError,
    forcedChapterEventIdx,
    forcedLocator,
  ]);

  useEffect(() => {
    loadManifestData();
  }, [loadManifestData]);

  useEffect(() => {
    loadMacroGraphData();
  }, [loadMacroGraphData]);

  useEffect(() => {
    if (macroOnly) {
      setApiFineLoading(false);
      return;
    }
    loadFineGraphData();
  }, [macroOnly, loadFineGraphData]);

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
    apiMacroData,
    apiFineData,
    apiMaxChapter,
    userCurrentChapter,
    isGraphLoading,
    apiFineLoading,
    apiError,
    clearError: () => setApiError(null),
  };
}
