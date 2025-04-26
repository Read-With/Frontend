import React from "react";
import charactersData from "../../data/characters.json";
import relationsData from "../../data/relations.json";
import CharacterRelationGraph from "./RelationGraph";

function CharacterRelationGraphWrapper() {
  // 캐릭터 데이터를 노드로 변환
  const nodes = charactersData.characters.map((char) => ({
    data: {
      id: String(char.id),
      label: char.common_name,
      main: char.main_character,
      description: char.description,
      names: char.names,
    },
  }));

  // 관계 데이터를 엣지로 변환
  const edges = relationsData.relations.map((rel, idx) => ({
    data: {
      id: `e${idx}`,
      source: String(rel.id1),
      target: String(rel.id2),
      label: rel.relation.join(", "),
      explanation: rel.explanation,
      positivity: rel.positivity,
      weight: rel.weight,
    },
  }));

  // Cytoscape.js에 전달할 elements 배열 생성
  const elements = [...nodes, ...edges];

  return <CharacterRelationGraph elements={elements} />;
}

export default CharacterRelationGraphWrapper;
