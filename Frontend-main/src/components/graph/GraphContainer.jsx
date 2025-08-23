import React, { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import RelationGraph from "./RelationGraph";
import { filterGraphElements } from "../../utils/graphFilter";

// 이벤트 관계 데이터를 동적으로 가져오기
const eventRelationModules = import.meta.glob(
  "../../data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);
const charactersModules = import.meta.glob(
  "../../data/gatsby/c_chapter*_0.json",
  { eager: true }
);

function getEventData(chapter, eventId) {
  const num = String(chapter);
  // eventId에 1을 더해서 파일명을 찾음
  const fileEventNum = Number(eventId) + 1;
  const eventIdStr = String(fileEventNum);

  const filePath = Object.keys(eventRelationModules).find((path) =>
    path.includes(`chapter${num}_relationships_event_${eventIdStr}.json`)
  );

  const data = filePath ? eventRelationModules[filePath]?.default : null;

  return data;
}

function getCharactersData(chapter) {
  const num = String(chapter);
  const filePath = Object.keys(charactersModules).find((path) =>
    path.includes(`c_chapter${num}_0.json`)
  );
  return filePath ? charactersModules[filePath]?.default : null;
}

function convertRelationsToElements(
  relations,
  idToName,
  idToDesc,
  idToMain,
  idToNames
) {
  const nodes = {};
  const edges = [];
  relations.forEach((rel) => {
    const id1 = String(rel.id1);
    const id2 = String(rel.id2);
    nodes[id1] = {
      data: {
        id: id1,
        label: idToName[id1] || id1,
        description: idToDesc[id1] || "",
        main_character: idToMain[id1] || false,
        names: idToNames[id1] || [],
        image: `/gatsby/${id1}.png`, // 이미지 경로 추가
      },
    };
    nodes[id2] = {
      data: {
        id: id2,
        label: idToName[id2] || id2,
        description: idToDesc[id2] || "",
        main_character: idToMain[id2] || false,
        names: idToNames[id2] || [],
        image: `/gatsby/${id2}.png`, // 이미지 경로 추가
      },
    };

    // relation 배열을 그대로 유지하고, label에는 첫 번째 요소만 사용
    let relationArray = [];
    let relationLabel = "";
    
    if (Array.isArray(rel.relation)) {
      relationArray = rel.relation;
      relationLabel = rel.relation[0] || "";
    } else if (typeof rel.relation === "string") {
      relationArray = [rel.relation];
      relationLabel = rel.relation;
    }
    
    edges.push({
      data: {
        id: `${id1}-${id2}`,
        source: id1,
        target: id2,
        relation: relationArray, // 전체 배열 유지
        label: relationLabel || "", // 라벨에는 첫 번째 요소만
        weight: rel.weight || 1,
        positivity: rel.positivity,
        count: rel.count,
      },
    });
  });
  return [...Object.values(nodes), ...edges];
}

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
      const eventId = currentEvent.event_id || 0; // event_id가 없으면 0으로 설정
      const chapter = currentEvent.chapter || 1;
      // 이벤트 데이터 가져오기 (event_id에 1을 더해서 파일 찾기)
      const fileEventNum = Number(eventId) + 1;
      const eventIdStr = String(fileEventNum);
      const filePath = Object.keys(eventRelationModules).find((path) =>
        path.includes(
          `chapter${chapter}_relationships_event_${eventIdStr}.json`
        )
      );
      const eventData = filePath
        ? eventRelationModules[filePath]?.default
        : null;
      if (!eventData) {
        setElements([]);
        setError("해당 eventId의 관계 데이터가 없습니다.");
        return;
      }

      // 캐릭터 데이터 가져오기
      const characters = getCharactersData(chapter);
      if (!characters) {
        setElements([]);
        setError("캐릭터 데이터를 찾을 수 없습니다.");
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

      const relations = (eventData.relations || []).filter(rel => {
        const id1 = Number(rel.id1);
        const id2 = Number(rel.id2);
        return id1 !== 0 && id2 !== 0 && id1 !== id2;
      });
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
    }
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
