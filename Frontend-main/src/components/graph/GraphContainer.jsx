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
  ...props
}, ref) => {
  // useGraphDataLoader 훅 사용으로 데이터 로딩 로직 통합
  const {
    elements,
    currentChapterData,
    loading,
    error
  } = useGraphDataLoader(filename, currentChapter);

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
