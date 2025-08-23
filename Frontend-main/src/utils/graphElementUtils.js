export function convertRelationsToElements(relations, idToName, idToDesc, idToMain, idToNames) {
  const nodeSet = new Set();
  const nodes = [];
  const edges = [];
  
  // relations가 배열인지 확인
  const relationsArray = Array.isArray(relations) ? relations : [];
  
  // 먼저 노드 id만 모두 수집
  const nodeIds = [];
  relationsArray.forEach(rel => {
    [rel.id1, rel.id2].forEach(id => {
      if (!id) return;
      const strId = String(id);
      if (!nodeSet.has(strId)) {
        nodeSet.add(strId);
        nodeIds.push(strId);
      }
    });
  });

  // id 기반 고정 랜덤 함수
  function seededRandom(id, min, max) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash) % 10000;
    return min + (seed % (max - min));
  }

  // 원 배치 좌표 계산 (id 기반 고정 랜덤 분산)
  const centerX = 500;
  const centerY = 350;
  const radius = 320;
  nodeIds.forEach((strId) => {
    // id 기반으로 각도와 반지름을 고정 랜덤하게 생성
    const angle = seededRandom(strId, 0, 360) * Math.PI / 180;
    const r = radius * (0.7 + 0.3 * (seededRandom(strId, 0, 1000) / 1000)); // 70~100% 범위
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);
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
      },
      position: { x, y }
    });
  });

  // 엣지 추가 (id1과 id2가 모두 있는 경우에만)
  relationsArray.forEach(rel => {
    if (rel.id1 && rel.id2) {
      const id1 = String(rel.id1);
      const id2 = String(rel.id2);
      if (id1 !== id2) { // 루프 간선 제외
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
            count: rel.count
          }
        });
      }
    }
  });
  
  // 노드와 엣지를 각각 id 기준 오름차순으로 정렬하여 반환
  return [
    ...nodes.sort((a, b) => a.data.id.localeCompare(b.data.id)),
    ...edges.sort((a, b) => a.data.id.localeCompare(b.data.id))
  ];
}
