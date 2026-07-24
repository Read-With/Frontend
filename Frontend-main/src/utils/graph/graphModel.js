/** graphModel: 캐릭터·relations → elements 변환, diff, 필터 */

import { sanitizeAssetUrl, resolveApiArtifactUrl } from '../common/urlUtils';
import {
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
  sortElementsByDataId,
  undirectedPairKey,
  uniqueStrings,
  normalizeRelation,
  relationEventMetaPassthrough,
  pickCharacterDisplayName,
  lookupRememberedCharacterDisplayName,
  buildManifestCharacterNameLookup,
  rememberCharacterDisplayName,
  isUsableCharacterDisplayName,
  enrichGraphCharacters,
  extractCharacterId,
} from './graphCore';
import { eventUtils, cacheKeyUtils } from '../viewer/viewerCore';
import { toPositiveInt } from '../common/valueUtils';

import {
  sortDeltasForAccumulate,
  createDeltaAccumulateWalker,
} from '../api/graphApi';
import { getBookManifest } from '../api/booksApi';
import {
  getChapterData,
  getManifestFromCache,
  calculateMaxChapterFromChapters,
  getLastManifestEventInChapter,
  listBookManifestEventIds,
} from '../common/cache/manifestCache';
import {
  registerCache,
  getCacheItem,
  setCacheItem,
  loadTtlStorage,
  saveTtlStorage,
  hydrateCacheFromStorage,
  GRAPH_BOOK_CACHE_PREFIX,
  CHAPTER_EVENT_CACHE_MAX_AGE_MS,
  CHAPTER_GRAPH_CACHE_SOURCE,
} from '../common/cache/cacheManager';
import {
  deepClone,
  resolveChapterIndex,
  toNumberOrNull,
  toPositiveNumberOrNull,
  toTrimmedStringOrNull,
} from '../common/valueUtils';


const createEmptyCharacterMaps = () => ({
  idToName: {},
  idToDesc: {},
  idToDescKo: {},
  idToMain: {},
  idToNames: {},
  idToProfileImage: {},
});

const resolveCharacterArray = (characters) => {
  if (!characters) return [];
  const list = characters?.characters ?? characters;
  return Array.isArray(list) ? list : [];
};

/** 캐릭터 배열 → id 기반 lookup 맵 */
export function createCharacterMaps(characters) {
  try {
    const maps = createEmptyCharacterMaps();
    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } = maps;

    const characterArray = resolveCharacterArray(characters);
    if (!characterArray.length) {
      return maps;
    }

    let missingProfileImage = 0;
    characterArray.forEach((char) => {
      if (!char) return;
      const id = extractCharacterId(char);
      if (!id) return;

      const displayName = pickCharacterDisplayName(char);
      idToName[id] = displayName;
      idToDesc[id] = char.description || char.profileText || '';
      idToDescKo[id] = char.personalityText || '';
      idToMain[id] = !!char.isMainCharacter;
      idToNames[id] = char.names || [];

      if (char.profileImage) {
        const validatedUrl = validateAndNormalizeProfileImageUrl(char.profileImage);
        if (validatedUrl) {
          idToProfileImage[id] = validatedUrl;
        } else {
          console.warn(`[이미지 검증 실패] 캐릭터 ID: ${id}, 원본 profileImage:`, char.profileImage);
        }
      } else {
        missingProfileImage += 1;
      }
    });

    if (import.meta.env.DEV && missingProfileImage > 0) {
      console.debug(`[이미지 없음] 캐릭터 ${missingProfileImage}명 (프로필 이미지 미설정)`);
    }

    return maps;
  } catch (error) {
    console.error('createCharacterMaps 실패:', error);
    return createEmptyCharacterMaps();
  }
}

function validateAndNormalizeProfileImageUrl(profileImage) {
  if (!profileImage || typeof profileImage !== 'string') {
    return null;
  }

  const trimmed = sanitizeAssetUrl(profileImage.trim());
  if (trimmed === '') {
    return null;
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      new URL(trimmed);
      return trimmed;
    } catch {
      console.warn(`[이미지 검증] 유효하지 않은 절대 URL: ${trimmed}`);
      return null;
    }
  }

  if (trimmed.startsWith('//')) {
    try {
      const resolved = new URL(trimmed, 'https://placeholder.local');
      return resolved.origin + resolved.pathname + resolved.search + resolved.hash;
    } catch {
      console.warn(`[이미지 검증] 유효하지 않은 프로토콜 상대 URL: ${trimmed}`);
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    return resolveApiArtifactUrl(trimmed) || trimmed;
  }

  console.warn(`[이미지 검증] 유효하지 않은 이미지 URL 형식: ${trimmed}`);
  return null;
}

export function isValidNodeWeight(weight) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0;
}

function isValidNodeCount(count) {
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

export function isNodeWeightEntryVisible(entry) {
  return Boolean(entry && isValidNodeWeight(entry.weight) && isValidNodeCount(entry.count));
}

function resolveNodeWeightAndCount(char, previousEntry = null) {
  const rawWeight = typeof char?.weight === 'number' ? char.weight : null;
  const hasCountField = typeof char?.count === 'number';
  const rawCount = hasCountField ? char.count : null;

  const weight = isValidNodeWeight(rawWeight)
    ? rawWeight
    : (previousEntry && isValidNodeWeight(previousEntry.weight) ? previousEntry.weight : null);

  let count = null;
  if (hasCountField) {
    count = isValidNodeCount(rawCount) ? rawCount : null;
  } else if (previousEntry && isValidNodeCount(previousEntry.count)) {
    count = previousEntry.count;
  }

  return { weight, count };
}

function cloneNodeWeightsMap(nodeWeights) {
  if (!nodeWeights || typeof nodeWeights !== 'object') return {};
  return Object.fromEntries(
    Object.entries(nodeWeights)
      .filter(([, entry]) => isNodeWeightEntryVisible(entry))
      .map(([id, entry]) => [id, { weight: entry.weight, count: entry.count }])
  );
}

/** 캐릭터 병합 시 weight·count는 직전 값 유지 */
function mergeCharacterRecord(prev, char) {
  const filled = Object.fromEntries(
    Object.entries(char).filter(([, v]) => v !== undefined && v !== null && v !== '')
  );
  const merged = { ...prev, ...filled };
  const { weight, count } = resolveNodeWeightAndCount(merged, prev);

  if (isValidNodeWeight(weight)) {
    merged.weight = weight;
  } else {
    delete merged.weight;
  }

  if (isValidNodeCount(count)) {
    merged.count = count;
  } else if (typeof merged.count !== 'number') {
    delete merged.count;
  }

  return merged;
}

/** Cytoscape elements → nodeWeights 맵 */
export function extractNodeWeightsFromElements(elements) {
  const nodeWeights = {};
  if (!Array.isArray(elements)) return nodeWeights;

  elements.forEach((el) => {
    if (!isGraphNodeElement(el)) return;
    const data = el.data;
    const id = extractCharacterId({ id: data.id });
    if (!id) return;
    const entry = { weight: data.weight, count: data.count };
    if (isNodeWeightEntryVisible(entry)) {
      nodeWeights[id] = entry;
    }
  });

  return nodeWeights;
}

/** 이벤트별 캐릭터 ID 병합 (빈 필드는 이전 값 유지) */
export function aggregateCharactersFromEvents(eventList) {
  const charactersMap = new Map();

  if (!Array.isArray(eventList)) return charactersMap;

  eventList.forEach((entry) => {
    if (!entry) return;

    const characters = Array.isArray(entry.characters) ? entry.characters : [];
    characters.forEach((char) => {
      if (!char) return;
      const id = extractCharacterId(char);
      if (!id) return;

      const prev = charactersMap.get(id);
      if (!prev) {
        charactersMap.set(id, { ...char });
        return;
      }
      charactersMap.set(id, mergeCharacterRecord(prev, char));
    });
  });

  return charactersMap;
}

/** weight·count → nodeWeights 맵 (직전 weight·count 상속, 없으면 노드 비표시) */
export function buildNodeWeights(characters, previousNodeWeights = null) {
  const nodeWeights = cloneNodeWeightsMap(previousNodeWeights);

  if (!Array.isArray(characters)) return nodeWeights;

  characters.forEach((char) => {
    if (!char) return;
    const id = extractCharacterId(char);
    if (!id) return;

    const previousEntry = nodeWeights[id] ?? null;
    const { weight, count } = resolveNodeWeightAndCount(char, previousEntry);

    if (isValidNodeWeight(weight) && isValidNodeCount(count)) {
      nodeWeights[id] = { weight, count };
    } else {
      delete nodeWeights[id];
    }
  });

  return nodeWeights;
}

/** 빈 nodeWeights 맵은 null로 통일 (convertRelationsToElements 인자용) */
export function toNodeWeightsOrNull(nodeWeights) {
  if (!nodeWeights || typeof nodeWeights !== 'object') return null;
  return Object.keys(nodeWeights).length > 0 ? nodeWeights : null;
}

const directedEdgeElementId = (fromId, toId) => `${String(fromId)}->${String(toId)}`;

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

/** graphModel: 캐릭터·relations → elements 변환, diff, 필터
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

function cloneEdgeData(el, extra = {}) {
  const data = { ...el.data, ...extra };
  delete data.bidirectional;
  return { data };
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
      out.push(cloneEdgeData(group[0]));
      continue;
    }
    if (group.length !== 2) {
      group.forEach((el) => out.push(cloneEdgeData(el)));
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
        group.forEach((el) => out.push(cloneEdgeData(el, { reciprocalPair: true })));
      }
    } else {
      group.forEach((el) => out.push(cloneEdgeData(el)));
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
  if (!text || typeof text !== 'string') return '';
  const firstWord = text.trim().split(/\s+/)[0]?.replace(/[^a-zA-Z0-9가-힣-]/g, '') ?? '';
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
 * @param {Object|null} [params.eventData]
 * @param {Object|null} [params.idToProfileImage]
 * @param {Array|null} [params.charactersOrphanMerge]
 * @param {string|number|null} [params.bookId]
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
  eventData = null,
  idToProfileImage = null,
  charactersOrphanMerge = null,
  bookId = null,
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
    if (!r) return;
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
      const strId = extractCharacterId(char);
      if (!strId || strId === '0') return;
      if (!nodeSet.has(strId)) {
        nodeSet.add(strId);
        nodeIds.push(strId);
      }
    });
  }

  const manifestLookup = bookId != null ? buildManifestCharacterNameLookup(bookId) : null;
  const resolvedIdToName = { ...idToName };
  for (const strId of nodeSet) {
    const v = resolvedIdToName[strId];
    if (isUsableCharacterDisplayName(v, strId)) {
      rememberCharacterDisplayName(bookId, strId, v);
      continue;
    }
    const resolved =
      manifestLookup?.get(strId) ||
      lookupRememberedCharacterDisplayName(bookId, strId) ||
      '';
    if (resolved) {
      resolvedIdToName[strId] = resolved;
      rememberCharacterDisplayName(bookId, strId, resolved);
    } else {
      resolvedIdToName[strId] = `인물 ${strId}`;
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
  const edgeMap = new Map();
  const positivityByEdge = new Map();

  relations.forEach((rel) => {
    const r = normalizeRelation(rel);
    if (!r) return;
    if (!isRelationVisibleAtEvent(rel, eventData)) return;

    const id1 = String(r.id1);
    const id2 = String(r.id2);

    if (!nodeSet.has(id1) || !nodeSet.has(id2)) return;
    if (!visibleNodeIdSet.has(id1) || !visibleNodeIdSet.has(id2)) return;

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

    let relationLabel = '';
    if (eventData?.text) {
      relationLabel = getFirstWordFromEventText(eventData.text);
    }
    if (!relationLabel) {
      relationLabel = r.label || r.relation[0] || '';
    }

    if (edgeMap.has(edgeKey)) {
      const existingEdge = edgeMap.get(edgeKey);
      existingEdge.data.relation = uniqueStrings([...existingEdge.data.relation, ...r.relation]);
      if (relationLabel) {
        existingEdge.data.label = relationLabel;
      }
    } else {
      edgeMap.set(edgeKey, {
        data: {
          id: edgeKey,
          source: id1,
          target: id2,
          relation: [...r.relation],
          label: relationLabel,
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
  const added = validCurrElements.filter((e) => !prevMap.has(normalizeElementId(e)));
  // 삭제: 이전엔 있지만 현재엔 없는 id
  const removed = validPrevElements.filter((e) => !currMap.has(normalizeElementId(e)));
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
 * seed 노드에 연결된 edge(+endpoint 노드) 서브그래프.
 * @param {'any'|'both'} [options.seedEdgeMode='any'] any=한쪽만 seed, both=양끝 모두 seed
 * @param {boolean} [options.includeIsolatedSeeds=true] seed에 간선이 없어도 노드 포함
 */
export function expandConnectedSubgraph(
  elements,
  seedNodeIds,
  { seedEdgeMode = 'any', includeIsolatedSeeds = true } = {}
) {
  if (!Array.isArray(elements) || !seedNodeIds?.size) return [];

  const seeds = seedNodeIds instanceof Set ? seedNodeIds : new Set(seedNodeIds);
  const connectedEdges = elements.filter((el) => {
    if (!isGraphEdgeElement(el)) return false;
    const sIn = seeds.has(el.data.source);
    const tIn = seeds.has(el.data.target);
    return seedEdgeMode === 'both' ? sIn && tIn : sIn || tIn;
  });

  const nodeIds = includeIsolatedSeeds ? new Set(seeds) : new Set();
  connectedEdges.forEach((edge) => {
    if (edge.data.source != null) nodeIds.add(edge.data.source);
    if (edge.data.target != null) nodeIds.add(edge.data.target);
  });

  const nodes = elements.filter((el) => isGraphNodeElement(el) && nodeIds.has(el.data.id));
  return [...nodes, ...connectedEdges];
}

/**
 * 3단계 필터링 로직 (RelationGraphWrapper, GraphSplitArea 등에서 공통 사용)
 * @param {Array} elements - 그래프 요소 배열
 * @param {number} filterStage - 필터링 단계 (0: 전체, 1: 핵심인물만, 2: 핵심인물과 연결된 인물)
 * @returns {Array} 필터링된 요소 배열
 */
export function filterMainCharacters(elements, filterStage) {
  if (filterStage === 0 || !elements) return elements;

  const coreNodes = elements.filter(
    (el) => isGraphNodeElement(el) && el.data.isMainCharacter === true
  );
  const coreNodeIds = new Set(coreNodes.map((node) => node.data.id));

  if (filterStage === 1) {
    return expandConnectedSubgraph(elements, coreNodeIds, {
      seedEdgeMode: 'both',
      includeIsolatedSeeds: true,
    });
  }
  if (filterStage === 2) {
    return expandConnectedSubgraph(elements, coreNodeIds, {
      seedEdgeMode: 'any',
      includeIsolatedSeeds: false,
    });
  }
  return elements;
}

/**
 * 노드 겹침 감지 및 자동 조정
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {number} nodeSize - 노드 크기
 * @param {Object} [options]
 * @param {Iterable<string>|null} [options.movableIds] - 지정 시 해당 노드만 이동(기존 노드 위치 유지)
 * @param {number} [options.maxIterations] - 밀어내기 반복 횟수
 * @returns {boolean} 겹침이 있었는지 여부
 */
export function detectAndResolveOverlap(cy, nodeSize = 40, options = {}) {
  if (!cy) {
    return false;
  }
  
  if (typeof nodeSize !== 'number' || nodeSize <= 0) {
    nodeSize = 40;
  }

  const movableIdSet = options.movableIds
    ? new Set([...options.movableIds].map(String).filter((id) => id !== ''))
    : null;
  if (movableIdSet && movableIdSet.size === 0) {
    return false;
  }

  const nodes = cy.nodes();
  const NODE_SIZE = nodeSize;
  const MIN_DISTANCE = NODE_SIZE * 1.0;
  const maxIterations =
    typeof options.maxIterations === 'number' && options.maxIterations > 0
      ? options.maxIterations
      : movableIdSet
        ? 8
        : 1;
  let hasOverlap = false;
  
  // 성능 최적화: 노드가 많을 때는 겹침 감지를 건너뜀
  const MAX_NODES_FOR_OVERLAP_DETECTION = 100;
  if (nodes.length > MAX_NODES_FOR_OVERLAP_DETECTION) {
    return false;
  }

  // 위치 캐싱으로 성능 개선
  const nodePositions = nodes.map(node => ({
    node,
    id: String(node.id()),
    pos: node.position()
  }));

  for (let iter = 0; iter < maxIterations; iter++) {
    let movedThisPass = false;

    for (let i = 0; i < nodePositions.length; i++) {
      for (let j = i + 1; j < nodePositions.length; j++) {
        const { node: node1, id: id1, pos: pos1 } = nodePositions[i];
        const { node: node2, id: id2, pos: pos2 } = nodePositions[j];

        const node1Movable = !movableIdSet || movableIdSet.has(id1);
        const node2Movable = !movableIdSet || movableIdSet.has(id2);
        if (!node1Movable && !node2Movable) continue;

        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared >= MIN_DISTANCE * MIN_DISTANCE) continue;

        hasOverlap = true;
        movedThisPass = true;
        const distance = Math.sqrt(distanceSquared);
        const angle =
          distance < 1e-6
            ? (i + j) * 0.7
            : Math.atan2(dy, dx);
        const pushDistance = MIN_DISTANCE - distance + 20;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);

        if (node1Movable && node2Movable) {
          const half = pushDistance * 0.5;
          const newPos1 = { x: pos1.x + cos * half, y: pos1.y + sin * half };
          const newPos2 = { x: pos2.x - cos * half, y: pos2.y - sin * half };
          node1.position(newPos1);
          node2.position(newPos2);
          nodePositions[i].pos = newPos1;
          nodePositions[j].pos = newPos2;
        } else if (node1Movable) {
          // 신규 노드만: 기존 노드에서 멀어지는 방향으로 전부 이동
          const newPos1 = {
            x: pos2.x + cos * (MIN_DISTANCE + 20),
            y: pos2.y + sin * (MIN_DISTANCE + 20),
          };
          node1.position(newPos1);
          nodePositions[i].pos = newPos1;
        } else {
          const newPos2 = {
            x: pos1.x - cos * (MIN_DISTANCE + 20),
            y: pos1.y - sin * (MIN_DISTANCE + 20),
          };
          node2.position(newPos2);
          nodePositions[j].pos = newPos2;
        }
      }
    }

    if (!movedThisPass) break;
  }
  
  return hasOverlap;
}

/* ─── chapter event / relationship deltas cache (from chapterEventCache) ─── */

const cloneArray = (arr) => (Array.isArray(arr) ? arr.map(deepClone) : []);

/** manifest / structure 이벤트에서 eventId 추출 */
const resolveManifestEventId = (ev) =>
  toTrimmedStringOrNull(eventUtils.resolveEventId(ev) ?? ev?.eventId ?? ev?.id);

const safeCompare = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
};

const computeCharacterDiff = (prevCharacters, nextCharacters) => {
  const prevMap = new Map();
  const nextMap = new Map();
  (Array.isArray(prevCharacters) ? prevCharacters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) prevMap.set(id, character);
  });
  (Array.isArray(nextCharacters) ? nextCharacters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) nextMap.set(id, character);
  });
  const added = [];
  const updated = [];
  const removedIds = [];
  nextMap.forEach((character, id) => {
    const prev = prevMap.get(id);
    if (!prev) added.push(deepClone(character));
    else if (!safeCompare(prev, character)) updated.push(deepClone(character));
  });
  prevMap.forEach((_character, id) => {
    if (!nextMap.has(id)) removedIds.push(id);
  });
  return { added, updated, removedIds };
};

const applyCharacterDiff = (prevCharacters, diff) => {
  const map = new Map();
  (Array.isArray(prevCharacters) ? prevCharacters : []).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) map.set(id, deepClone(character));
  });
  (diff?.removedIds || []).forEach((id) => id && map.delete(String(id)));
  (diff?.updated || []).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) map.set(id, deepClone(character));
  });
  (diff?.added || []).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) map.set(id, deepClone(character));
  });
  return Array.from(map.values());
};

const applyElementDiff = (prevElements, diff) => {
  const map = new Map();
  (Array.isArray(prevElements) ? prevElements : []).forEach((element) => {
    const id = normalizeElementId(element);
    if (id) map.set(id, deepClone(element));
  });
  (diff?.removedIds || []).forEach((id) => id && map.delete(String(id)));
  (diff?.updated || []).forEach((element) => {
    const id = normalizeElementId(element);
    if (id) map.set(id, deepClone(element));
  });
  (diff?.added || []).forEach((element) => {
    const id = normalizeElementId(element);
    if (id) map.set(id, deepClone(element));
  });
  const result = Array.from(map.values());
  result.sort((a, b) => {
    const aIsEdge = Boolean(a?.data?.source);
    const bIsEdge = Boolean(b?.data?.source);
    if (aIsEdge !== bIsEdge) return aIsEdge ? 1 : -1;
    return (normalizeElementId(a) || '').localeCompare(normalizeElementId(b) || '');
  });
  return result;
};

const buildChapterCachePayload = (
  bookId,
  chapterIdx,
  events,
  source = CHAPTER_GRAPH_CACHE_SOURCE.RUNTIME
) => {
  const timestamp = Date.now();
  const sortedEvents = eventUtils.sortEventsByIdx(events);
  if (!sortedEvents.length) {
    return {
      bookId,
      chapterIdx,
      maxEventIdx: 0,
      events: [],
      baseSnapshot: null,
      diffs: [],
      eventSummaries: [],
      timestamp,
      source,
    };
  }

  const diffs = [];
  const eventSummaries = [];
  let baseSnapshot = null;
  let prevElements = [];
  let prevCharacters = [];

  sortedEvents.forEach((event, index) => {
    // API는 이벤트별 누적 스냅샷을 주므로 이어 붙이지 않고 해당 시점 값을 그대로 사용
    const relations = Array.isArray(event?.relations) ? event.relations : [];
    const snapshotCharacters = enrichGraphCharacters(
      Array.isArray(event?.characters) ? event.characters : [],
      { bookId }
    );
    const nodeWeights = buildNodeWeights(snapshotCharacters);
    const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } =
      createCharacterMaps(snapshotCharacters);

    let convertedElements = [];
    try {
      convertedElements = convertRelationsToElements({
        relations,
        idToName,
        idToDesc,
        idToDescKo,
        idToMain,
        idToNames,
        nodeWeights: toNodeWeightsOrNull(nodeWeights),
        eventData: event?.event ?? null,
        idToProfileImage,
        charactersOrphanMerge: snapshotCharacters.length > 0 ? snapshotCharacters : null,
        bookId,
      });
    } catch (error) {
      console.error('convertRelationsToElements 실패:', error);
    }

    const currentElements = cloneArray(convertedElements);
    const currentCharacters = cloneArray(snapshotCharacters);
    if (index === 0) {
      baseSnapshot = {
        eventIdx: eventUtils.resolveEventNum(event) || 1,
        elements: currentElements,
        characters: currentCharacters,
        eventMeta: event?.event ? deepClone(event.event) : null,
      };
    } else {
      const elementDiffRaw = calcGraphDiff(prevElements, convertedElements);
      diffs.push({
        eventIdx: eventUtils.resolveEventNum(event) || (baseSnapshot?.eventIdx ?? 1),
        eventMeta: event?.event ? deepClone(event.event) : null,
        elementDiff: {
          added: cloneArray(elementDiffRaw?.added || []),
          updated: cloneArray(elementDiffRaw?.updated || []),
          removedIds: (elementDiffRaw?.removed || []).map((element) => normalizeElementId(element)).filter(Boolean),
        },
        characterDiff: computeCharacterDiff(prevCharacters, snapshotCharacters),
      });
    }
    prevElements = currentElements;
    prevCharacters = currentCharacters;

    const summaryEventNum = Number(event.eventNum);
    const summaryIdx = Number(event.eventIdx) || 0;
    eventSummaries.push({
      bookId,
      chapterIdx,
      eventIdx: summaryIdx,
      eventNum: Number.isFinite(summaryEventNum) && summaryEventNum > 0 ? summaryEventNum : summaryIdx,
      eventId: eventUtils.resolveEventId(event) ?? eventUtils.resolveEventId(event?.event) ?? null,
      startTxtOffset: event?.startTxtOffset ?? null,
      endTxtOffset: event?.endTxtOffset ?? null,
      title: event?.event?.name ?? event?.event?.title ?? event?.event?.eventName ?? null,
      text: event?.event?.text ?? null,
      hasCharacters: snapshotCharacters.length > 0,
      hasRelations: relations.length > 0,
    });
  });

  const maxEventIdx = sortedEvents.reduce(
    (max, event) => Math.max(max, eventUtils.resolveEventNum(event) || 0),
    0
  );

  return {
    bookId,
    chapterIdx,
    maxEventIdx,
    events: eventSummaries.map((summary) => deepClone(summary)),
    baseSnapshot,
    diffs,
    eventSummaries,
    timestamp,
    source,
    rawEvents: sortedEvents.map((event) => deepClone(event)),
  };
};

export const reconstructChapterGraphState = (cachePayload, targetEventIdx) => {
  if (!cachePayload || typeof cachePayload !== 'object') return null;
  const baseSnapshot = cachePayload.baseSnapshot;
  if (!baseSnapshot || !Array.isArray(baseSnapshot.elements)) return null;

  const baseIdx = Number(baseSnapshot.eventIdx) || 1;
  const normalizedTarget = Number(targetEventIdx);
  let currentElements = cloneArray(baseSnapshot.elements);
  let currentCharacters = cloneArray(baseSnapshot.characters || []);
  let currentEventMeta = baseSnapshot.eventMeta ? deepClone(baseSnapshot.eventMeta) : null;
  let appliedEventIdx = baseIdx;

  if (!Number.isFinite(normalizedTarget) || normalizedTarget <= baseIdx) {
    return {
      elements: currentElements,
      characters: currentCharacters,
      eventMeta: currentEventMeta,
      eventIdx: appliedEventIdx,
    };
  }

  eventUtils.sortEventsByIdx(cachePayload.diffs || []).forEach((diff) => {
    const diffIdx = Number(diff?.eventIdx);
    if (!Number.isFinite(diffIdx) || diffIdx > normalizedTarget) return;
    currentElements = applyElementDiff(currentElements, diff?.elementDiff);
    currentCharacters = applyCharacterDiff(currentCharacters, diff?.characterDiff);
    currentEventMeta = diff?.eventMeta ? deepClone(diff.eventMeta) : currentEventMeta;
    appliedEventIdx = diffIdx;
  });

  return {
    elements: currentElements,
    characters: currentCharacters,
    eventMeta: currentEventMeta,
    eventIdx: appliedEventIdx,
  };
};

const graphBookMemoryCache = new Map();
registerCache('graphBookCache', graphBookMemoryCache, {
  maxSize: 50,
  ttl: null,
  cleanupInterval: 3600000,
});

const graphBuildPromises = new Map();
const chapterDiscoverPromises = new Map();

const getChapterDiscoverKey = (bookId, chapterIdx) => `${bookId}-${chapterIdx}`;

const getGraphBookCacheKey = (bookId) => {
  const numeric = toPositiveNumberOrNull(bookId);
  if (numeric === null) return null;
  return `${GRAPH_BOOK_CACHE_PREFIX}${numeric}`;
};

const readGraphBookCache = (bookId) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const cached = getCacheItem('graphBookCache', key);
  if (cached) return cached;

  try {
    return hydrateCacheFromStorage('graphBookCache', key, 'localStorage');
  } catch (error) {
    console.warn('그래프 책 캐시 로드 실패:', error);
    return null;
  }
};

const writeGraphBookCache = (bookId, payload) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const normalized = {
    ...payload,
    bookId: Number(bookId),
    builtAt: payload?.builtAt ?? Date.now(),
    timestamp: Date.now(),
  };

  setCacheItem('graphBookCache', key, normalized);
  saveTtlStorage(key, normalized, 'localStorage');

  return normalized;
};

export const ensureGraphBookCache = async (bookId, { signal } = {}) => {
  const numericId = toPositiveNumberOrNull(bookId);
  if (numericId === null) return null;

  const existing = readGraphBookCache(numericId);
  if (existing) return existing;

  if (graphBuildPromises.has(numericId)) {
    return graphBuildPromises.get(numericId);
  }

  const buildPromise = (async () => {
    await getBookManifest(numericId, { forceRefresh: false });
    const manifest = getManifestFromCache(numericId);

    const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];

    const normalizedChapterIndices = chapters
      .map((chapter) => {
        const v = toNumberOrNull(chapter?.idx);
        return v != null && v > 0 ? v : null;
      })
      .filter((idx, idxIndex, self) => idx != null && self.indexOf(idx) === idxIndex)
      .sort((a, b) => a - b);

    const chapterSummaries = [];

    for (const chapterIdx of normalizedChapterIndices) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let chapterCache = getCachedChapterEvents(numericId, chapterIdx);
      if (!chapterCache) {
        chapterCache = await discoverChapterEvents(numericId, chapterIdx, false);
      }

      if (chapterCache) {
        chapterSummaries.push({
          chapterIdx,
          maxEventIdx: Number(chapterCache.maxEventIdx) || 0,
          totalEvents: Array.isArray(chapterCache.events) ? chapterCache.events.length : 0,
          source: chapterCache.source ?? 'cache',
        });
      }
    }

    return writeGraphBookCache(numericId, {
      bookId: numericId,
      chapters: chapterSummaries,
      maxChapter: calculateMaxChapterFromChapters(chapters),
      builtAt: Date.now(),
    });
  })();

  graphBuildPromises.set(numericId, buildPromise);

  try {
    return await buildPromise;
  } finally {
    graphBuildPromises.delete(numericId);
  }
};

/** eventIdx 시점 누적 그래프 상태 복원 */
export const getGraphEventState = (bookId, chapterIdx, eventIdx) => {
  const chapterPayload = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterPayload) return null;
  return reconstructChapterGraphState(chapterPayload, eventIdx);
};

/** deltas 누적 graph 결과 한 건 → 챕터 캐시 이벤트 행 */
const normalizeEventFromDeltasGraphResult = (
  bookId,
  chapterIdx,
  eventIdx,
  result,
  manifestStructure
) => {
  const safe = result && typeof result === 'object' ? result : {};
  const { characters, relations, event: nestedEvent } = safe;
  const hasCharacters = Array.isArray(characters) && characters.length > 0;
  const hasRelations = Array.isArray(relations) && relations.length > 0;
  const hasManifestMeta = Boolean(manifestStructure);
  const hasNestedEventMeta =
    nestedEvent &&
    typeof nestedEvent === 'object' &&
    (eventUtils.resolveEventId(nestedEvent) !== null ||
      nestedEvent.name ||
      nestedEvent.title ||
      nestedEvent.startTxtOffset !== undefined ||
      nestedEvent.endTxtOffset !== undefined ||
      nestedEvent.startLocator !== undefined ||
      nestedEvent.endLocator !== undefined);

  if (!hasCharacters && !hasRelations && !hasNestedEventMeta && !hasManifestMeta) {
    return { skip: true };
  }

  const resolvedChapterIdx = resolveChapterIndex(safe) ?? chapterIdx;
  const ord = nestedEvent ? eventUtils.resolveEventOrdinal(nestedEvent) : null;
  const resolvedEventNum =
    Number.isFinite(ord) && ord > 0
      ? ord
      : Number(manifestStructure?.eventNum ?? manifestStructure?.eventIdx ?? eventIdx);
  const resolvedEventId =
    safe.eventId ??
    eventUtils.resolveEventId(nestedEvent) ??
    manifestStructure?.eventId ??
    null;

  return {
    skip: false,
    event: {
      bookId: Number(safe.bookId) || bookId,
      chapterIdx: resolvedChapterIdx,
      eventIdx,
      eventNum: resolvedEventNum,
      characters: hasCharacters ? characters.map((character) => deepClone(character)) : [],
      relations: hasRelations ? relations.map((relation) => deepClone(relation)) : [],
      event: {
        idx: eventIdx,
        chapterIdx: resolvedChapterIdx,
        chapterIndex: resolvedChapterIdx,
        eventId: resolvedEventId ?? eventIdx,
        startTxtOffset: nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null,
        endTxtOffset: nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null,
        startLocator: nestedEvent?.startLocator,
        endLocator: nestedEvent?.endLocator,
        rawText: nestedEvent?.rawText ?? null,
        ...(nestedEvent && typeof nestedEvent === 'object' ? nestedEvent : {}),
        eventNum: resolvedEventNum,
      },
      startTxtOffset: nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null,
      endTxtOffset: nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null,
      eventId: resolvedEventId,
    },
  };
};

const getChapterEventCacheKey = (bookId, chapterIdx) => {
  const bookIdNum = toPositiveNumberOrNull(bookId);
  const chapterIdxNum = toPositiveNumberOrNull(chapterIdx);
  if (bookIdNum === null || chapterIdxNum === null) return null;
  return cacheKeyUtils.createChapterKey(bookIdNum, chapterIdxNum);
};

export const getCachedChapterEvents = (bookId, chapterIdx) => {
  try {
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return null;
    return loadTtlStorage(cacheKey, CHAPTER_EVENT_CACHE_MAX_AGE_MS, 'localStorage');
  } catch (error) {
    console.error('챕터 이벤트 캐시 로드 실패:', error);
    return null;
  }
};

const setCachedChapterEvents = (bookId, chapterIdx, eventData) => {
  try {
    if (!eventData) return false;
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return false;

    const cacheData = {
      bookId,
      chapterIdx,
      maxEventIdx: Number(eventData.maxEventIdx) || 0,
      events: Array.isArray(eventData.events) ? eventData.events : [],
      baseSnapshot: eventData.baseSnapshot ? deepClone(eventData.baseSnapshot) : null,
      diffs: Array.isArray(eventData.diffs) ? deepClone(eventData.diffs) : [],
      eventSummaries: Array.isArray(eventData.eventSummaries)
        ? deepClone(eventData.eventSummaries)
        : [],
      rawEvents: Array.isArray(eventData.rawEvents) ? deepClone(eventData.rawEvents) : [],
      timestamp: Number(eventData.timestamp) || Date.now(),
      source: eventData.source || null,
    };

    saveTtlStorage(cacheKey, cacheData, 'localStorage');
    return true;
  } catch (error) {
    console.error('챕터 이벤트 캐시 저장 실패:', error);
    return false;
  }
};

const discoverChapterEvents = async (
  bookId,
  chapterIdx,
  forceRefresh = false,
  options = {}
) => {
  const { maxEventIdx = null, onPartialCache = null } = options;
  const cappedMaxEventIdx =
    Number.isFinite(Number(maxEventIdx)) && Number(maxEventIdx) > 0 ? Number(maxEventIdx) : null;

  if (!bookId || !chapterIdx || chapterIdx < 1) {
    return {
      bookId,
      chapterIdx,
      maxEventIdx: 0,
      events: [],
      baseSnapshot: null,
      diffs: [],
      eventSummaries: [],
      timestamp: Date.now(),
      source: CHAPTER_GRAPH_CACHE_SOURCE.INVALID,
    };
  }

  if (!forceRefresh) {
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (cached && cached.source !== 'manifest-only') {
      const cachedMax = Number(cached.maxEventIdx) || 0;
      if (!cappedMaxEventIdx || cachedMax >= cappedMaxEventIdx) {
        return cached;
      }
    }
  }

  const discoverKey = getChapterDiscoverKey(bookId, chapterIdx);
  if (!forceRefresh && chapterDiscoverPromises.has(discoverKey)) {
    await chapterDiscoverPromises.get(discoverKey);
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    const cachedMax = Number(cached?.maxEventIdx) || 0;
    if (cached && cached.source !== 'manifest-only') {
      if (!cappedMaxEventIdx || cachedMax >= cappedMaxEventIdx) {
        return cached;
      }
    }
  }

  const discoverPromise = (async () => {
    const existingCache = !forceRefresh ? getCachedChapterEvents(bookId, chapterIdx) : null;
    const apiEvents = Array.isArray(existingCache?.rawEvents)
      ? existingCache.rawEvents.map((event) => deepClone(event))
      : [];
    const fetchedEventIdxSet = new Set(
      apiEvents.map((event) => eventUtils.resolveEventNum(event) || 0).filter((idx) => idx > 0)
    );

    let manifestEventStructures = [];
    try {
      const manifestChapter = getChapterData(bookId, chapterIdx);
      if (manifestChapter?.events?.length) {
        manifestEventStructures = manifestChapter.events
          .map((rawEvent, index) => {
            const eventIdx = eventUtils.resolveEventNum(rawEvent) || Number(index + 1);
            const fromApi = Number(rawEvent.eventNum);
            const eventNum = Number.isFinite(fromApi) && fromApi > 0 ? fromApi : eventIdx;
            return {
              eventIdx,
              eventNum,
              eventId: eventUtils.resolveEventId(rawEvent),
              startTxtOffset: rawEvent.startTxtOffset ?? null,
              endTxtOffset: rawEvent.endTxtOffset ?? null,
            };
          })
          .filter((e) => e.eventIdx > 0);
      }
    } catch (error) {
      console.warn('manifest 이벤트 구조 로드 실패:', error);
    }

    const publishPartialCache = () => {
      if (!apiEvents.length) return;
      const payload = buildChapterCachePayload(
        bookId,
        chapterIdx,
        apiEvents,
        CHAPTER_GRAPH_CACHE_SOURCE.API
      );
      setCachedChapterEvents(bookId, chapterIdx, payload);
      if (typeof onPartialCache === 'function') {
        try {
          onPartialCache(payload);
        } catch (error) {
          console.warn('onPartialCache 콜백 실패:', error);
        }
      }
    };

    const manifestEventMap = new Map();
    const manifestEventIndices = [];
    manifestEventStructures.forEach((structure) => {
      const idx = Number(structure?.eventIdx);
      if (!Number.isFinite(idx) || idx <= 0 || manifestEventMap.has(idx)) return;
      manifestEventMap.set(idx, structure);
      manifestEventIndices.push(idx);
    });

    const sortedManifestIndices = manifestEventIndices.sort((a, b) => a - b);

    const appendSnapshotEvent = (eventIdx, manifestStructure, snapshot) => {
      const norm = normalizeEventFromDeltasGraphResult(
        bookId,
        chapterIdx,
        eventIdx,
        snapshot,
        manifestStructure
      );
      if (norm.skip) return false;
      apiEvents.push(norm.event);
      fetchedEventIdxSet.add(eventIdx);
      return true;
    };

    /** 정렬된 deltas → 이벤트 스냅샷 증분 적재 (through 우선 + 백필) */
    const appendEventsFromSortedDeltas = async (
      sourceBookId,
      sortedDeltas,
      eventEntries,
      chapterEventIdOrder
    ) => {
      if (!eventEntries.length) return;

      const walkerOpts = { chapterIndex: chapterIdx, chapterEventIdOrder };
      const lastEntry = eventEntries[eventEntries.length - 1];

      // Phase 1: through 이벤트 우선
      if (lastEntry?.eventId && !fetchedEventIdxSet.has(lastEntry.eventIdx)) {
        const throughWalker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
        appendSnapshotEvent(
          lastEntry.eventIdx,
          lastEntry.structure,
          throughWalker.snapshotThrough(lastEntry.eventId)
        );
        publishPartialCache();
      }

      // Phase 2: 전체 구간 백필
      const walker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
      let appended = 0;
      for (let i = 0; i < eventEntries.length; i += 1) {
        const { eventIdx, eventId, structure } = eventEntries[i];

        // 이미 캐시에 있으면 finalize(비김) 생략하고 누적 커서만 전진
        if (fetchedEventIdxSet.has(eventIdx)) {
          if (eventId) walker.advanceThrough(eventId);
          if (i > 0 && i % 16 === 0) await Promise.resolve();
          continue;
        }

        let snapshot;
        if (!eventId) {
          const prev = apiEvents
            .filter((ev) => (eventUtils.resolveEventNum(ev) || 0) < eventIdx)
            .sort(
              (a, b) =>
                (eventUtils.resolveEventNum(a) || 0) - (eventUtils.resolveEventNum(b) || 0)
            )
            .at(-1);
          snapshot = {
            bookId: sourceBookId,
            chapterIndex: chapterIdx,
            eventId: null,
            characters: Array.isArray(prev?.characters) ? deepClone(prev.characters) : [],
            relations: Array.isArray(prev?.relations) ? deepClone(prev.relations) : [],
            event: {
              chapterIndex: chapterIdx,
              chapterIdx,
              eventId: null,
              startTxtOffset: structure?.startTxtOffset ?? null,
              endTxtOffset: structure?.endTxtOffset ?? null,
            },
          };
        } else {
          snapshot = walker.snapshotThrough(eventId);
        }

        appendSnapshotEvent(eventIdx, structure, snapshot);
        appended += 1;

        if (i > 0 && i % 8 === 0) await Promise.resolve();
      }
      if (appended > 0) publishPartialCache();
    };

    /** 1회 deltas fetch 후 증분 누적 */
    const collectEventsFromDeltas = async (indicesToFetch) => {
      if (!indicesToFetch.length) return;

      let fetched;
      try {
        fetched = await ensureBookRelationshipDeltas(bookId, {
          chapterIndex: chapterIdx,
        });
      } catch (error) {
        console.warn(`⚠️ 챕터 ${chapterIdx} relationship-deltas 조회 실패:`, error);
        return;
      }

      if (!fetched?.isSuccess && !fetched?.deltas?.length) return;

      const eventEntries = indicesToFetch.map((eventIdx) => {
        const structure = manifestEventMap.get(eventIdx) ?? null;
        return {
          eventIdx,
          eventId: resolveManifestEventId(structure),
          structure,
        };
      });
      const chapterEventIdOrder = eventEntries.map((e) => e.eventId).filter(Boolean);
      const sortedDeltas = sortDeltasForAccumulate(fetched.deltas, chapterEventIdOrder);
      await appendEventsFromSortedDeltas(
        fetched.bookId ?? bookId,
        sortedDeltas,
        eventEntries,
        chapterEventIdOrder
      );
    };

    if (sortedManifestIndices.length > 0) {
      const indicesToFetch = cappedMaxEventIdx
        ? sortedManifestIndices.filter((idx) => idx <= cappedMaxEventIdx)
        : sortedManifestIndices;

      await collectEventsFromDeltas(indicesToFetch);
      if (apiEvents.length > 0) {
        return (
          getCachedChapterEvents(bookId, chapterIdx) ??
          buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API)
        );
      }
    }

    // manifest 이벤트 없을 때: 챕터 단위 deltas + 로컬 누적
    try {
      const fetched = await ensureBookRelationshipDeltas(bookId, {
        chapterIndex: chapterIdx,
      });
      const deltas = Array.isArray(fetched?.deltas) ? fetched.deltas : [];
      if (deltas.length > 0) {
        const sortedDeltas = sortDeltasForAccumulate(deltas);
        const seenIds = [];
        for (const delta of sortedDeltas) {
          const eventId = typeof delta?.eventId === 'string' ? delta.eventId.trim() : '';
          if (!eventId || seenIds.includes(eventId)) continue;
          // 해당 챕터 delta만 (chapterIndex가 있으면 필터)
          const deltaChapter = Number(delta?.chapterIndex);
          if (Number.isFinite(deltaChapter) && deltaChapter !== chapterIdx) continue;
          seenIds.push(eventId);
        }
        const idsToBuild = cappedMaxEventIdx ? seenIds.slice(0, cappedMaxEventIdx) : seenIds;
        const eventEntries = idsToBuild.map((eventId, index) => ({
          eventIdx: index + 1,
          eventId,
          structure: { eventIdx: index + 1, eventId },
        }));
        await appendEventsFromSortedDeltas(
          fetched.bookId ?? bookId,
          sortedDeltas,
          eventEntries,
          idsToBuild
        );
      }
    } catch (error) {
      console.warn(`⚠️ 챕터 ${chapterIdx} relationship-deltas(챕터) 조회 실패:`, error);
    }

    if (!apiEvents.length) {
      console.warn(`⚠️ 챕터 ${chapterIdx}: relationship-deltas에서 이벤트를 찾을 수 없음`);
      const emptyPayload = buildChapterCachePayload(
        bookId,
        chapterIdx,
        [],
        CHAPTER_GRAPH_CACHE_SOURCE.EMPTY
      );
      setCachedChapterEvents(bookId, chapterIdx, emptyPayload);
      return emptyPayload;
    }

    const payload = buildChapterCachePayload(
      bookId,
      chapterIdx,
      apiEvents,
      CHAPTER_GRAPH_CACHE_SOURCE.API
    );

    setCachedChapterEvents(bookId, chapterIdx, payload);
    return payload;
  })();

  chapterDiscoverPromises.set(discoverKey, discoverPromise);
  try {
    return await discoverPromise;
  } finally {
    chapterDiscoverPromises.delete(discoverKey);
  }
};

/** 읽기 위치 기준으로 필요한 이벤트만 선행 캐시 */
export const prefetchChapterEvents = (bookId, chapterIdx, throughEventIdx) => {
  const through = Number(throughEventIdx);
  if (!bookId || !chapterIdx || !Number.isFinite(through) || through < 1) {
    return Promise.resolve(null);
  }
  return discoverChapterEvents(bookId, chapterIdx, false, {
    maxEventIdx: through,
  });
};

const hasUsableChapterCache = (bookId, chapterIdx) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  if (!cached) return false;
  if (cached.source === CHAPTER_GRAPH_CACHE_SOURCE.INVALID) return false;
  if (cached.source === 'manifest-only') return false;
  return true;
};

const hasUsableChapterCacheThrough = (bookId, chapterIdx, throughEventIdx = null) => {
  if (!hasUsableChapterCache(bookId, chapterIdx)) return false;
  const through = Number(throughEventIdx);
  if (!Number.isFinite(through) || through < 1) return true;
  const cachedMax = Number(getCachedChapterEvents(bookId, chapterIdx)?.maxEventIdx) || 0;
  return cachedMax >= through;
};

/** 챕터 이벤트 캐시 확보. through 시점이 준비되면 즉시 success (백필은 백그라운드 계속). */
export async function ensureChapterEventsDiscovered(
  bookId,
  chapter,
  { onPartialCache = null, throughEventIdx = null } = {}
) {
  if (!bookId || !chapter || chapter < 1) {
    return { success: false, reason: 'invalid_args' };
  }
  if (hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx)) {
    return { success: true };
  }

  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const discoverPromise = discoverChapterEvents(bookId, chapter, attempt > 0, {
        maxEventIdx: throughEventIdx,
        onPartialCache,
      });

      // through 캐시가 생기는 순간 반환 (전체 이벤트 백필 완료를 기다리지 않음)
      for (;;) {
        if (hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx)) {
          return { success: true };
        }

        const race = await Promise.race([
          discoverPromise.then((payload) => ({ type: 'done', payload })),
          new Promise((resolve) => {
            setTimeout(() => resolve({ type: 'tick' }), 16);
          }),
        ]);

        if (race.type === 'done') {
          if (hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx)) {
            return { success: true };
          }
          break;
        }
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    return { success: false, reason: 'api_error', error: lastError };
  }
  return { success: false, reason: 'cache_missing' };
}

/** 캐시된 fine 집계 행만 반환 (네트워크 없음) */
export const getChapterEventFallbackData = (bookId, chapterIdx, eventIdx) => {
  const chapterCache = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterCache) return null;

  const reconstructed = reconstructChapterGraphState(chapterCache, eventIdx);
  if (reconstructed) {
    const characters = reconstructed.characters || [];
    const elements = reconstructed.elements || [];
    if (characters.length || elements.length) {
      const relations = eventUtils.convertElementsToRelations(elements, {
        includeLabel: true,
        includeCount: false,
        positivityDefault: null,
      });
      return {
        characters,
        relations,
        event: reconstructed.eventMeta || null,
      };
    }
  }

  const rawEvents = Array.isArray(chapterCache.rawEvents) ? chapterCache.rawEvents : [];
  const fallbackEvent = eventUtils.findEventInCache(rawEvents, eventIdx);
  if (fallbackEvent && (fallbackEvent.characters?.length || fallbackEvent.relations?.length)) {
    return {
      characters: Array.isArray(fallbackEvent.characters) ? fallbackEvent.characters : [],
      relations: Array.isArray(fallbackEvent.relations) ? fallbackEvent.relations : [],
      event: fallbackEvent.event || null,
    };
  }

  return null;
};

const bookDeltasCache = new Map();
const bookDeltasInflight = new Map();

const toBookKey = (bookId) => {
  const n = Number(bookId);
  return Number.isFinite(n) && n > 0 ? n : bookId;
};

const toChapterIndexOrNull = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
};

const loadFetchRelationshipDeltasList = async () => {
  const mod = await import('../api/graphApi');
  return mod.fetchRelationshipDeltasList;
};

export const clearBookRelationshipDeltas = (bookId) => {
  const key = toBookKey(bookId);
  bookDeltasCache.delete(key);
  bookDeltasInflight.delete(key);
};

const cacheCoversThrough = (cached, throughEventId, bookId) => {
  if (!cached || !Array.isArray(cached.deltas)) return false;
  const through = toTrimmedStringOrNull(throughEventId);
  if (!through) return true;
  const cachedTo = toTrimmedStringOrNull(cached.toEventId);
  if (!cachedTo) return false;
  if (cachedTo === through) return true;
  const order = listBookManifestEventIds(bookId);
  const iCached = order.indexOf(cachedTo);
  const iThrough = order.indexOf(through);
  if (iCached >= 0 && iThrough >= 0) return iCached >= iThrough;
  return cached.deltas.some((d) => toTrimmedStringOrNull(d?.eventId) === through);
};

const cacheCoversChapter = (cached, chapterIndex, bookId) => {
  const ch = toChapterIndexOrNull(chapterIndex);
  if (!cached || ch == null) return false;
  const covered = toChapterIndexOrNull(cached.coveredThroughChapter);
  if (covered != null && covered >= ch) return true;
  const lastId = resolveManifestEventId(getLastManifestEventInChapter(bookId, ch));
  return lastId ? cacheCoversThrough(cached, lastId, bookId) : false;
};

const mergeDeltasByEventId = (baseDeltas, nextDeltas) => {
  const merged = Array.isArray(baseDeltas) ? [...baseDeltas] : [];
  const seen = new Set(merged.map((d) => toTrimmedStringOrNull(d?.eventId)).filter(Boolean));
  for (const delta of Array.isArray(nextDeltas) ? nextDeltas : []) {
    if (!delta || typeof delta !== 'object') continue;
    const id = toTrimmedStringOrNull(delta.eventId);
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    merged.push(delta);
  }
  return merged;
};

const buildCacheEntry = (
  bookId,
  deltas,
  { toEventId = null, coveredThroughChapter = null, response = null, isSuccess = true } = {}
) => ({
  bookId,
  deltas: Array.isArray(deltas) ? deltas : [],
  toEventId: toTrimmedStringOrNull(toEventId),
  coveredThroughChapter: toChapterIndexOrNull(coveredThroughChapter),
  response,
  isSuccess: isSuccess !== false,
});

const fetchAndStoreByChapter = async (key, uptoChapter) => {
  const fetchRelationshipDeltasList = await loadFetchRelationshipDeltasList();
  let current = bookDeltasCache.get(key);
  if (current && cacheCoversChapter(current, uptoChapter, key)) return current;

  const covered = toChapterIndexOrNull(current?.coveredThroughChapter) ?? 0;
  const startChapter = Math.max(1, covered + 1);

  for (let ch = startChapter; ch <= uptoChapter; ch += 1) {
    if (current && cacheCoversChapter(current, ch, key)) continue;

    const fetched = await fetchRelationshipDeltasList(key, { chapterIndex: ch });
    const chapterLastId = resolveManifestEventId(getLastManifestEventInChapter(key, ch));
    current = buildCacheEntry(
      fetched.bookId ?? key,
      mergeDeltasByEventId(current?.deltas, fetched.deltas),
      {
        toEventId: chapterLastId || current?.toEventId || null,
        coveredThroughChapter: ch,
        response: fetched.response,
        isSuccess: fetched.isSuccess,
      }
    );
    bookDeltasCache.set(key, current);
  }

  return current ?? buildCacheEntry(key, []);
};

/** 책 deltas 확보 — chapterIndex(1..N) 챕터 단위 조회 */
export async function ensureBookRelationshipDeltas(bookId, { chapterIndex = null } = {}) {
  if (!bookId) throw new Error('bookId는 필수 매개변수입니다.');

  const key = toBookKey(bookId);
  const ch = toChapterIndexOrNull(chapterIndex);
  if (ch == null) {
    const error = new Error('chapterIndex가 필요합니다.');
    error.status = 400;
    throw error;
  }

  for (;;) {
    const existing = bookDeltasCache.get(key);
    if (existing && cacheCoversChapter(existing, ch, key)) {
      return existing;
    }

    const waitInflight = bookDeltasInflight.get(key);
    if (waitInflight) {
      try {
        await waitInflight;
      } catch {
        // 실패해도 아래에서 재시도
      }
      continue;
    }

    const run = fetchAndStoreByChapter(key, ch);
    bookDeltasInflight.set(key, run);
    try {
      return await run;
    } finally {
      if (bookDeltasInflight.get(key) === run) {
        bookDeltasInflight.delete(key);
      }
    }
  }
}
