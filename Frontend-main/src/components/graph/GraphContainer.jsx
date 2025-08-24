import React, { useEffect, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import ViewerRelationGraph from "./RelationGraph_Viewerpage";
import { convertRelationsToElements } from "../../utils/graphDataUtils.js";
import { getEventData, getCharactersData, createCharacterMaps, getFolderKeyFromFilename } from "../../utils/graphData";
import { processRelations } from "../../utils/relationUtils";
import { useGraphSearch } from "../../hooks/useGraphSearch";

const GraphContainer = forwardRef(({
  currentPosition,
  currentEvent, // 관계 변화
  currentChapter, // 관계 변화
  edgeLabelVisible = true,
  onSearchStateChange,
  filename, // filename prop 추가
  ...props
}, ref) => {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 검색 상태 관리를 useGraphSearch 훅으로 처리
  const {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    finalElements,
    handleSearchSubmit,
    clearSearch
  } = useGraphSearch(elements, onSearchStateChange);



  useEffect(() => {
    if (!currentEvent) {
      setElements([]);
      return;
    }

    try {
      setLoading(true);
      const eventId = currentEvent.event_id || 0; // event_id가 없으면 0으로 설정
      const chapter = currentEvent.chapter || 1;
      
      // filename을 기반으로 folderKey 결정
      const folderKey = getFolderKeyFromFilename(filename);
      
      // 이벤트 데이터 가져오기 (event_id에 1을 더해서 파일 찾기)
      const eventData = getEventData(folderKey, chapter, eventId);
      if (!eventData) {
        setElements([]);
        setError("해당 eventId의 관계 데이터가 없습니다.");
        setLoading(false);
        return;
      }

      // 캐릭터 데이터 가져오기
      const characters = getCharactersData(folderKey, chapter);
      if (!characters) {
        setElements([]);
        setError("캐릭터 데이터를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      // 캐릭터 데이터 매핑 생성
      const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(characters);

      // 관계 데이터 처리
      const relations = processRelations(eventData.relations);
      const els = convertRelationsToElements(
        relations,
        idToName,
        idToDesc,
        idToMain,
        idToNames
      );
      setElements(els);
      setLoading(false);
    } catch (err) {
      setElements([]);
      setError("데이터 처리 중 오류 발생: " + err);
      setLoading(false);
    }
  }, [currentEvent]);

  // Memoize character id maps by chapter
  const characterMaps = useMemo(() => {
    if (!currentEvent) return null;
    const chapter = currentEvent.chapter || 1;
    const folderKey = getFolderKeyFromFilename(filename);
    const characters = getCharactersData(folderKey, chapter);
    if (!characters) return null;
    return createCharacterMaps(characters);
  }, [currentEvent, filename]);


  

  
  // ref를 통해 외부에서 접근할 수 있는 함수들 노출
  useImperativeHandle(ref, () => ({
    handleSearchSubmit,
    clearSearch,
    searchTerm,
    isSearchActive
  }));



  return (
    <ViewerRelationGraph
      elements={finalElements}
      chapterNum={currentChapter} // 관계 변화
      eventNum={currentEvent ? Math.max(1, currentEvent.eventNum) : 1}
      edgeLabelVisible={edgeLabelVisible}
      maxChapter={10}
      filename={filename}
      fitNodeIds={fitNodeIds}
      searchTerm={searchTerm}
      isSearchActive={isSearchActive}
      filteredElements={filteredElements}
      onSearchSubmit={handleSearchSubmit}
      clearSearch={clearSearch}
      {...props}
    />
  );
});

export default GraphContainer;
