import { extractCharacterId, isNodeWeightEntryVisible } from './characterUtils';
import { normalizeRelation, isValidRelation, directedEdgeElementId, relationEventMetaPassthrough } from './relationUtils';
import {
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
  sortElementsByDataId,
  undirectedPairKey,
  uniqueStrings,
} from './graphUtils';
import { eventUtils } from '../viewer/viewerCoreStateUtils';
import { toPositiveInt } from '../common/valueUtils';

function mergeEdgeLabels(a, b) {
  const t1 = String(a ?? '').trim();
  const t2 = String(b ?? '').trim();
  if (!t2 || t2 === t1) return t1;
  if (!t1) return t2;
  return `${t1} / ${t2}`;
}

function mergePositivity(a, b) {
  const n1 = Number(a);
  const n2 = Number(b);
  const f1 = Number.isFinite(n1);
  const f2 = Number.isFinite(n2);
  if (f1 && f2) return (n1 + n2) / 2;
  if (f1) return n1;
  if (f2) return n2;
  return undefined;
}

function normalizedRelationTagKey(data) {
  return uniqueStrings(Array.isArray(data?.relation) ? data.relation : []).sort().join('\x1e');
}

function positivityToken(data) {
  const n = Number(data?.positivity);
  return Number.isFinite(n) ? n : null;
}

/** 역방향 두 간선의 관계(태그·positivity)가 동일한지 — 동일하면 `-` 한 줄로 합침 */
function relationPayloadEquivalent(d0, d1) {
  if (normalizedRelationTagKey(d0) !== normalizedRelationTagKey(d1)) {
    return false;
  }
  const p0 = positivityToken(d0);
  const p1 = positivityToken(d1);
  if (p0 === null && p1 === null) return true;
  if (p0 === null || p1 === null) return false;
  return p0 === p1;
}

/** 단방향 `a->b` / 동일 역쌍 `a-b` / 다른 역쌍 `reciprocalPair` */
function finalizeDirectedEdges(edgeMap) {
  const list = Array.from(edgeMap.values());
  const buckets = new Map();
  for (const el of list) {
    const uk = undirectedPairKey(el.data.source, el.data.target);
    if (!buckets.has(uk)) buckets.set(uk, []);
    buckets.get(uk).push(el);
  }

  const out = [];
  for (const [, group] of buckets) {
    if (group.length === 1) {
      const d = { ...group[0].data };
      delete d.bidirectional;
      out.push({ data: d });
      continue;
    }
    if (group.length !== 2) {
      for (const el of group) {
        const d = { ...el.data };
        delete d.bidirectional;
        out.push({ data: d });
      }
      continue;
    }
    const e0 = group[0];
    const e1 = group[1];
    const s0 = e0.data.source;
    const t0 = e0.data.target;
    const s1 = e1.data.source;
    const t1 = e1.data.target;
    if (s0 === t1 && t0 === s1) {
      if (relationPayloadEquivalent(e0.data, e1.data)) {
        const [a, b] = String(s0) <= String(t0) ? [s0, t0] : [t0, s0];
        const r0 = Array.isArray(e0.data.relation) ? e0.data.relation : [];
        const r1 = Array.isArray(e1.data.relation) ? e1.data.relation : [];
        const pos = mergePositivity(e0.data.positivity, e1.data.positivity);
        const baseData = {
          id: `${a}-${b}`,
          source: a,
          target: b,
          bidirectional: true,
          relation: uniqueStrings([...r0, ...r1]),
          label: mergeEdgeLabels(e0.data.label, e1.data.label),
        };
        if (Number.isFinite(Number(pos))) {
          baseData.positivity = pos;
        } else if (e0.data.positivity !== undefined) {
          baseData.positivity = e0.data.positivity;
        } else if (e1.data.positivity !== undefined) {
          baseData.positivity = e1.data.positivity;
        }
        out.push({ data: baseData });
      } else {
        for (const el of group) {
          const d = { ...el.data };
          delete d.bidirectional;
          d.reciprocalPair = true;
          out.push({ data: d });
        }
      }
    } else {
      for (const el of group) {
        const d = { ...el.data };
        delete d.bidirectional;
        out.push({ data: d });
      }
    }
  }
  return out;
}

function toPositiveIntOrNaN(value) {
  return toPositiveInt(value) ?? NaN;
}

function isRelationVisibleAtEvent(rel, eventData) {
  if (!eventData || typeof eventData !== 'object') return true;

  const targetChapter = toPositiveIntOrNaN(
    eventUtils.resolveChapterIdx(eventData) ?? eventData.chapterIdx ?? eventData.chapter
  );
  const targetEventIdx = toPositiveIntOrNaN(eventUtils.resolveEventOrdinal(eventData));

  const meta = relationEventMetaPassthrough(rel);
  const relationChapter = toPositiveIntOrNaN(meta.chapterIdx);
  const relationEventIdx = toPositiveIntOrNaN(
    eventUtils.resolveEventOrdinal(rel) ??
    eventUtils.resolveEventOrdinal(meta) ??
    rel?.event_id ??
    rel?.event?.event_id
  );

  if (Number.isFinite(targetChapter) && Number.isFinite(relationChapter)) {
    if (relationChapter > targetChapter) return false;
    if (relationChapter < targetChapter) return true;
    if (Number.isFinite(targetEventIdx) && Number.isFinite(relationEventIdx)) {
      return relationEventIdx <= targetEventIdx;
    }
    return true;
  }

  if (Number.isFinite(targetEventIdx) && Number.isFinite(relationEventIdx)) {
    return relationEventIdx <= targetEventIdx;
  }

  return true;
}

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

const validateElements = (elements) => elements?.filter(e => e && normalizeElementId(e)) || [];
const createElementMap = (elements) => new Map(elements.map(e => [normalizeElementId(e), e]));

function deepEqual(obj1, obj2, depth = 0) {
  const MAX_DEPTH = 10;
  if (depth > MAX_DEPTH) {
    return obj1 === obj2;
  }

  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== typeof obj2) return false;

  if (typeof obj1 !== 'object') return obj1 === obj2;

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    for (let i = 0; i < obj1.length; i++) {
      if (!deepEqual(obj1[i], obj2[i], depth + 1)) return false;
    }
    return true;
  }

  if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  const keys2Set = new Set(keys2);

  for (const key of keys1) {
    if (!keys2Set.has(key)) return false;
    if (!deepEqual(obj1[key], obj2[key], depth + 1)) return false;
  }

  return true;
}



/**
 * 관계 데이터를 그래프 요소로 변환
 * @param {Object} params
 * @param {Array} params.relations
 * @param {Object} params.idToName
 * @param {Object} [params.idToDesc]
 * @param {Object} [params.idToDescKo]
 * @param {Object} [params.idToMain]
 * @param {Object} [params.idToNames]
 * @param {Object|null} [params.nodeWeights]
 * @param {Array|null} [params.previousRelations]
 * @param {Object|null} [params.eventData]
 * @param {Object|null} [params.idToProfileImage]
 * @param {Array|null} [params.charactersOrphanMerge]
 * @returns {Array}
 */
export function convertRelationsToElements({
  relations,
  idToName,
  idToDesc = {},
  idToDescKo = {},
  idToMain = {},
  idToNames = {},
  nodeWeights = null,
  previousRelations = null,
  eventData = null,
  idToProfileImage = null,
  charactersOrphanMerge = null,
} = {}) {
  if (!Array.isArray(relations)) {
    return [];
  }

  if (!idToName || typeof idToName !== 'object') {
    return [];
  }

  const nodeSet = new Set();
  const nodes = [];
  const edges = [];

  const nodeIds = [];
  relations.forEach((rel) => {
    const r = normalizeRelation(rel);
    if (!isValidRelation(r)) return;
    [r.id1, r.id2].forEach((id) => {
      const strId = String(id);
      if (!strId || strId === '0') return;
      if (!nodeSet.has(strId)) {
        nodeSet.add(strId);
        nodeIds.push(strId);
      }
    });
  });

  if (Array.isArray(charactersOrphanMerge) && charactersOrphanMerge.length > 0) {
    charactersOrphanMerge.forEach((char) => {
      if (!char) return;
      const strId =
        extractCharacterId(char) ||
        (char.id != null && String(char.id).trim() !== '' ? String(char.id).trim() : null);
      if (!strId || strId === '0') return;
      if (!nodeSet.has(strId)) {
        nodeSet.add(strId);
        nodeIds.push(strId);
      }
    });
  }

  const resolvedIdToName = { ...idToName };
  for (const strId of nodeSet) {
    const v = resolvedIdToName[strId];
    if (v == null || String(v).trim() === '') {
      resolvedIdToName[strId] = strId;
    }
  }

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

    const MAX_CACHE_SIZE = 500;
    if (randomCache.size >= MAX_CACHE_SIZE) {
      const entries = Array.from(randomCache.entries());
      const toDelete = entries.slice(0, Math.floor(MAX_CACHE_SIZE / 2));
      toDelete.forEach(([key]) => randomCache.delete(key));
    }

    randomCache.set(cacheKey, result);
    return result;
  }

  const validNodeIds = nodeIds.filter(
    (strId) => strId && strId !== '0' && strId !== 'undefined' && strId !== 'null'
  );

  const visibleNodeIds = validNodeIds.filter((nodeId) => isNodeWeightEntryVisible(nodeWeights?.[nodeId]));
  const visibleNodeIdSet = new Set(visibleNodeIds);

  const centerX = 500;
  const centerY = 350;
  const radius = 320;
  visibleNodeIds.forEach((strId) => {
    const angle = seededRandom(strId, 0, 360) * Math.PI / 180;
    const r = radius * (0.7 + 0.3 * (seededRandom(strId, 0, 1000) / 1000));
    const x = centerX + r * Math.cos(angle);
    const y = centerY + r * Math.sin(angle);
    const commonName = resolvedIdToName[strId];
    const { weight: nodeWeight, count: nodeCount } = nodeWeights[strId];

    let imagePath = null;
    if (idToProfileImage?.[strId]?.trim?.()) {
      imagePath = idToProfileImage[strId];
    }

    const nodeData = {
      id: strId,
      label: commonName,
      name: commonName,
      isMainCharacter: idToMain[strId] || false,
      description: idToDesc[strId] || '',
      personalityText: idToDescKo[strId] || '',
      names: [commonName, ...(Array.isArray(idToNames[strId]) ? idToNames[strId] : [])],
      common_name: commonName,
      weight: nodeWeight,
      count: nodeCount,
    };

    if (imagePath && imagePath.trim() !== '') {
      nodeData.image = imagePath;
    }

    nodes.push({
      data: nodeData,
      position: { x, y }
    });
  });

  /** id1->id2 방향만; 역쌍은 관계 동일 시 `a-b`·bidirectional, 다르면 `a->b`·`b->a` 각각 */
  const previousRelationSet = new Set();
  if (previousRelations && Array.isArray(previousRelations)) {
    previousRelations.forEach((prevRel) => {
      const pr = normalizeRelation(prevRel);
      if (!isValidRelation(pr)) return;
      previousRelationSet.add(directedEdgeElementId(pr.id1, pr.id2));
    });
  }

  const edgeMap = new Map();
  const positivityByEdge = new Map();

  relations.forEach((rel) => {
    const r = normalizeRelation(rel);
    if (!isValidRelation(r)) return;
    if (!isRelationVisibleAtEvent(rel, eventData)) return;

    const id1 = String(r.id1);
    const id2 = String(r.id2);

    if (id1 === id2 || id1 === '0' || id2 === '0') {
      return;
    }

    if (!nodeSet.has(id1) || !nodeSet.has(id2)) {
      return;
    }

    if (!visibleNodeIdSet.has(id1) || !visibleNodeIdSet.has(id2)) {
      return;
    }

    const source = id1;
    const target = id2;
    const edgeKey = directedEdgeElementId(id1, id2);

    const pNum = Number(r.positivity);
    if (Number.isFinite(pNum)) {
      let info = positivityByEdge.get(edgeKey);
      if (!info) {
        info = { lastFinite: null, lastFromCurrent: null, hasFromCurrent: false };
      }
      info.lastFinite = r.positivity;
      const curEv = eventUtils.resolveEventNum(eventData) || NaN;
      const relEv = eventUtils.resolveEventNum(rel) || NaN;
      if (Number.isFinite(curEv) && Number.isFinite(relEv) && relEv === curEv) {
        info.lastFromCurrent = r.positivity;
        info.hasFromCurrent = true;
      }
      positivityByEdge.set(edgeKey, info);
    }

    let relationArray = [];
    let relationLabel = "";

    if (eventData && eventData.text) {
      relationLabel = getFirstWordFromEventText(eventData.text);
    }

    if (Array.isArray(rel.relation)) {
      relationArray = rel.relation;
      if (!relationLabel) {
        const directedKey = directedEdgeElementId(id1, id2);
        const isNewRelation = !previousRelationSet.has(directedKey);

        if (isNewRelation || !previousRelations) {
          relationLabel = rel.relation[0] || "";
        } else {
          const prevRel = previousRelations.find((p) => {
            const pr = normalizeRelation(p);
            if (!pr) return false;
            return String(pr.id1) === id1 && String(pr.id2) === id2;
          });

          if (prevRel && Array.isArray(prevRel.relation)) {
            const newElements = rel.relation.filter((element) => !prevRel.relation.includes(element));
            relationLabel = newElements.length > 0 ? newElements[0] : rel.relation[0] || "";
          } else {
            relationLabel = rel.relation[0] || "";
          }
        }
      }
    } else if (typeof rel.relation === "string") {
      relationArray = [rel.relation];
      if (!relationLabel) {
        relationLabel = rel.relation;
      }
    }

    if (edgeMap.has(edgeKey)) {
      const existingEdge = edgeMap.get(edgeKey);
      existingEdge.data.relation = uniqueStrings([...existingEdge.data.relation, ...relationArray]);

      if (relationLabel) {
        existingEdge.data.label = relationLabel;
      }
    } else {
      edgeMap.set(edgeKey, {
        data: {
          id: edgeKey,
          source,
          target,
          relation: relationArray,
          label: relationLabel || "",
        },
      });
    }
  });

  for (const el of edgeMap.values()) {
    const info = positivityByEdge.get(el.data.id);
    if (!info) continue;
    const chosen = info.hasFromCurrent ? info.lastFromCurrent : info.lastFinite;
    if (chosen != null && Number.isFinite(Number(chosen))) {
      el.data.positivity = chosen;
    }
  }

  edges.push(...finalizeDirectedEdges(edgeMap));

  return [
    ...sortElementsByDataId(nodes),
    ...sortElementsByDataId(edges)
  ];
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
    const elementId = normalizeElementId(e);
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

/** Cytoscape 동기화 스킵용: 동일 id의 시각적 data만 문자열화 */
export function visualElementSignature(el) {
  const d = el?.data;
  if (!d) return "";
  if (d.source) {
    const rel = Array.isArray(d.relation) ? d.relation.join("|") : String(d.relation ?? "");
    const topo = d.bidirectional ? "b" : d.reciprocalPair ? "r" : "";
    return `e:${rel}:${d.label ?? ""}:${d.positivity ?? ""}:${d.lineStyle ?? ""}:${d.width ?? ""}:${topo}`;
  }
  return `n:${d.label ?? ""}:${d.weight ?? ""}:${d.count ?? ""}:${d.isMainCharacter ?? ""}:${d.positivity ?? ""}`;
}

/** props elements가 새 배열이어도 그래프 의미가 동일하면 effect·layout 재실행 생략 */
export function buildElementsGraphFingerprint(elements) {
  if (!elements?.length) return "";
  const rows = elements
    .map((el) => {
      const id = el?.data?.id;
      if (id == null || id === "") return null;
      const sid = String(id);
      const d = el?.data;
      if (!d) return null;
      const topo = d.source ? `${d.source}|${d.target}` : "";
      return `${sid}\t${topo}\t${visualElementSignature(el)}`;
    })
    .filter(Boolean);
  rows.sort();
  return `${elements.length}\n${rows.join("\n")}`;
}

/** 노드 id + 간선(id·source·target)만으로 골격 동일 여부 판별(라벨·관계문구 변경 시에도 동일하면 펄스 생략) */
export function buildElementsStructureFingerprint(elements) {
  if (!elements?.length) return "";
  const nodeIds = [];
  const edgeRows = [];
  for (const el of elements) {
    const d = el?.data;
    if (!d || d.id == null || d.id === "") continue;
    const sid = String(d.id);
    if (isGraphEdgeElement(el)) {
      edgeRows.push(`${sid}\t${String(d.source)}\t${String(d.target)}`);
    } else {
      nodeIds.push(sid);
    }
  }
  nodeIds.sort();
  edgeRows.sort();
  return `${nodeIds.join("\x1e")}\n${edgeRows.join("\x1e")}`;
}

/**
 * 3단계 필터링 로직 (RelationGraphWrapper, GraphSplitArea 등에서 공통 사용)
 * @param {Array} elements - 그래프 요소 배열
 * @param {number} filterStage - 필터링 단계 (0: 전체, 1: 핵심인물만, 2: 핵심인물과 연결된 인물)
 * @returns {Array} 필터링된 요소 배열
 */
export function filterMainCharacters(elements, filterStage) {
  if (filterStage === 0 || !elements) return elements;
  
  // 핵심 인물 (isMainCharacter: true) 노드들
  const coreNodes = elements.filter(el =>
    isGraphNodeElement(el) &&
    el.data.isMainCharacter === true
  );
  
  const coreNodeIds = new Set(coreNodes.map(node => node.data.id));
  
  let filteredNodes = [];
  let filteredEdges = [];
  
  if (filterStage === 1) {
    // 1단계: 핵심인물끼리의 연결만
    filteredNodes = coreNodes;
    filteredEdges = elements.filter(el => 
      isGraphEdgeElement(el) &&
      coreNodeIds.has(el.data.source) && 
      coreNodeIds.has(el.data.target)
    );
  } else if (filterStage === 2) {
    // 2단계: 핵심인물과 핵심인물에 연결된 노드(핵심인물, 비핵심인물) + 간선
    // 핵심 인물과 연결된 간선들 찾기
    const connectedEdges = elements.filter(el => 
      isGraphEdgeElement(el) &&
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
      isGraphNodeElement(el) &&
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
 * @returns {boolean} 겹침이 있었는지 여부
 */
export function detectAndResolveOverlap(cy, nodeSize = 40) {
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
        
        setTimeout(() => {
          if (node1 && node1.removeClass) node1.removeClass('bounce-effect');
          if (node2 && node2.removeClass) node2.removeClass('bounce-effect');
        }, 300);
      }
    }
  }
  
  return hasOverlap;
}
