import React, { forwardRef, useImperativeHandle, useMemo, useCallback } from "react";
import ViewerRelationGraph from "./RelationGraph_Viewerpage";
import { useGraphDataLoader } from "../../hooks/graph/useGraphDataLoader.js";
import { useGraphSearch } from "../../hooks/graph/useGraphSearch.jsx";

// ─── 헬퍼 ─────────────────────────────────────────────────────────────────────
/**
 * currentEvent에서 이벤트 인덱스 숫자를 추출합니다.
 * currentEvent는 숫자이거나 { eventNum } 객체일 수 있습니다.
 */
function resolveEventIdx(currentEvent) {
  if (typeof currentEvent?.eventNum === 'number' && currentEvent.eventNum > 0) {
    return currentEvent.eventNum;
  }
  if (typeof currentEvent === 'number' && currentEvent > 0) {
    return currentEvent;
  }
  return null;
}

// ─── GraphContainer ────────────────────────────────────────────────────────────
/**
 * 두 가지 모드를 지원합니다.
 *
 * [내부 모드] elements prop이 없을 때:
 *   - useGraphDataLoader로 데이터를 직접 패칭
 *   - useGraphSearch로 검색 상태를 자체 관리
 *
 * [외부 모드] elements prop이 있을 때 (GraphSplitArea → Viewer 분할):
 *   - 상위에서 검색·필터까지 반영한 최종 그래프 배열을 elements로 전달해야 함
 *   - 데이터 로더와 내부 검색 훅은 비활성화되며, elements를 다시 병합하지 않음(이중 규칙 방지)
 */
const GraphContainer = forwardRef(({
  currentPosition: _currentPosition,
  currentEvent,
  currentChapter,
  edgeLabelVisible = true,
  onSearchStateChange,
  filename,
  elements: externalElements,
  prevValidEvent = null,
  events = [],
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition = false,
  searchTerm: externalSearchTerm,
  isSearchActive: externalIsSearchActive,
  filteredElements: externalFilteredElements,
  fitNodeIds: externalFitNodeIds,
  isResetFromSearch: externalIsResetFromSearch,
  bookId = null,
}, ref) => {

  // ─── 모드 결정 ───────────────────────────────────────────────────────────
  // externalElements 제공 여부가 두 모드를 구분하는 유일한 기준입니다.
  // 외부 elements가 있으면 search state도 항상 외부에서 함께 주입됩니다.
  const isExternalMode = Boolean(externalElements);

  // ─── 데이터 로더 (내부 모드 전용) ──────────────────────────────────────
  // 외부 모드에서는 null을 전달해 로더를 비활성화합니다.
  const {
    elements: internalElements,
    newNodeIds,
    currentChapterData,
  } = useGraphDataLoader(
    isExternalMode ? null : (bookId ?? filename ?? null),
    isExternalMode ? null : currentChapter,
    isExternalMode ? null : resolveEventIdx(currentEvent),
  );

  const elements = externalElements || internalElements;

  // ─── 검색 상태 변경 콜백 ────────────────────────────────────────────────
  const handleSearchStateChange = useCallback((searchState) => {
    if (onSearchStateChange) {
      onSearchStateChange({ ...searchState, currentChapterData });
    }
  }, [onSearchStateChange, currentChapterData]);

  // ─── 검색 훅 (내부 모드 전용) ─────────────────────────────────────────
  // 외부 모드에서는 빈 배열을 전달해 훅을 비활성화합니다.
  const {
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    filteredElements: internalFilteredElements,
    fitNodeIds: internalFitNodeIds,
    isResetFromSearch: internalIsResetFromSearch,
    handleSearchSubmit,
    clearSearch,
  } = useGraphSearch(
    isExternalMode ? [] : (elements || []),
    handleSearchStateChange,
    currentChapterData,
  );

  // ─── 유효 검색 상태 ────────────────────────────────────────────────────
  const effectiveSearchTerm       = externalSearchTerm       ?? internalSearchTerm;
  const effectiveIsSearchActive   = externalIsSearchActive   ?? internalIsSearchActive;
  const effectiveFilteredElements = externalFilteredElements ?? internalFilteredElements;
  const effectiveIsResetFromSearch = externalIsResetFromSearch ?? internalIsResetFromSearch;

  const effectiveFitNodeIds = useMemo(() => {
    if (Array.isArray(externalFitNodeIds)) return externalFitNodeIds;
    if (Array.isArray(internalFitNodeIds) && internalFitNodeIds.length > 0) return internalFitNodeIds;
    if (effectiveIsSearchActive && Array.isArray(effectiveFilteredElements) && effectiveFilteredElements.length > 0) {
      const ids = effectiveFilteredElements
        .filter((el) => el?.data && !el.data.source && el.data.id != null)
        .map((el) => el.data.id);
      return Array.from(new Set(ids));
    }
    return [];
  }, [externalFitNodeIds, internalFitNodeIds, effectiveIsSearchActive, effectiveFilteredElements]);

  const finalElements = useMemo(() => {
    if (isExternalMode) {
      return elements;
    }
    if (effectiveIsSearchActive && effectiveFilteredElements?.length > 0) {
      return effectiveFilteredElements;
    }
    return elements;
  }, [isExternalMode, effectiveIsSearchActive, effectiveFilteredElements, elements]);

  // ─── 명령형 인터페이스 ─────────────────────────────────────────────────
  // ref를 통해 검색 동작만 노출합니다.
  // 검색 상태(searchTerm, isSearchActive)는 onSearchStateChange 콜백으로 전달합니다.
  useImperativeHandle(ref, () => ({
    handleSearchSubmit: isExternalMode ? () => {} : handleSearchSubmit,
    clearSearch:        isExternalMode ? () => {} : clearSearch,
  }), [isExternalMode, handleSearchSubmit, clearSearch]);

  return (
    <ViewerRelationGraph
      elements={finalElements}
      newNodeIds={newNodeIds}
      chapterNum={currentChapter}
      eventNum={(() => {
        if (typeof currentEvent === 'number' && Number.isFinite(currentEvent) && currentEvent > 0) {
          return currentEvent;
        }
        const n = Number(currentEvent?.eventNum);
        return Number.isFinite(n) && n > 0 ? n : 1;
      })()}
      edgeLabelVisible={edgeLabelVisible}
      filename={filename}
      bookId={bookId}
      fitNodeIds={effectiveFitNodeIds}
      searchTerm={effectiveSearchTerm}
      isSearchActive={effectiveIsSearchActive}
      filteredElements={effectiveFilteredElements}
      isResetFromSearch={effectiveIsResetFromSearch}
      currentEvent={currentEvent}
      prevValidEvent={prevValidEvent}
      events={events}
      activeTooltip={activeTooltip}
      onClearTooltip={onClearTooltip}
      onSetActiveTooltip={onSetActiveTooltip}
      graphClearRef={graphClearRef}
      isEventTransition={isEventTransition}
    />
  );
});

GraphContainer.displayName = 'GraphContainer';

export default GraphContainer;
