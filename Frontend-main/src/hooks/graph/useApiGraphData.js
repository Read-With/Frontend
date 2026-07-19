/** book-scope 그래프 API·manifest 로드 (RelationGraph 전용) */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBookScopeRelationshipGraph } from '../../utils/api/api.js';
import { loadGraphDataWithCache, hasMacroGraphStorageCache, hasMacroSessionCache, prefetchMacroGraphToCache } from '../../utils/graph/graphData';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';
import { useErrorHandler } from '../common/useErrorHandler';
import { ensureBookManifest } from '../common/manifestEnsure';
import { cacheKeyUtils } from '../../utils/viewer/viewerCoreStateUtils';

const ERROR_DISPLAY_DURATION = 5000;

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
