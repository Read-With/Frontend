import { useState, useEffect, useRef, useCallback } from 'react';
import { getMacroGraph, getFineGraph, getBookManifest } from '../../utils/api/api.js';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { getGraphBookCache } from '../../utils/common/cache/chapterEventCache';
import { resolveMaxChapter } from '../../utils/graph/maxChapterResolver';
import { loadGraphDataWithCache } from '../../utils/graph/graphDataLoader';
import { useErrorHandler } from '../common/useErrorHandler';

const ERROR_DISPLAY_DURATION = 5000;

export function useApiGraphData(serverBookId, currentChapter, currentEvent, isApiBook) {
  const [manifestData, setManifestData] = useState(null);
  const [apiMacroData, setApiMacroData] = useState(null);
  const [apiFineData, setApiFineData] = useState(null);
  const [apiMaxChapter, setApiMaxChapter] = useState(1);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [apiFineLoading, setApiFineLoading] = useState(false);

  const isMacroGraphLoadingRef = useRef(false);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);

  const loadManifestData = useCallback(async () => {
    if (!isApiBook || !serverBookId) {
      setIsGraphLoading(false);
      return;
    }

    const targetBookId = serverBookId;
    setIsGraphLoading(true);

    try {
      const graphCache = getGraphBookCache(targetBookId);
      const initialMaxChapter = resolveMaxChapter(targetBookId, null, graphCache);
      
      if (graphCache?.maxChapter && graphCache.maxChapter > 0) {
        setApiMaxChapter(graphCache.maxChapter);
        setIsGraphLoading(false);
        return;
      }

      const cachedManifest = getManifestFromCache(targetBookId);
      if (cachedManifest) {
        setManifestData(cachedManifest);
        const maxChapter = resolveMaxChapter(targetBookId, cachedManifest, graphCache);
        setApiMaxChapter(maxChapter);
        setIsGraphLoading(false);
        return;
      }

      const manifestResponse = await getBookManifest(targetBookId);

      if (manifestResponse?.isSuccess && manifestResponse?.result) {
        setManifestData(manifestResponse.result);
        const maxChapter = resolveMaxChapter(targetBookId, manifestResponse.result, graphCache);
        setApiMaxChapter(maxChapter);
        setIsGraphLoading(false);
      } else {
        setApiMaxChapter(initialMaxChapter);
        setIsGraphLoading(false);
        const manifestError = new Error('Manifest 로드 실패');
        manifestError.status = manifestResponse?.code || null;
        const errorInfo = handleError(manifestError, 'Manifest API 응답 실패', {
          metadata: { bookId: targetBookId, response: manifestResponse },
          autoClear: false,
        });
        setApiError(errorInfo);
      }
    } catch (error) {
      const graphCache = getGraphBookCache(targetBookId);
      const initialMaxChapter = resolveMaxChapter(targetBookId, null, graphCache);
      setApiMaxChapter(initialMaxChapter);
      setIsGraphLoading(false);
      const errorInfo = handleError(error, 'Manifest 로드 중 오류', {
        metadata: { bookId: targetBookId },
        autoClear: false,
      });
      setApiError(errorInfo);
    }
  }, [isApiBook, serverBookId, handleError]);

  const loadMacroGraphData = useCallback(async () => {
    if (!isApiBook || !serverBookId) {
      return;
    }

    const targetBookId = serverBookId;

    if (isMacroGraphLoadingRef.current) {
      return;
    }

    isMacroGraphLoadingRef.current = true;
    setApiFineLoading(true);

    try {
      const cacheKey = `graph_macro_${targetBookId}_${currentChapter}`;
      const result = await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter: currentChapter,
        eventIdx: null,
        cacheKey,
        apiCall: () => getMacroGraph(targetBookId, currentChapter),
        onSuccess: (data) => {
          setApiMacroData(data);
          setApiFineData(data);
          if (data.userCurrentChapter !== undefined) {
            setUserCurrentChapter(data.userCurrentChapter);
          }
        },
        onError: (error) => {
          setApiMacroData(null);
          setApiFineData(null);
          const errorInfo = handleError(error, 'Macro Graph 로드 실패', {
            metadata: { bookId: targetBookId, chapter: currentChapter },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      setApiMacroData(null);
      setApiFineData(null);
      const errorInfo = handleError(error, 'Macro Graph 로드 중 예외', {
        metadata: { bookId: targetBookId, chapter: currentChapter },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      isMacroGraphLoadingRef.current = false;
      setApiFineLoading(false);
    }
  }, [isApiBook, serverBookId, currentChapter, handleError]);

  const loadFineGraphData = useCallback(async () => {
    if (!isApiBook || !serverBookId || !apiMacroData) {
      setApiFineLoading(false);
      return;
    }

    const targetBookId = serverBookId;

    if (apiMacroData.characters && apiMacroData.relations) {
      setApiFineData(apiMacroData);
      setApiFineLoading(false);
      return;
    }

    let eventNumValue = typeof currentEvent === 'number'
      ? currentEvent
      : (currentEvent?.eventNum ?? currentEvent?.eventIdx ?? currentEvent?.event_id ?? 1);

    const eventIdx = Number.isFinite(eventNumValue) && eventNumValue >= 1 ? eventNumValue : 1;

    if (eventIdx < 1) {
      if (apiMacroData) {
        setApiFineData(apiMacroData);
      }
      setApiFineLoading(false);
      return;
    }

    setApiFineLoading(true);

    try {
      const cacheKey = `graph_fine_${targetBookId}_${currentChapter}_${eventIdx}`;
      await loadGraphDataWithCache({
        bookId: targetBookId,
        chapter: currentChapter,
        eventIdx,
        cacheKey,
        apiCall: () => getFineGraph(targetBookId, currentChapter, eventIdx),
        macroData: apiMacroData,
        onSuccess: (data) => {
          setApiFineData(data);
        },
        onError: (error) => {
          if (apiMacroData) {
            setApiFineData(apiMacroData);
          }
          const errorInfo = handleError(error, 'Fine Graph 로드 실패', {
            metadata: { bookId: targetBookId, chapter: currentChapter, eventIdx },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      if (apiMacroData) {
        setApiFineData(apiMacroData);
      }
      const errorInfo = handleError(error, 'Fine Graph 로드 중 예외', {
        metadata: { bookId: targetBookId, chapter: currentChapter, eventIdx },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      setApiFineLoading(false);
    }
  }, [isApiBook, serverBookId, currentChapter, currentEvent, apiMacroData, handleError]);

  useEffect(() => {
    loadManifestData();
  }, [loadManifestData]);

  useEffect(() => {
    loadMacroGraphData();
  }, [loadMacroGraphData]);

  useEffect(() => {
    loadFineGraphData();
  }, [loadFineGraphData]);

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
