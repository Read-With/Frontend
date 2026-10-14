/** book-scope 그래프 API·manifest·관계 타임라인 (RelationGraph 전용) */

import { useCallback, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  loadGraphDataWithCache,
  readMacroGraphCache,
  hasMacroSessionCache,
  prefetchMacroGraphToCache,
  fetchRelationTimelineCumulative,
  fetchRelationTimelineViewer,
} from '../../utils/graph/graphFetch';
import { padSingleEvent } from '../../utils/graph/graphCharts';
import { getBookScopeRelationshipGraph } from '../../utils/graph/graphModel';
import { getMaxChapter } from '../../utils/common/cache/manifestCache';
import { toPositiveNumberOrNull, toPositiveInt } from '../../utils/common/valueUtils';
import { useManifestLoaded } from '../common/hooksShared';
import { cacheKeyUtils } from '../../utils/viewer/viewerCore';
import { enrichGraphPayload } from '../../utils/graph/graphCharacterNames';

async function fetchMacroGraph(bookId, chapter) {
  let failure = null;
  const data = await loadGraphDataWithCache({
    bookId,
    chapter,
    cacheKey: cacheKeyUtils.macroGraphStorage(bookId, chapter),
    apiCall: () => getBookScopeRelationshipGraph(bookId, chapter),
    onError: (error) => { failure = error; },
  });
  if (!data) throw failure ?? new Error('책 범위 관계 그래프 로드 실패');
  return enrichGraphPayload(data, bookId);
}

export function useApiGraphData(serverBookId, currentChapter) {
  const {
    loaded: manifestLoaded,
    ready: manifestReady,
    manifest: manifestData,
    error: manifestLoadError,
    retry: retryManifest,
  } = useManifestLoaded(serverBookId);

  // manifest 없을 때 fallback:1로 잘못된 챕터 API를 치지 않음
  const apiMaxChapter = useMemo(
    () => getMaxChapter(serverBookId, manifestData, { fallback: 0 }),
    [serverBookId, manifestData]
  );

  const chapter = toPositiveInt(currentChapter);
  const enabled = Boolean(
    serverBookId && manifestReady && chapter != null && chapter <= apiMaxChapter
  );

  const query = useQuery({
    queryKey: ['macroGraph', serverBookId, chapter],
    queryFn: () => fetchMacroGraph(serverBookId, chapter),
    enabled,
    // 캐시된 챕터는 로딩 없이 즉시 표시 (TTL은 graphFetch 캐시가 관리)
    initialData: () => {
      if (!enabled) return undefined;
      const cached = readMacroGraphCache(serverBookId, chapter);
      return cached ? enrichGraphPayload(cached, serverBookId) : undefined;
    },
    staleTime: Infinity,
    retry: false,
    // 같은 책의 챕터 전환 중에는 이전 그래프 유지, 책이 바뀌면 비움
    placeholderData: (prev, prevQuery) =>
      prevQuery?.queryKey[1] === serverBookId ? prev : undefined,
  });

  const graphData = query.data ?? null;
  const isCurrent = query.isSuccess && !query.isPlaceholderData;

  useEffect(() => {
    if (!serverBookId || !isCurrent || chapter == null || apiMaxChapter <= 1) return;
    const nextCh = chapter + 1;
    if (nextCh > apiMaxChapter || hasMacroSessionCache(serverBookId, nextCh)) return;
    prefetchMacroGraphToCache(serverBookId, nextCh, () =>
      getBookScopeRelationshipGraph(serverBookId, nextCh)
    );
  }, [serverBookId, chapter, isCurrent, apiMaxChapter]);

  const manifestError = manifestLoadError && !manifestReady ? manifestLoadError : null;

  // refetch()는 enabled를 무시하므로 조건을 직접 확인: manifest 실패면 manifest부터 재시도
  const { refetch } = query;
  const retryGraph = useCallback(() => {
    if (manifestError) retryManifest();
    else if (enabled) void refetch();
  }, [manifestError, retryManifest, enabled, refetch]);

  // 재시도 중에는 에러 배너를 숨김
  const graphError = query.isError && !query.isFetching ? query.error : null;

  return {
    manifest: {
      data: manifestData,
      loaded: manifestLoaded,
      ready: manifestReady,
    },
    graph: {
      data: graphData,
      loadedKey: isCurrent ? `${serverBookId}:${chapter}` : null,
      maxChapter: apiMaxChapter,
      userCurrentChapter: graphData?.userCurrentChapter ?? null,
      isLoading: enabled && query.isFetching,
    },
    error: manifestError ?? graphError,
    retryGraph,
  };
}

const RELATION_LOAD_ERROR = '관계 데이터를 불러오는 중 오류가 발생했습니다.';
const EMPTY_RELATION = { timeline: [], labels: [], noRelation: false, incomplete: false, usedProbe: false };

async function fetchRelationTimeline(mode, bookId, id1, id2, chapter, event) {
  const result =
    mode === 'cumulative'
      ? await fetchRelationTimelineCumulative(bookId, id1, id2, chapter)
      : await fetchRelationTimelineViewer(bookId, id1, id2, chapter, event);

  const { points, labels } = padSingleEvent(result.points, result.labelInfo);
  const emptyPoints = points.filter((value) => typeof value === 'number').length === 0;
  return {
    timeline: points,
    labels,
    noRelation: Boolean(result.noRelation) || emptyPoints,
    incomplete: Boolean(result.incomplete),
    usedProbe: Boolean(result.usedProbe),
  };
}

export function useRelationData(mode, id1, id2, chapterNum, eventNum, bookId = null) {
  const numericBookId = toPositiveNumberOrNull(bookId);
  const numericChapter = toPositiveInt(chapterNum);
  // 뷰어: 이벤트 미확정이면 E1로 보정하지 않음
  const normalizedEvent =
    mode === 'viewer' ? toPositiveInt(eventNum) : toPositiveInt(eventNum, 1);

  const hasTarget = Boolean(numericBookId && id1 && id2 && numericChapter != null);
  const enabled = hasTarget && normalizedEvent != null;

  const query = useQuery({
    // cumulative(그래프 페이지)는 챕터까지 누적이라 이벤트와 무관 → 이벤트가 바뀌어도 같은 캐시 재사용
    queryKey: ['relationTimeline', mode, numericBookId, id1, id2, numericChapter, mode === 'cumulative' ? null : normalizedEvent],
    queryFn: () =>
      fetchRelationTimeline(mode, numericBookId, id1, id2, numericChapter, normalizedEvent),
    enabled,
    retry: false,
  });

  // refetch()는 enabled를 무시하므로 조회 조건이 맞을 때만 재요청
  const { refetch } = query;
  const fetchData = useCallback(() => {
    if (enabled) void refetch();
  }, [enabled, refetch]);

  let error = null;
  if (!hasTarget) error = '관계 타임라인을 불러올 수 없습니다.';
  else if (enabled && query.isError) error = query.error?.message || RELATION_LOAD_ERROR;

  const data = enabled && !query.isError ? query.data ?? EMPTY_RELATION : EMPTY_RELATION;

  return useMemo(
    () => ({
      ...data,
      loading: enabled && query.isFetching,
      error,
      fetchData,
    }),
    [data, enabled, query.isFetching, error, fetchData]
  );
}
