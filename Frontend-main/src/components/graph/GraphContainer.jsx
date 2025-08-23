import React, { useEffect, useState, forwardRef, useImperativeHandle, useMemo } from "react";
import RelationGraph from "./RelationGraph";
import { filterGraphElements } from "../../utils/graphFilter";
import { convertRelationsToElements } from "../../utils/graphElementUtils";
import { getEventData, getCharactersData } from "../../utils/graphData";
import { normalizeRelation, isValidRelation } from "../../utils/relationUtils";

// 변환 로직은 공용 유틸을 사용 (기존 기능 유지)

const GraphContainer = forwardRef(({
  currentPosition,
  currentEvent, // 관계 변화
  currentChapter, // 관계 변화
  edgeLabelVisible = true,
  onSearchStateChange,
  ...props
}, ref) => {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredElements, setFilteredElements] = useState([]);
  const [fitNodeIds, setFitNodeIds] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);



  useEffect(() => {
    if (!currentEvent) {
      setElements([]);
      return;
    }

    try {
      setLoading(true);
      const eventId = currentEvent.event_id || 0; // event_id가 없으면 0으로 설정
      const chapter = currentEvent.chapter || 1;
      // 이벤트 데이터 가져오기 (event_id에 1을 더해서 파일 찾기)
      const eventData = getEventData(chapter, eventId);
      if (!eventData) {
        setElements([]);
        setError("해당 eventId의 관계 데이터가 없습니다.");
        setLoading(false);
        return;
      }

      // 캐릭터 데이터 가져오기
      const characters = getCharactersData(chapter);
      if (!characters) {
        setElements([]);
        setError("캐릭터 데이터를 찾을 수 없습니다.");
        setLoading(false);
        return;
      }

      const idToName = {};
      const idToDesc = {};
      const idToMain = {};
      const idToNames = {};

      (characters.characters || characters).forEach((char) => {
        const id = String(Math.trunc(char.id));
        idToName[id] =
          char.common_name ||
          char.name ||
          (Array.isArray(char.names) ? char.names[0] : String(char.id));
        idToDesc[id] = char.description || "";
        idToMain[id] = char.main_character || false;
        idToNames[id] = char.names || [];
      });

      const relations = (eventData.relations || [])
        .map(normalizeRelation)
        .filter(isValidRelation)
        .map(r => ({
          id1: r.id1,
          id2: r.id2,
          positivity: r.positivity,
          relation: r.relation,
          weight: r.weight,
          count: r.count,
        }));
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
    const characters = getCharactersData(chapter);
    if (!characters) return null;
    const idToName = {};
    const idToDesc = {};
    const idToMain = {};
    const idToNames = {};
    (characters.characters || characters).forEach((char) => {
      const id = String(Math.trunc(char.id));
      idToName[id] = char.common_name || char.name || (Array.isArray(char.names) ? char.names[0] : String(char.id));
      idToDesc[id] = char.description || "";
      idToMain[id] = char.main_character || false;
      idToNames[id] = char.names || [];
    });
    return { idToName, idToDesc, idToMain, idToNames };
  }, [currentEvent]);

  // 검색 처리 함수
  const handleSearchSubmit = (searchTerm) => {
    setSearchTerm(searchTerm);
    setIsSearchActive(!!searchTerm.trim());
    
    if (searchTerm.trim()) {
      const { filteredElements: filtered, fitNodeIds: fitIds } = filterGraphElements(elements, searchTerm, null);
      

      
      setFilteredElements(filtered);
      setFitNodeIds(fitIds);
    } else {
      setFilteredElements(elements);
      setFitNodeIds([]);
      setIsSearchActive(false);
    }
  };

  // 검색 초기화 함수
  const clearSearch = () => {
    setSearchTerm("");
    setFilteredElements(elements);
    setFitNodeIds([]);
    setIsSearchActive(false);
  };

  // elements가 변경될 때 검색 결과도 업데이트
  useEffect(() => {
    if (isSearchActive && searchTerm.trim()) {
      const { filteredElements: filtered, fitNodeIds: fitIds } = filterGraphElements(elements, searchTerm, null);
      if (filtered.length > 0) {
        setFilteredElements(filtered);
        setFitNodeIds(fitIds);
      } else {
        setFilteredElements(elements);
        setFitNodeIds([]);
      }
    } else if (!isSearchActive) {
      setFilteredElements(elements);
    }
  }, [elements, isSearchActive, searchTerm]);

  const finalElements = isSearchActive && filteredElements.length > 0 ? filteredElements : elements;
  

  
  // ref를 통해 외부에서 접근할 수 있는 함수들 노출
  useImperativeHandle(ref, () => ({
    handleSearchSubmit,
    clearSearch,
    searchTerm,
    isSearchActive
  }));

  // 검색 상태가 변경될 때 상위로 전달
  useEffect(() => {
    if (onSearchStateChange) {
      onSearchStateChange({
        searchTerm,
        isSearchActive,
        filteredElements,
        fitNodeIds
      });
    }
  }, [searchTerm, isSearchActive, filteredElements, fitNodeIds, onSearchStateChange]);

  return (
    <RelationGraph
      elements={finalElements}
      chapterNum={currentChapter} // 관계 변화
      eventNum={currentEvent ? Math.max(1, currentEvent.eventNum) : 1}
      edgeLabelVisible={edgeLabelVisible}
      maxChapter={10}
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
