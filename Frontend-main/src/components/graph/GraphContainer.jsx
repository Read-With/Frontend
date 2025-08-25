import React, { useEffect, useState, forwardRef, useImperativeHandle, useMemo, useCallback, useRef } from "react";
import ViewerRelationGraph from "./RelationGraph_Viewerpage";
import { loadGraphData } from "../../utils/graphDataUtils.js";
import { getEventData, getFolderKeyFromFilename, getDetectedMaxChapter } from "../../utils/graphData";
import { useGraphSearch } from "../../hooks/useGraphSearch.jsx";

const GraphContainer = forwardRef(({
  currentPosition,
  currentEvent, // 관계 변화
  currentChapter, // 관계 변화
  edgeLabelVisible = true,
  onSearchStateChange,
  onElementsUpdate, // elements 업데이트 콜백 추가
  filename, // filename prop 추가
  // 검색 관련 props 추가
  searchTerm = "",
  isSearchActive = false,
  filteredElements = [],
  fitNodeIds = [],

  ...props
}, ref) => {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 현재 챕터의 캐릭터 데이터 상태
  const [currentChapterData, setCurrentChapterData] = useState(null);
  const currentChapterDataRef = useRef(currentChapterData);
  
  // currentChapterData가 변경될 때 ref 업데이트
  useEffect(() => {
    currentChapterDataRef.current = currentChapterData;
  }, [currentChapterData]);

  // 검색 상태 변경 콜백을 useCallback으로 메모이제이션
  const handleSearchStateChange = useCallback((searchState) => {
    if (onSearchStateChange) {
      onSearchStateChange({
        ...searchState,
        currentChapterData: currentChapterDataRef.current
      });
    }
  }, [onSearchStateChange]); // currentChapterData 의존성 제거

  // useGraphSearch 훅을 사용하여 검색 기능 구현
  const {
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    filteredElements: internalFilteredElements,
    fitNodeIds: internalFitNodeIds,
    handleSearchSubmit,
    clearSearch
  } = useGraphSearch(elements, handleSearchStateChange, currentChapterData);

  // 부모에서 전달받은 검색 상태와 내부 검색 상태 동기화
  useEffect(() => {
    if (searchTerm !== internalSearchTerm) {
      if (searchTerm) {
        handleSearchSubmit(searchTerm);
      } else {
        clearSearch();
      }
    }
  }, [searchTerm]); // internalSearchTerm, handleSearchSubmit, clearSearch 의존성 제거

  // 검색 상태를 부모 컴포넌트로 전달하는 함수들
  const handleSearchSubmitWrapper = useCallback((term) => {
    handleSearchSubmit(term);
  }, [handleSearchSubmit]);

  const clearSearchWrapper = useCallback(() => {
    clearSearch();
  }, [clearSearch]);

  useEffect(() => {
    if (!currentEvent) {
      setElements([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      const eventId = currentEvent.event_id || 0; // event_id가 없으면 0으로 설정
      const chapter = currentEvent.chapter || 1;
      
      // filename을 기반으로 folderKey 결정
      const folderKey = getFolderKeyFromFilename(filename);
      
      // 공통 데이터 로딩 함수 사용
      const { elements: els, charData } = loadGraphData(folderKey, chapter, eventId, getEventData);
      
      setElements(els);
      setCurrentChapterData(charData);
      
      // 부모 컴포넌트에 elements 업데이트 알림
      if (onElementsUpdate) {
        onElementsUpdate(els);
      }
      
      setLoading(false);
    } catch (err) {
      setElements([]);
      setError("데이터 처리 중 오류 발생: " + err.message);
      setLoading(false);
    }
  }, [currentEvent, filename, onElementsUpdate]);



  // 검색된 요소들 또는 원래 요소들 사용
  const finalElements = useMemo(() => {
    if (internalIsSearchActive && internalFilteredElements && internalFilteredElements.length > 0) {
      return internalFilteredElements;
    }
    return elements;
  }, [internalIsSearchActive, internalFilteredElements, elements]);
  
  // ref를 통해 외부에서 접근할 수 있는 함수들 노출
  useImperativeHandle(ref, () => ({
    searchTerm: internalSearchTerm,
    isSearchActive: internalIsSearchActive,
    handleSearchSubmit: handleSearchSubmitWrapper,
    clearSearch: clearSearchWrapper
  }), [internalSearchTerm, internalIsSearchActive, handleSearchSubmitWrapper, clearSearchWrapper]);

  return (
    <ViewerRelationGraph
      elements={finalElements}
      chapterNum={currentChapter} // 관계 변화
      eventNum={currentEvent ? Math.max(1, currentEvent.eventNum) : 1}
      edgeLabelVisible={edgeLabelVisible}
      maxChapter={getDetectedMaxChapter(getFolderKeyFromFilename(filename))}
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
