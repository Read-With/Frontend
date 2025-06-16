export function convertRelationsToElements(relations, idToName, idToDesc, idToMain, idToNames) {
  const nodeSet = new Set();
  const nodes = [];
  const edges = [];
  
  // relations가 배열인지 확인
  const relationsArray = Array.isArray(relations) ? relations : [];
  
  relationsArray.forEach(rel => {
    // source/target 노드 추가
    [rel.id1, rel.id2].forEach(id => {
      if (!id) return; // id가 없는 경우 스킵
      
      const strId = String(id);
      if (!nodeSet.has(strId)) {
        nodeSet.add(strId);
        const commonName = idToName[strId] || strId;
        nodes.push({
          data: {
            id: strId,
            label: commonName,
            main_character: idToMain[strId] || false,
            description: idToDesc[strId] || '',
            names: [commonName, ...(Array.isArray(idToNames[strId]) ? idToNames[strId] : [])],
            common_name: commonName,
            image: `/gatsby/${strId}.png`
          }
        });
      }
    });
    
    // 엣지 추가 (id1과 id2가 모두 있는 경우에만)
    if (rel.id1 && rel.id2) {
      const id1 = String(rel.id1);
      const id2 = String(rel.id2);
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
          count: rel.count
        }
      });
    }
  });
  
  return [...nodes, ...edges];
}
