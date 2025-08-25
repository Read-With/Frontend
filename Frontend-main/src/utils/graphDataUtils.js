// 그래프 데이터 처리 통합 유틸리티
import { getCharactersData, createCharacterMaps } from './graphData';
import { normalizeRelation, isValidRelation } from './relationUtils';

// 공통 헬퍼 함수들
const validateElements = (elements) => elements?.filter(e => e && e.id) || [];
const createElementMap = (elements) => new Map(elements.map(e => [e.id, e]));

/**
 * 공통 데이터 로딩 함수 - GraphContainer와 RelationGraphWrapper에서 공통으로 사용
 * @param {string} folderKey - 폴더 키
 * @param {number} chapter - 챕터 번호
 * @param {number} eventIndex - 이벤트 인덱스
 * @param {Function} getEventDataFunc - 이벤트 데이터 가져오는 함수 (getEventData 또는 getEventDataByIndex)
 * @returns {object} 로딩된 데이터
 */
export function loadGraphData(folderKey, chapter, eventIndex, getEventDataFunc) {
  // 이벤트 데이터 로드
  const eventData = getEventDataFunc(folderKey, chapter, eventIndex);
  
  if (!eventData) {
    throw new Error('이벤트 데이터를 찾을 수 없습니다.');
  }

  // 캐릭터 데이터 로드
  const charData = getCharactersData(folderKey, chapter);
  
  if (!charData) {
    throw new Error('캐릭터 데이터를 찾을 수 없습니다.');
  }

  // 캐릭터 매핑 생성
  const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(charData);

  // 관계 데이터 처리
  const normalizedRelations = (eventData.relations || [])
    .map(rel => normalizeRelation(rel))
    .filter(rel => isValidRelation(rel));

  // 요소 변환
  const convertedElements = convertRelationsToElements(
    normalizedRelations,
    idToName,
    idToDesc,
    idToMain,
    idToNames
  );

  return {
    elements: convertedElements,
    charData,
    eventData,
    normalizedRelations
  };
}

/**
 * 관계 데이터를 그래프 요소로 변환
 */
export function convertRelationsToElements(relations, idToName, idToDesc, idToMain, idToNames) {
  const nodeSet = new Set();
  const nodes = [];
  const edges = [];
  
  const relationsArray = Array.isArray(relations) ? relations : [];
  
  // 노드 id 수집
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

  // 원 배치 좌표 계산
  const centerX = 500;
  const centerY = 350;
  const radius = 320;
  nodeIds.forEach((strId) => {
    const angle = seededRandom(strId, 0, 360) * Math.PI / 180;
    const r = radius * (0.7 + 0.3 * (seededRandom(strId, 0, 1000) / 1000));
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

  // 엣지 추가
  relationsArray.forEach(rel => {
    if (rel.id1 && rel.id2) {
      const id1 = String(rel.id1);
      const id2 = String(rel.id2);
      if (id1 !== id2) {
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
            relation: relationArray,
            label: relationLabel || "",
            weight: rel.weight || 1,
            positivity: rel.positivity,
            count: rel.count
          }
        });
      }
    }
  });
  
  const result = [
    ...nodes.sort((a, b) => a.data.id.localeCompare(b.data.id)),
    ...edges.sort((a, b) => a.data.id.localeCompare(b.data.id))
  ];
  
  return result;
}

/**
 * 그래프 diff 계산 (position까지 비교)
 */
export function calcGraphDiff(prevElements, currElements) {
  if (!prevElements || !currElements) return { added: [], removed: [], updated: [] };
  
  const validPrevElements = validateElements(prevElements);
  const validCurrElements = validateElements(currElements);
  
  const prevMap = createElementMap(validPrevElements);
  const currMap = createElementMap(validCurrElements);

  // 추가: 현재엔 있지만 이전엔 없는 id
  const added = validCurrElements.filter(e => !prevMap.has(e.id));
  // 삭제: 이전엔 있지만 현재엔 없는 id
  const removed = validPrevElements.filter(e => !currMap.has(e.id));
  // 수정: id는 같지만 data 또는 position이 다름
  const updated = validCurrElements.filter(e => {
    const prev = prevMap.get(e.id);
    if (!prev) return false;
    
    const dataChanged = JSON.stringify(prev) !== JSON.stringify(e);
    const pos1 = prev.position;
    const pos2 = e.position;
    const posChanged = pos1 && pos2
      ? pos1.x !== pos2.x || pos1.y !== pos2.y
      : false;
    return dataChanged || posChanged;
  });

  return { added, removed, updated };
}

/**
 * 노드 겹침 감지 및 자동 조정
 */
export function detectAndResolveOverlap(cy, nodeSize = 40) {
  if (!cy) return false;
  
  const nodes = cy.nodes();
  const NODE_SIZE = nodeSize;
  const MIN_DISTANCE = NODE_SIZE * 1.0;
  let hasOverlap = false;
  
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const node1 = nodes[i];
      const node2 = nodes[j];
      const pos1 = node1.position();
      const pos2 = node2.position();
      
      const dx = pos1.x - pos2.x;
      const dy = pos1.y - pos2.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < MIN_DISTANCE) {
        hasOverlap = true;
        const angle = Math.atan2(dy, dx);
        const pushDistance = MIN_DISTANCE - distance + 20;
        
        const newX1 = pos1.x + Math.cos(angle) * pushDistance * 0.5;
        const newY1 = pos1.y + Math.sin(angle) * pushDistance * 0.5;
        const newX2 = pos2.x - Math.cos(angle) * pushDistance * 0.5;
        const newY2 = pos2.y - Math.sin(angle) * pushDistance * 0.5;
        
        node1.position({ x: newX1, y: newY1 });
        node2.position({ x: newX2, y: newY2 });
        
        node1.addClass('bounce-effect');
        node2.addClass('bounce-effect');
        
        setTimeout(() => {
          node1.removeClass('bounce-effect');
          node2.removeClass('bounce-effect');
        }, 300);
      }
    }
  }
  
  return hasOverlap;
}
