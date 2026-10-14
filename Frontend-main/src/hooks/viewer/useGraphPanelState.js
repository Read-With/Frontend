/** 뷰어 분할 그래프 패널 파생 상태: 무엇을 보여줄지(캔버스/로딩/빈/오류) 결정 */

import { useMemo, useEffect, useState } from 'react';
import { useGraphElementPipeline } from '../graph/useGraphViewState';
import { resolveGraphCallContext, normalizeGraphApiError, getViewerGraphLoadingNotice } from '../../utils/viewer/viewerGraph';
import { hasGraphPanelLocationHint } from '../../utils/common/valueUtils';
import { eventUtils } from '../../utils/viewer/viewerCore';

/**
 * 그래프 패널에 무엇을 보여줄지 결정하는 파생 상태.
 * - canShowGraph: 확정 이벤트 + 타깃 callKey 일치 + elements 있음 → 캔버스 노출 (이전 이벤트 stale 금지)
 * - isDataLoadCompleteAndEmpty: 로딩이 끝났고 이 챕터엔 표시할 이벤트가 없음 → 빈 상태 패널
 * - isGraphRefreshing: 이벤트 전환 중 → 캔버스는 유지한 채 오버레이만 노출
 * - shouldShowLoading / resolvedApiError: 캔버스를 아직 그릴 수 없을 때의 대체 패널
 */
export function resolveGraphPanelStatus({
  graphPhase,
  isEventTransition,
  isDataReady,
  hasResolvedEvent,
  hasElements,
  graphMatchesTarget,
  isDataEmpty,
  apiError,
  isLocationDetermined,
  transitionType,
}) {
  const canShowGraph = isDataReady && hasResolvedEvent && hasElements && graphMatchesTarget;
  const isGraphRefreshing = graphPhase === 'event' || isEventTransition;
  const isDataLoadCompleteAndEmpty =
    graphPhase === 'idle' && isDataReady && isDataEmpty && !hasElements && hasResolvedEvent && graphMatchesTarget;
  const resolvedApiError = normalizeGraphApiError(apiError);
  const shouldShowLoading = !canShowGraph && !isDataLoadCompleteAndEmpty && !resolvedApiError;
  // 에러가 있으면 "이벤트 반영 중" 칩과 동시에 겹쳐 보이지 않도록 에러를 우선한다.
  const showRefreshOverlay = canShowGraph && isGraphRefreshing && !resolvedApiError;
  const loadingNotice = getViewerGraphLoadingNotice(
    isGraphRefreshing || !isDataReady || !hasResolvedEvent || !graphMatchesTarget,
    isLocationDetermined,
    transitionType
  );
  return {
    canShowGraph,
    isDataLoadCompleteAndEmpty,
    resolvedApiError,
    shouldShowLoading,
    showRefreshOverlay,
    loadingNotice,
  };
}

/** 확정 이벤트·타깃 그래프 callKey (이벤트 미확정이면 null) */
function resolveTargetGraphKey({ book, currentChapter, currentEvent, hasResolvedEvent }) {
  if (!hasResolvedEvent) return null;
  const ctx = resolveGraphCallContext({ book, currentChapter, currentEvent });
  return ctx?.eventIdx >= 1 ? ctx.callKey : null;
}

/** 캔버스를 못 그리는 동안에는 마지막으로 표시한 이벤트 메타 유지 (새 이벤트+옛 elements 혼선 방지) */
function useMountedGraphMeta(canShowGraph, currentEvent, currentChapter, prevValidEvent) {
  const [mounted, setMounted] = useState({ currentEvent, currentChapter, prevValidEvent });
  useEffect(() => {
    if (!canShowGraph) return;
    // 값이 같으면 이전 객체 유지 (불필요한 재렌더 방지)
    setMounted((prev) => (
      prev.currentEvent === currentEvent &&
      prev.currentChapter === currentChapter &&
      prev.prevValidEvent === prevValidEvent
        ? prev
        : { currentEvent, currentChapter, prevValidEvent }
    ));
  }, [canShowGraph, currentEvent, currentChapter, prevValidEvent]);
  return canShowGraph ? { currentEvent, currentChapter, prevValidEvent } : mounted;
}

/** 그래프 패널 파생 상태: 타깃 일치·위치 확정·필터 결과 → resolveGraphPanelStatus + 캔버스 메타 유지 */
export function useGraphPanelState({
  viewerState,
  graphState,
  filterStage,
  isSearchActive,
  filteredElements,
  transitionState,
  apiError,
  cachedLocation,
  resumeAnchor,
}) {
  const { graphPhase, isDataReady, isDataEmpty, appliedGraphKey, book } = viewerState;
  const { elements, currentEvent, currentChapter, prevValidEvent } = graphState;

  const hasResolvedEvent = eventUtils.resolveEventNum(currentEvent) > 0;
  const targetGraphKey = useMemo(
    () => resolveTargetGraphKey({ book, currentChapter, currentEvent, hasResolvedEvent }),
    [book, currentChapter, currentEvent, hasResolvedEvent],
  );
  const graphMatchesTarget = Boolean(targetGraphKey) && appliedGraphKey === targetGraphKey;

  const hasLocationHint =
    hasGraphPanelLocationHint(cachedLocation, { requireEventNum: true }) ||
    hasGraphPanelLocationHint(resumeAnchor);
  const isLocationDetermined = (currentChapter >= 1 && Boolean(currentEvent)) || hasLocationHint;

  const { finalElements } = useGraphElementPipeline({
    elements,
    filterStage,
    isSearchActive,
    filteredElements,
  });

  const hasElements = Array.isArray(elements) && elements.length > 0;
  const isEventTransition =
    transitionState.type === 'event' && transitionState.inProgress;
  // 검색 결과 0건은 CytoscapeGraph 내부 no-results 오버레이가 처리하지만,
  // 인물 필터(filterStage)로 인한 0건은 여기서 별도 안내가 필요함 — 그렇지 않으면 빈 캔버스만 노출됨
  const isFilteredToEmpty =
    hasElements && !isSearchActive && filterStage > 0 && finalElements.length === 0;

  const panelStatus = useMemo(
    () => resolveGraphPanelStatus({
      graphPhase,
      isEventTransition,
      isDataReady,
      hasResolvedEvent,
      hasElements,
      graphMatchesTarget,
      isDataEmpty,
      apiError,
      isLocationDetermined,
      transitionType: transitionState.type,
    }),
    [
      graphPhase,
      isEventTransition,
      isDataReady,
      hasResolvedEvent,
      hasElements,
      graphMatchesTarget,
      isDataEmpty,
      apiError,
      isLocationDetermined,
      transitionState.type,
    ],
  );

  const canvasMeta = useMountedGraphMeta(panelStatus.canShowGraph, currentEvent, currentChapter, prevValidEvent);

  return { ...panelStatus, finalElements, hasElements, isEventTransition, isFilteredToEmpty, canvasMeta };
}
