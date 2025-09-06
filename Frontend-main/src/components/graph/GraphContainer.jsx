import React, { useEffect, useState, forwardRef, useImperativeHandle, useMemo, useCallback } from "react";
import ViewerRelationGraph from "./RelationGraph_Viewerpage";
import { useGraphDataLoader } from "../../hooks/useGraphDataLoader.js";
import { useGraphSearch } from "../../hooks/useGraphSearch.jsx";

const GraphContainer = forwardRef(({
  currentPosition,
  currentEvent,
  currentChapter,
  edgeLabelVisible = true,
  onSearchStateChange,
  onElementsUpdate,
  filename,
  elements: externalElements, // 외부에서 전달받은 elements
  ...props
}, ref) => {

  // ViewerPage에서는 externalElements를 사용하므로 useGraphDataLoader 비활성화
  const {
    elements: internalElements,
    newNodeIds,
    currentChapterData,
    loading,
    error
  } = useGraphDataLoader(filename, externalElements ? null : null);

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

  // useGraphSearch 훅을 사용하여 검색 기능 구현
  const {
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    filteredElements: internalFilteredElements,
    fitNodeIds: internalFitNodeIds,
    handleSearchSubmit,
    clearSearch
  } = useGraphSearch(elements, handleSearchStateChange, currentChapterData);

  // 검색된 요소들 또는 원래 요소들 사용
  const finalElements = useMemo(() => {
    if (internalIsSearchActive && internalFilteredElements?.length > 0) {
      return internalFilteredElements;
    }
    return elements;
  }, [internalIsSearchActive, internalFilteredElements, elements]);

  // ref를 통해 외부에서 접근할 수 있는 함수들 노출
  useImperativeHandle(ref, () => ({
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    handleSearchSubmit,
    clearSearch
  }), [internalSearchTerm, internalIsSearchActive, handleSearchSubmit, clearSearch]);

  return (
    <ViewerRelationGraph
      elements={finalElements}
      newNodeIds={newNodeIds}
      chapterNum={currentChapter}
      eventNum={currentEvent ? Math.max(1, currentEvent.eventNum) : 1}
      edgeLabelVisible={edgeLabelVisible}
      filename={filename}
      fitNodeIds={internalFitNodeIds}
      searchTerm={internalSearchTerm}
      isSearchActive={internalIsSearchActive}
      filteredElements={internalFilteredElements}
      {...props}
    />
  );
});

export default GraphContainer;
