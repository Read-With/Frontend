import { getCharactersData, createCharacterMapsWithCache } from './graphData';
import { createCharacterMaps, getCharacterImagePath } from './characterUtils';
import { normalizeRelation, isValidRelation } from './relationUtils';

/**
 * 이벤트 텍스트에서 첫 번째 단어를 추출하는 함수
 * @param {string} text - 이벤트 텍스트
 * @returns {string} 첫 번째 단어 (문자, 숫자, 하이픈만 포함)
 */
function getFirstWordFromEventText(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  // 텍스트를 단어로 분리하고 첫 번째 단어 추출
  const words = text.trim().split(/\s+/);
  if (words.length === 0) {
    return '';
  }
  
  // 첫 번째 단어에서 문자, 숫자, 하이픈만 추출
  const firstWord = words[0].replace(/[^a-zA-Z0-9가-힣-]/g, '');
  return firstWord || '';
}

const validateElements = (elements) => elements?.filter(e => e && (e.id || e.data?.id)) || [];
const createElementMap = (elements) => new Map(elements.map(e => [e.id || e.data?.id, e]));

function deepEqual(obj1, obj2, depth = 0) {
  // 최대 깊이 제한 (무한 재귀 방지)
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    return obj1 === obj2;
  }
  
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;
  
  if (typeof obj1 !== 'object') return obj1 === obj2;
  
  // 배열인 경우 빠른 비교
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    // 큰 배열의 경우 성능 최적화
    if (obj1.length > 100) {
      // 큰 배열은 참조 비교로 대체
      return obj1 === obj2;
    }
    for (let i = 0; i < obj1.length; i++) {
      if (!deepEqual(obj1[i], obj2[i], depth + 1)) return false;
    }
    return true;
  }
  
  // 객체인 경우
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  if (keys1.length !== keys2.length) return false;
  
  // 큰 객체의 경우 성능 최적화
  if (keys1.length > 50) {
    // 큰 객체는 참조 비교로 대체
    return obj1 === obj2;
  }
  
  // Set을 사용하여 키 존재 여부를 O(1)로 확인
  const keys2Set = new Set(keys2);
  
  for (const key of keys1) {
    if (!keys2Set.has(key)) return false;
    if (!deepEqual(obj1[key], obj2[key], depth + 1)) return false;
  }
  
  return true;
}



/**
 * 관계 데이터를 그래프 요소로 변환 (새로운 JSON 구조 대응)
 * @param {Array} relations - 관계 데이터 배열
 * @param {Object} idToName - ID to name 매핑
 * @param {Object} idToDesc - ID to description 매핑
 * @param {Object} idToMain - ID to main character 매핑
 * @param {Object} idToNames - ID to names array 매핑
 * @param {string} folderKey - 폴더 키 (이미지 경로용)
 * @param {Object} nodeWeights - 노드 가중치 정보 (node_weights_accum)
 * @param {Object} previousRelations - 이전 이벤트의 관계 데이터
 * @param {Object} eventData - 이벤트 데이터 (text 필드 포함)
 * @param {Object} idToProfileImage - ID to profileImage 매핑 (API 책용)
 * @returns {Array} 그래프 요소 배열
 */
export function convertRelationsToElements(relations, idToName, idToDesc, idToDescKo, idToMain, idToNames, folderKey, nodeWeights = null, previousRelations = null, eventData = null, idToProfileImage = null) {
  // 매개변수 유효성 검사
  if (!Array.isArray(relations)) {
    return [];
  }
  
  if (!idToName || typeof idToName !== 'object') {
    return [];
  }
  
  if (!folderKey || typeof folderKey !== 'string') {
    return [];
  }

  const nodeSet = new Set();
  const nodes = [];
  const edges = [];
  
  const relationsArray = relations;
  
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
  

  // id 기반 고정 랜덤 함수 (캐싱으로 성능 개선)
  const randomCache = new Map();
  function seededRandom(id, min, max) {
    const cacheKey = `${id}-${min}-${max}`;
    if (randomCache.has(cacheKey)) {
      return randomCache.get(cacheKey);
    }
    
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash) + id.charCodeAt(i);
      hash |= 0;
    }
    const seed = Math.abs(hash) % 10000;
    const result = min + (seed % (max - min));
    
  // 캐시 크기 제한 (메모리 누수 방지)
  const MAX_CACHE_SIZE = 500;
  if (randomCache.size > MAX_CACHE_SIZE) {
    // 전체 캐시를 지우는 대신 절반만 지우기
    const entries = Array.from(randomCache.entries());
    const toDelete = entries.slice(0, Math.floor(MAX_CACHE_SIZE / 2));
    toDelete.forEach(([key]) => randomCache.delete(key));
  }
    randomCache.set(cacheKey, result);
    
    return result;
  }

  // 캐릭터 정보가 있는 노드만 필터링 (character 데이터에 존재하는 ID만 허용)
  const validNodeIds = nodeIds.filter(strId => {
    const hasName = idToName[strId] && idToName[strId] !== strId;
    const hasValidId = strId && strId !== '0' && strId !== 'undefined' && strId !== 'null';
    
    // 캐릭터 데이터에 없는 ID는 제외
    if (!hasName) {
      nodeSet.delete(strId); // nodeSet에서도 제거
      console.warn(`캐릭터 데이터에 없는 노드 제외 (ID: ${strId})`);
      return false;
    }
    
    return hasValidId;
  });
  

  // 노드 가중치 기반 크기 계산
  const getNodeWeight = (nodeId) => {
    if (!nodeWeights) {
      return 3;
    }
    if (nodeWeights[nodeId]) {
      const weight = nodeWeights[nodeId].weight;
      if (typeof weight === 'number' && weight > 0) {
        return weight;
      }
    }
    return 3;
  };

  // 원 배치 좌표 계산
  const centerX = 500;
  const centerY = 350;
  const radius = 320;
  validNodeIds.forEach((strId) => {
    const angle = seededRandom(strId, 0, 360) * Math.PI / 180;
    const r = radius * (0.7 + 0.3 * (seededRandom(strId, 0, 1000) / 1000));
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);
    const commonName = idToName[strId];
    const nodeWeight = getNodeWeight(strId);
    
    // 이미지 경로 결정
    let imagePath = null;
    
    if (folderKey === 'api') {
      // API 책: profileImage가 유효한 경우에만 사용
      // profileImage가 없으면 이미지 경로를 생성하지 않음 (401 에러 방지)
      if (idToProfileImage && idToProfileImage[strId] && idToProfileImage[strId].trim() !== '') {
        imagePath = idToProfileImage[strId];
      }
      // profileImage가 없으면 imagePath는 null로 유지 (이미지 없음)
    } else {
      // 로컬 책: 항상 이미지 경로 생성 (이미지 파일 존재 여부는 체크하지 않음)
      imagePath = getCharacterImagePath(folderKey, strId);
    }
    
    // 노드 데이터 생성
    const nodeData = {
      id: strId,
      label: commonName,
      main_character: idToMain[strId] || false,
      description: idToDesc[strId] || '',
      description_ko: idToDescKo[strId] || '',
      names: [commonName, ...(Array.isArray(idToNames[strId]) ? idToNames[strId] : [])],
      common_name: commonName,
      weight: nodeWeight
    };
    
    // 이미지 경로가 있으면 image 필드 추가
    if (imagePath && imagePath.trim() !== '') {
      nodeData.image = imagePath;
    }
    
    nodes.push({
      data: nodeData,
      position: { x, y }
    });
  });

  // 이전 이벤트의 관계를 Set으로 변환 (빠른 검색을 위해)
  const previousRelationSet = new Set();
  if (previousRelations && Array.isArray(previousRelations)) {
    previousRelations.forEach(prevRel => {
      if (prevRel.id1 && prevRel.id2) {
        const prevId1 = String(prevRel.id1);
        const prevId2 = String(prevRel.id2);
        previousRelationSet.add(`${prevId1}-${prevId2}`);
        previousRelationSet.add(`${prevId2}-${prevId1}`); // 양방향 관계 고려
      }
    });
  }

  // 간선 통합을 위한 Map (노드 쌍을 키로 사용)
  const edgeMap = new Map();
  
  // 엣지 추가 및 통합
  
  relationsArray.forEach((rel, index) => {
    
    if (rel.id1 && rel.id2) {
      const id1 = String(rel.id1);
      const id2 = String(rel.id2);
      
      // 1. id1 == id2 인 경우 제외
      if (id1 === id2) {
        return;
      }
      
      // 2. 노드가 0.0 인 경우 제외
      if (id1 === '0' || id2 === '0') {
        return;
      }
      
      // 3. 해당 event에 없는 노드가 포함된 경우 - 더 관대한 처리
      if (!nodeSet.has(id1) || !nodeSet.has(id2)) {
        return;
      }
      
      // 노드 쌍을 정규화된 키로 변환 (작은 ID가 앞에 오도록)
      const edgeKey = id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
      const source = id1 < id2 ? id1 : id2;
      const target = id1 < id2 ? id2 : id1;
      
      let relationArray = [];
      let relationLabel = "";
      
      // 이벤트 데이터에서 첫 번째 단어를 가져와서 라벨로 사용
      if (eventData && eventData.text) {
        relationLabel = getFirstWordFromEventText(eventData.text);
      }
      
      if (Array.isArray(rel.relation)) {
        relationArray = rel.relation;
        // 이벤트 텍스트에서 첫 번째 단어를 가져오지 못한 경우에만 기존 로직 사용
        if (!relationLabel) {
          // 이전 이벤트와 비교하여 새로 추가된 관계인지 확인
          const isNewRelation = !previousRelationSet.has(`${id1}-${id2}`) && !previousRelationSet.has(`${id2}-${id1}`);
          
          if (isNewRelation || !previousRelations) {
            // 새로 추가된 관계이거나 첫 번째 이벤트인 경우: 첫 번째 요소를 라벨로 사용
            relationLabel = rel.relation[0] || "";
          } else {
            // 기존 관계인 경우: 이전 이벤트에서의 관계와 비교하여 새로 추가된 요소 찾기
            const prevRel = previousRelations.find(prevRel => 
              (String(prevRel.id1) === id1 && String(prevRel.id2) === id2) ||
              (String(prevRel.id1) === id2 && String(prevRel.id2) === id1)
            );
            
            if (prevRel && Array.isArray(prevRel.relation)) {
              // 이전 관계에서 새로 추가된 요소 찾기
              const newElements = rel.relation.filter(element => !prevRel.relation.includes(element));
              relationLabel = newElements.length > 0 ? newElements[0] : rel.relation[0] || "";
            } else {
              relationLabel = rel.relation[0] || "";
            }
          }
        }
      } else if (typeof rel.relation === "string") {
        relationArray = [rel.relation];
        // 이벤트 텍스트에서 첫 번째 단어를 가져오지 못한 경우에만 기존 값 사용
        if (!relationLabel) {
          relationLabel = rel.relation;
        }
      }
      
      // 기존 간선이 있는지 확인
      if (edgeMap.has(edgeKey)) {
        // 기존 간선에 관계 추가
        const existingEdge = edgeMap.get(edgeKey);
        existingEdge.data.relation = [...new Set([...existingEdge.data.relation, ...relationArray])]; // 중복 제거
        
        // 새로 추가된 관계가 있으면 라벨을 새로 추가된 관계의 첫 번째 요소로 업데이트
        if (relationLabel) {
          existingEdge.data.label = relationLabel;
        }
      } else {
        // 새로운 간선 생성
        edgeMap.set(edgeKey, {
          data: {
            id: edgeKey,
            source: source,
            target: target,
            relation: relationArray,
            label: relationLabel || "",
            positivity: rel.positivity,
          }
        });
      }
    }
  });
  
  // Map에서 간선들을 배열로 변환
  edges.push(...Array.from(edgeMap.values()));
  
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
  if (!prevElements || !currElements) {
    return { added: [], removed: [], updated: [] };
  }
  
  const validPrevElements = validateElements(prevElements);
  const validCurrElements = validateElements(currElements);
  const prevMap = createElementMap(validPrevElements);
  const currMap = createElementMap(validCurrElements);

  // 추가: 현재엔 있지만 이전엔 없는 id
  const added = validCurrElements.filter(e => !prevMap.has(e.id || e.data?.id));
  // 삭제: 이전엔 있지만 현재엔 없는 id
  const removed = validPrevElements.filter(e => !currMap.has(e.id || e.data?.id));
  // 수정: id는 같지만 data 또는 position이 다름
  const updated = validCurrElements.filter(e => {
    const elementId = e.id || e.data?.id;
    const prev = prevMap.get(elementId);
    if (!prev) return false;
    
    // 성능 개선: 깊은 비교 대신 필요한 부분만 비교
    const dataChanged = !deepEqual(prev.data, e.data);
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
 * 3단계 필터링 로직 (RelationGraphWrapper와 ViewerPage에서 공통 사용)
 * @param {Array} elements - 그래프 요소 배열
 * @param {number} filterStage - 필터링 단계 (0: 전체, 1: 핵심인물만, 2: 핵심인물과 연결된 인물)
 * @returns {Array} 필터링된 요소 배열
 */
export function filterMainCharacters(elements, filterStage) {
  if (filterStage === 0 || !elements) return elements;
  
  // 핵심 인물 (main_character: true) 노드들
  const coreNodes = elements.filter(el => 
    el.data && 
    el.data.id && 
    !el.data.source && 
    el.data.main_character === true
  );
  
  const coreNodeIds = new Set(coreNodes.map(node => node.data.id));
  
  // 주요 인물 (main_character: false이지만 중요한 인물) 노드들
  const importantNodes = elements.filter(el => 
    el.data && 
    el.data.id && 
    !el.data.source && 
    el.data.main_character === false &&
    el.data.importance && el.data.importance > 0.5 // 중요도 임계값
  );
  
  const importantNodeIds = new Set(importantNodes.map(node => node.data.id));
  
  let filteredNodes = [];
  let filteredEdges = [];
  
  if (filterStage === 1) {
    // 1단계: 핵심인물끼리의 연결만
    filteredNodes = coreNodes;
    filteredEdges = elements.filter(el => 
      el.data && 
      el.data.source && 
      el.data.target &&
      coreNodeIds.has(el.data.source) && 
      coreNodeIds.has(el.data.target)
    );
  } else if (filterStage === 2) {
    // 2단계: 핵심인물과 핵심인물에 연결된 노드(핵심인물, 비핵심인물) + 간선
    // 핵심 인물과 연결된 간선들 찾기
    const connectedEdges = elements.filter(el => 
      el.data && 
      el.data.source && 
      el.data.target &&
      // 최소 하나의 노드는 핵심 인물이어야 함
      (coreNodeIds.has(el.data.source) || coreNodeIds.has(el.data.target))
    );
    
    // 연결된 노드들의 ID 수집
    const connectedNodeIds = new Set();
    connectedEdges.forEach(edge => {
      if (edge.data.source) connectedNodeIds.add(edge.data.source);
      if (edge.data.target) connectedNodeIds.add(edge.data.target);
    });
    
    // 핵심 인물과 연결된 모든 노드들
    const connectedNodes = elements.filter(el => 
      el.data && 
      el.data.id && 
      !el.data.source && 
      connectedNodeIds.has(el.data.id)
    );
    
    filteredNodes = connectedNodes;
    filteredEdges = connectedEdges;
  }
  
  return [...filteredNodes, ...filteredEdges];
}

/**
 * 노드 겹침 감지 및 자동 조정
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {number} nodeSize - 노드 크기
 * @param {Function} onCleanup - 정리 함수 (컴포넌트 언마운트 시 호출)
 * @returns {boolean} 겹침이 있었는지 여부
 */
export function detectAndResolveOverlap(cy, nodeSize = 40, onCleanup = null) {
  if (!cy) {
    return false;
  }
  
  if (typeof nodeSize !== 'number' || nodeSize <= 0) {
    nodeSize = 40;
  }
  
  const nodes = cy.nodes();
  const NODE_SIZE = nodeSize;
  const MIN_DISTANCE = NODE_SIZE * 1.0;
  let hasOverlap = false;
  const timers = [];
  
  // 성능 최적화: 노드가 많을 때는 겹침 감지를 건너뜀
  const MAX_NODES_FOR_OVERLAP_DETECTION = 100;
  if (nodes.length > MAX_NODES_FOR_OVERLAP_DETECTION) {
    return false;
  }

  // 위치 캐싱으로 성능 개선
  const nodePositions = nodes.map(node => ({
    node,
    pos: node.position()
  }));

  for (let i = 0; i < nodePositions.length; i++) {
    for (let j = i + 1; j < nodePositions.length; j++) {
      const { node: node1, pos: pos1 } = nodePositions[i];
      const { node: node2, pos: pos2 } = nodePositions[j];
      
      const dx = pos1.x - pos2.x;
      const dy = pos1.y - pos2.y;
      const distanceSquared = dx * dx + dy * dy; // 제곱근 계산 생략으로 성능 개선
      
      if (distanceSquared < MIN_DISTANCE * MIN_DISTANCE) {
        hasOverlap = true;
        const distance = Math.sqrt(distanceSquared);
        const angle = Math.atan2(dy, dx);
        const pushDistance = MIN_DISTANCE - distance + 20;
        
        const newX1 = pos1.x + Math.cos(angle) * pushDistance * 0.5;
        const newY1 = pos1.y + Math.sin(angle) * pushDistance * 0.5;
        const newX2 = pos2.x - Math.cos(angle) * pushDistance * 0.5;
        const newY2 = pos2.y - Math.sin(angle) * pushDistance * 0.5;
        
        node1.position({ x: newX1, y: newY1 });
        node2.position({ x: newX2, y: newY2 });
        
        // 위치 캐시 업데이트
        nodePositions[i].pos = { x: newX1, y: newY1 };
        nodePositions[j].pos = { x: newX2, y: newY2 };
        
        node1.addClass('bounce-effect');
        node2.addClass('bounce-effect');
        
        const timer = setTimeout(() => {
          if (node1 && node1.removeClass) node1.removeClass('bounce-effect');
          if (node2 && node2.removeClass) node2.removeClass('bounce-effect');
        }, 300);
        
        timers.push(timer);
      }
    }
  }
  
  // 정리 함수가 제공되면 타이머들을 저장
  if (onCleanup && typeof onCleanup === 'function') {
    onCleanup(() => {
      timers.forEach(timer => clearTimeout(timer));
    });
  }
  
  return hasOverlap;
}
