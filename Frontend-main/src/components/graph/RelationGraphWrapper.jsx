import React from "react";
import charactersData from "../../data/Gatsby_01_characters.json";
import relationsData from "../../data/Gatsby_01_relations.json";
import RelationGraphMain from "./RelationGraphMain";
import { useParams } from "react-router-dom";

function RelationGraphWrapper() {
  const { filename } = useParams();
  if (!filename) return;

  const nodes = charactersData.characters.map((char) => ({
    data: {
      id: String(char.id),
      label: char.common_name,
      main: char.main_character,
      description: char.description,
      names: char.names,
    },
  }));

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

  const elements = [...nodes, ...edges];

  return <RelationGraphMain elements={elements} />;
}

export default RelationGraphWrapper;
