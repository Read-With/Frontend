import { getCharactersData, createCharacterMaps } from './graphData';
import { normalizeRelation, isValidRelation } from './relationUtils';

const validateElements = (elements) => elements?.filter(e => e && (e.id || e.data?.id)) || [];
const createElementMap = (elements) => new Map(elements.map(e => [e.id || e.data?.id, e]));

function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;
  
  if (typeof obj1 !== 'object') return obj1 === obj2;
  
  // 배열인 경우 빠른 비교
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!deepEqual(obj1[i], obj2[i])) return false;
    }
    return true;
  }
  
  // 객체인 경우
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  if (keys1.length !== keys2.length) return false;
  
  // Set을 사용하여 키 존재 여부를 O(1)로 확인
  const keys2Set = new Set(keys2);
  
  for (const key of keys1) {
    if (!keys2Set.has(key)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }
  
  return true;
}

/**
 * 캐릭터 이미지 경로를 동적으로 생성
 * @param {string} folderKey - 폴더 키
 * @param {string} characterId - 캐릭터 ID
 * @returns {string} 이미지 경로
 */
function getCharacterImagePath(folderKey, characterId) {
  return `/${folderKey}/${characterId}.png`;
}

/**
 * 공통 데이터 로딩 함수 - GraphContainer와 RelationGraphWrapper에서 공통으로 사용
 * @param {string} folderKey - 폴더 키
 * @param {number} chapter - 챕터 번호
 * @param {number} eventIndex - 이벤트 인덱스
 * @param {Function} getEventDataFunc - 이벤트 데이터 가져오는 함수 (getEventData 또는 getEventDataByIndex)
 * @returns {object} 로딩된 데이터
 */
export function loadGraphData(folderKey, chapter, eventIndex, getEventDataFunc) {
  // 매개변수 유효성 검사
  if (!folderKey || !chapter || !eventIndex || typeof getEventDataFunc !== 'function') {
    throw new Error(`loadGraphData: 유효하지 않은 매개변수 - folderKey: ${folderKey}, chapter: ${chapter}, eventIndex: ${eventIndex}`);
  }

  try {
    // 이벤트 데이터 로드
    const eventData = getEventDataFunc(folderKey, chapter, eventIndex);
    
    if (!eventData) {
      throw new Error(`이벤트 데이터를 찾을 수 없습니다: ${folderKey}/chapter${chapter}/event${eventIndex}`);
    }

    // 캐릭터 데이터 로드
    const charData = getCharactersData(folderKey, chapter);
    
    if (!charData) {
      throw new Error(`캐릭터 데이터를 찾을 수 없습니다: ${folderKey}/chapter${chapter}`);
    }

    // 캐릭터 매핑 생성
    const { idToName, idToDesc, idToMain, idToNames } = createCharacterMaps(charData);

    // 관계 데이터 처리
    const normalizedRelations = (eventData.relations || [])
      .map(rel => normalizeRelation(rel))
      .filter(rel => rel !== null && isValidRelation(rel));

    // 요소 변환
    const convertedElements = convertRelationsToElements(
      normalizedRelations,
      idToName,
      idToDesc,
      idToMain,
      idToNames,
      folderKey
    );

    return {
      elements: convertedElements,
      charData,
      eventData,
      normalizedRelations
    };
  } catch (error) {
    console.error('loadGraphData 에러:', error);
    throw error;
  }
}

/**
 * 관계 데이터를 그래프 요소로 변환
 * @param {Array} relations - 관계 데이터 배열
 * @param {Object} idToName - ID to name 매핑
 * @param {Object} idToDesc - ID to description 매핑
 * @param {Object} idToMain - ID to main character 매핑
 * @param {Object} idToNames - ID to names array 매핑
 * @param {string} folderKey - 폴더 키 (이미지 경로용)
 * @returns {Array} 그래프 요소 배열
 */
export function convertRelationsToElements(relations, idToName, idToDesc, idToMain, idToNames, folderKey = 'gatsby') {
  // 매개변수 유효성 검사
  if (!Array.isArray(relations)) {
    console.warn('convertRelationsToElements: relations는 배열이어야 합니다.', typeof relations);
    return [];
  }
  
  if (!idToName || typeof idToName !== 'object') {
    console.warn('convertRelationsToElements: idToName이 유효하지 않습니다.', typeof idToName);
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
    if (randomCache.size > 1000) {
      randomCache.clear();
    }
    randomCache.set(cacheKey, result);
    
    return result;
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
        image: getCharacterImagePath(folderKey, strId)
      },
      position: { x, y }
    });
  });

  // 엣지 추가
  relationsArray.forEach(rel => {
    if (rel.id1 && rel.id2) {
      const id1 = String(rel.id1);
      const id2 = String(rel.id2);
      
      // 1. id1 == id2 인 경우 제외
      if (id1 === id2) {
        console.warn(`자기 자신과의 관계는 제외됩니다: ${id1}`);
        return;
      }
      
      // 2. 노드가 0.0 인 경우 제외
      if (id1 === '0' || id2 === '0') {
        console.warn(`ID가 0인 노드와의 관계는 제외됩니다: ${id1} -> ${id2}`);
        return;
      }
      
      // 3. 해당 event에 없는 노드가 포함된 경우 제외
      if (!nodeSet.has(id1) || !nodeSet.has(id2)) {
        console.warn(`이벤트에 존재하지 않는 노드와의 관계는 제외됩니다: ${id1} -> ${id2}`);
        return;
      }
      
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
  if (!prevElements || !currElements) {
    console.warn('calcGraphDiff: prevElements 또는 currElements가 없습니다.', { prevElements: !!prevElements, currElements: !!currElements });
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
 * 노드 겹침 감지 및 자동 조정
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {number} nodeSize - 노드 크기
 * @param {Function} onCleanup - 정리 함수 (컴포넌트 언마운트 시 호출)
 * @returns {boolean} 겹침이 있었는지 여부
 */
export function detectAndResolveOverlap(cy, nodeSize = 40, onCleanup = null) {
  if (!cy) {
    console.warn('detectAndResolveOverlap: cy 인스턴스가 없습니다.');
    return false;
  }
  
  if (typeof nodeSize !== 'number' || nodeSize <= 0) {
    console.warn('detectAndResolveOverlap: 유효하지 않은 nodeSize', nodeSize);
    nodeSize = 40;
  }
  
  const nodes = cy.nodes();
  const NODE_SIZE = nodeSize;
  const MIN_DISTANCE = NODE_SIZE * 1.0;
  let hasOverlap = false;
  const timers = [];
  
  // 성능 최적화: 노드가 많을 때는 겹침 감지를 건너뜀
  if (nodes.length > 100) {
    console.warn('detectAndResolveOverlap: 노드가 너무 많아 겹침 감지를 건너뜁니다.', nodes.length);
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
