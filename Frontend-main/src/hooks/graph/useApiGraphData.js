/** book-scope 그래프 API·manifest 로드 (RelationGraph 전용) */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBookScopeRelationshipGraph } from '../../utils/api/api.js';
import {
  loadGraphDataWithCache,
  hasMacroGraphStorageCache,
  hasMacroSessionCache,
  prefetchMacroGraphToCache,
} from '../../utils/graph/graphData';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';
import { useErrorHandler } from '../common/useErrorHandler';
import { ensureBookManifest } from '../common/manifestEnsure';
import { cacheKeyUtils } from '../../utils/viewer/viewerCoreStateUtils';

const ERROR_DISPLAY_DURATION = 5000;

export function useApiGraphData(serverBookId, currentChapter) {
  const [manifestData, setManifestData] = useState(null);
  const [manifestReady, setManifestReady] = useState(false);
  const [fullMacroData, setFullMacroData] = useState(null);
  const [apiMaxChapter, setApiMaxChapter] = useState(1);
  const [userCurrentChapter, setUserCurrentChapter] = useState(null);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const { handleError } = useErrorHandler('API Graph Data');
  const [apiError, setApiError] = useState(null);
  const macroRequestIdRef = useRef(0);
  const manifestRequestIdRef = useRef(0);

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

    if (requestId === manifestRequestIdRef.current) {
      setManifestReady(true);
    }
  }, [serverBookId, handleError]);

  useEffect(() => {
    if (!serverBookId) return;
    setFullMacroData(null);
    setUserCurrentChapter(null);
    setManifestData(null);
    setManifestReady(false);
  }, [serverBookId]);

  useEffect(() => {
    if (!serverBookId) return;
    if (!hasMacroSessionCache(serverBookId, currentChapter)) {
      setFullMacroData(null);
    }
  }, [serverBookId, currentChapter]);

  const loadMacroGraphData = useCallback(async () => {
    if (!serverBookId) {
      setIsGraphLoading(false);
      return;
    }
    const chapter = Number(currentChapter);
    if (!Number.isFinite(chapter) || chapter < 1) {
      setIsGraphLoading(false);
      return;
    }

    const requestId = ++macroRequestIdRef.current;
    const targetBookId = serverBookId;
    let loadingKickTimer = null;
    const warmMacro = hasMacroGraphStorageCache(targetBookId, chapter);
    if (warmMacro) {
      loadingKickTimer = globalThis.setTimeout(() => {
        if (requestId === macroRequestIdRef.current) {
          setIsGraphLoading(true);
        }
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
        apiCall: () => getBookScopeRelationshipGraph(targetBookId, chapter, null),
        onSuccess: (data) => {
          if (requestId !== macroRequestIdRef.current) return;
          setApiError(null);
          setFullMacroData(data);
          if (data.userCurrentChapter !== undefined) {
            setUserCurrentChapter(data.userCurrentChapter);
          }
        },
        onError: (error) => {
          if (requestId !== macroRequestIdRef.current) return;
          setFullMacroData(null);
          const errorInfo = handleError(error, '책 범위 관계 그래프 로드 실패', {
            metadata: { bookId: targetBookId, uptoChapter: chapter },
            autoClear: false,
          });
          setApiError(errorInfo);
        },
      });
    } catch (error) {
      if (requestId !== macroRequestIdRef.current) return;
      setFullMacroData(null);
      const errorInfo = handleError(error, '책 범위 관계 그래프 로드 중 예외', {
        metadata: { bookId: targetBookId },
        autoClear: false,
      });
      setApiError(errorInfo);
    } finally {
      if (loadingKickTimer != null) {
        globalThis.clearTimeout(loadingKickTimer);
      }
      if (requestId === macroRequestIdRef.current) {
        setIsGraphLoading(false);
      }
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
    if (!serverBookId || !fullMacroData || apiMaxChapter <= 1) return;
    const nextCh = Number(currentChapter) + 1;
    if (nextCh > apiMaxChapter) return;
    if (hasMacroSessionCache(serverBookId, nextCh)) return;
    prefetchMacroGraphToCache(serverBookId, nextCh, () => getBookScopeRelationshipGraph(serverBookId, nextCh, null));
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
    apiBookGraphData: fullMacroData,
    apiMaxChapter,
    userCurrentChapter,
    isGraphLoading,
    apiError,
    clearError: () => setApiError(null),
  };
}
