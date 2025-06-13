import React, { useEffect, useState } from "react";
import RelationGraph from "./RelationGraph";
import RelationGraphMain from "./RelationGraphMain";

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
  console.log("디버그 - getEventData 호출:", {
    chapter,
    num,
    eventId,
    eventIdStr,
    availableFiles: Object.keys(eventRelationModules),
  });

  const filePath = Object.keys(eventRelationModules).find((path) =>
    path.includes(`chapter${num}_relationships_event_${eventIdStr}.json`)
  );
  console.log("디버그 - 찾은 파일 경로:", filePath);

  const data = filePath ? eventRelationModules[filePath]?.default : null;
  console.log("디버그 - 로드된 데이터:", data);

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

    // 디버깅용 로그
    console.log("노드 생성 완료:", {
      id1,
      id2,
      image1: `/gatsby/${id1}.png`,
      image2: `/gatsby/${id2}.png`,
    });

    let relationLabel = "";
    if (Array.isArray(rel.relation)) {
      relationLabel = rel.relation.join(", ");
    } else if (typeof rel.relation === "string") {
      relationLabel = rel.relation;
    }
    edges.push({
      data: {
        id: `${id1}-${id2}`,
        source: id1,
        target: id2,
        relation: relationLabel || "",
        label: relationLabel || "",
        weight: rel.weight || 1,
        positivity: rel.positivity,
        count: rel.count,
      },
    });
  });
  return [...Object.values(nodes), ...edges];
}

const GraphContainer = ({
  currentPosition,
  currentEvent, // 관계 변화
  currentChapter, // 관계 변화
  ...props
}) => {
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // 디버깅: currentEvent 정보
  console.log("[GraphContainer] currentEvent:", currentEvent);
  if (currentEvent) {
    console.log(
      "[GraphContainer] eventNum:",
      currentEvent.eventNum,
      "event_id:",
      currentEvent.event_id
    );
  }

  useEffect(() => {
    if (!currentEvent) {
      setElements([]);
      return;
    }

    try {
      const eventId = currentEvent.event_id || 0; // event_id가 없으면 0으로 설정
      const chapter = currentEvent.chapter || 1;
      // 디버깅: 현재 챕터/이벤트 정보 출력
      console.log("[GraphContainer] useEffect - currentEvent:", currentEvent);
      console.log(
        "[GraphContainer] useEffect - chapter:",
        chapter,
        "eventId:",
        eventId
      );
      // 이벤트 데이터 가져오기 (event_id에 1을 더해서 파일 찾기)
      const fileEventNum = Number(eventId) + 1;
      const eventIdStr = String(fileEventNum);
      const filePath = Object.keys(eventRelationModules).find((path) =>
        path.includes(
          `chapter${chapter}_relationships_event_${eventIdStr}.json`
        )
      );
      console.log("[GraphContainer] useEffect - 불러오는 파일명:", filePath);
      const eventData = filePath
        ? eventRelationModules[filePath]?.default
        : null;
      console.log("[GraphContainer] useEffect - eventData:", eventData);
      if (!eventData) {
        setElements([]);
        setError("해당 eventId의 관계 데이터가 없습니다.");
        return;
      }

      // 캐릭터 데이터 가져오기
      const characters = getCharactersData(chapter);
      console.log("[GraphContainer] useEffect - characters:", characters);
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

      const relations = eventData.relations || [];
      console.log("[GraphContainer] useEffect - relations:", relations);
      const els = convertRelationsToElements(
        relations,
        idToName,
        idToDesc,
        idToMain,
        idToNames
      );
      console.log("[GraphContainer] useEffect - elements:", els);
      setElements(els);
      setLoading(false);
    } catch (err) {
      setElements([]);
      setError("데이터 처리 중 오류 발생: " + err);
    }
  }, [currentEvent]);

  return (
    <RelationGraph
      elements={elements}
      chapterNum={currentChapter} // 관계 변화
      eventNum={currentEvent ? Math.max(1, currentEvent.eventNum) : 1}
      {...props}
    />
  );
};

export default GraphContainer;
