import React, { useEffect, useState, forwardRef, useImperativeHandle, useMemo, useCallback } from "react";
import ViewerRelationGraph from "./RelationGraph_Viewerpage";
import { useGraphDataLoader } from "../../hooks/graph/useGraphDataLoader.js";
import { useGraphSearch } from "../../hooks/graph/useGraphSearch.jsx";

const GraphContainer = forwardRef(({
  currentPosition,
  currentEvent,
  currentChapter,
  edgeLabelVisible = true,
  onSearchStateChange,
  onElementsUpdate,
  filename,
  elements: externalElements, 
  prevValidEvent = null,
  events = [],
  activeTooltip = null,
  onClearTooltip = null,
  onSetActiveTooltip = null,
  graphClearRef = null,
  isEventTransition = false, // 이벤트 전환 상태
  searchTerm: externalSearchTerm,
  isSearchActive: externalIsSearchActive,
  filteredElements: externalFilteredElements,
  fitNodeIds: externalFitNodeIds,
  isResetFromSearch: externalIsResetFromSearch,
  bookId = null,
  ...rest
}, ref) => {

  // ViewerPage에서는 externalElements를 사용하므로 useGraphDataLoader 비활성화
  const {
    elements: internalElements,
    newNodeIds,
    currentChapterData,
    loading,
    error
  } = useGraphDataLoader(
    externalElements ? null : (bookId ?? filename ?? null),
    externalElements ? null : currentChapter,
    externalElements ? null : (
      typeof currentEvent?.eventNum === 'number' && currentEvent.eventNum > 0
        ? currentEvent.eventNum
        : (
          typeof currentEvent === 'number' && currentEvent > 0
            ? currentEvent
            : null
        )
    )
  );

  // 외부에서 전달받은 elements가 있으면 그것을 사용, 없으면 내부 로더 사용
  const elements = externalElements || internalElements;

  // 검색 상태 변경 콜백
  const handleSearchStateChange = useCallback((searchState) => {
    if (onSearchStateChange) {
      onSearchStateChange({
        ...searchState,
        currentChapterData
      });
    }
  }, [onSearchStateChange, currentChapterData]);

  // 외부에서 elements를 전달받은 경우 자체 검색 기능 비활성화
  const shouldUseInternalSearch =
    externalSearchTerm === undefined &&
    externalIsSearchActive === undefined &&
    externalFilteredElements === undefined &&
    externalFitNodeIds === undefined;
  
  // useGraphSearch 훅을 사용하여 검색 기능 구현 (외부 elements가 없을 때만)
  const {
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    filteredElements: internalFilteredElements,
    fitNodeIds: internalFitNodeIds,
    isResetFromSearch: internalIsResetFromSearch,
    handleSearchSubmit,
    clearSearch
  } = useGraphSearch(
    shouldUseInternalSearch ? (elements || []) : [],
    handleSearchStateChange,
    currentChapterData
  );

  const effectiveSearchTerm = externalSearchTerm ?? internalSearchTerm;
  const effectiveIsSearchActive = externalIsSearchActive ?? internalIsSearchActive;
  const effectiveFilteredElements = externalFilteredElements ?? internalFilteredElements;
  const effectiveIsResetFromSearch = externalIsResetFromSearch ?? internalIsResetFromSearch;

  const effectiveFitNodeIds = useMemo(() => {
    if (Array.isArray(externalFitNodeIds)) {
      return externalFitNodeIds;
    }
    if (Array.isArray(internalFitNodeIds) && internalFitNodeIds.length > 0) {
      return internalFitNodeIds;
    }
    if (effectiveIsSearchActive && Array.isArray(effectiveFilteredElements) && effectiveFilteredElements.length > 0) {
      const ids = effectiveFilteredElements
        .filter((el) => el && el.data && !el.data.source && el.data.id !== undefined && el.data.id !== null)
        .map((el) => el.data.id);
      return Array.from(new Set(ids));
    }
    return [];
  }, [externalFitNodeIds, internalFitNodeIds, effectiveIsSearchActive, effectiveFilteredElements]);

  // 검색된 요소들 또는 원래 요소들 사용
  const finalElements = useMemo(() => {
    if (effectiveIsSearchActive && effectiveFilteredElements?.length > 0) {
      return effectiveFilteredElements;
    }
    return elements;
  }, [effectiveIsSearchActive, effectiveFilteredElements, elements]);

  // ref를 통해 외부에서 접근할 수 있는 함수들 노출
  useImperativeHandle(ref, () => ({
    searchTerm: effectiveSearchTerm,
    isSearchActive: effectiveIsSearchActive,
    handleSearchSubmit: shouldUseInternalSearch ? handleSearchSubmit : (() => {}),
    clearSearch: shouldUseInternalSearch ? clearSearch : (() => {})
  }), [effectiveSearchTerm, effectiveIsSearchActive, handleSearchSubmit, clearSearch, shouldUseInternalSearch]);

  return (
    <ViewerRelationGraph
      elements={finalElements}
      newNodeIds={newNodeIds}
      chapterNum={currentChapter}
      eventNum={currentEvent ? Math.max(1, currentEvent.eventNum) : 1}
      edgeLabelVisible={edgeLabelVisible}
      filename={filename}
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
      {...rest}
    />
  );
});

export default GraphContainer;
