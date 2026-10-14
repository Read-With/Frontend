/** 캐릭터·relations → Cytoscape elements: 캐릭터 맵 · 노드 가중치 · elements 빌드 · diff/fingerprint · 필터/서브그래프 */

import {
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
  undirectedPairKey,
  directedEdgeElementId,
  uniqueStrings,
  normalizeRelation,
  pickLastRelationLabel,
  mergeRelationLabelHistory,
  labelEventOrderHint,
  relationEventMetaPassthrough,
  processRelations,
  sortElementsByDataId,
} from './graphCore';
import {
  pickCharacterDisplayName,
  lookupRememberedCharacterDisplayName,
  buildManifestCharacterNameLookup,
  rememberCharacterDisplayName,
  isUsableCharacterDisplayName,
  enrichGraphCharacters,
  extractCharacterId,
} from './graphCharacterNames';
import { eventUtils } from '../viewer/viewerCore';
import {
  asArray,
  isPositiveFiniteNumberLiteral,
  toPositiveInt,
  errorUtils,
  stringOrEmpty,
} from '../common/valueUtils';
import { validateAndNormalizeProfileImageUrl } from './graphProfileImages';

const createEmptyCharacterMaps = () => ({
  idToName: {},
  idToDesc: {},
  idToMain: {},
  idToNames: {},
  idToProfileImage: {},
});

const resolveCharacterArray = (characters) => {
  if (!characters) return [];
  const list = characters?.characters ?? characters;
  return asArray(list);
};

/** id를 뽑을 수 있는 캐릭터만 (char, id)로 순회 */
function forEachIdentifiedCharacter(characters, visit) {
  asArray(characters).forEach((char) => {
    const id = char ? extractCharacterId(char) : null;
    if (id) visit(char, id);
  });
}

/**
 * 캐릭터 배열 → id 기반 lookup 맵.
 * @param {Array|Object|null} characters
 * @returns {{ idToName: Object, idToDesc: Object, idToMain: Object, idToNames: Object, idToProfileImage: Object }}
 */
function createCharacterMaps(characters) {
  try {
    const maps = createEmptyCharacterMaps();
    const { idToName, idToDesc, idToMain, idToNames, idToProfileImage } = maps;

    const characterArray = resolveCharacterArray(characters);
    if (!characterArray.length) {
      return maps;
    }

    let missingProfileImage = 0;
    forEachIdentifiedCharacter(characterArray, (char, id) => {

      const displayName = pickCharacterDisplayName(char);
      idToName[id] = displayName;
      // 소개: personalityText 우선. profileText는 이미지/캐릭터 프롬프트라 제외
      const personalityText =
        typeof char.personalityText === 'string' ? char.personalityText.trim() : '';
      const legacyDescription =
        typeof char.description === 'string' ? char.description.trim() : '';
      const bio = personalityText || legacyDescription;
      idToDesc[id] = bio;
      idToMain[id] = !!char.isMainCharacter;
      idToNames[id] = char.names || [];

      if (char.profileImage) {
        const validatedUrl = validateAndNormalizeProfileImageUrl(char.profileImage);
        if (validatedUrl) {
          idToProfileImage[id] = validatedUrl;
        } else if (import.meta.env.DEV) {
          errorUtils.logDebug('graphElements', '이미지 검증 실패', { characterId: id });
        }
      } else {
        missingProfileImage += 1;
      }
    });

    if (import.meta.env.DEV && missingProfileImage > 0) {
      errorUtils.logDebug('graphElements', '프로필 이미지 미설정 캐릭터', { count: missingProfileImage });
    }

    return maps;
  } catch (error) {
    errorUtils.logError('createCharacterMaps', error);
    return createEmptyCharacterMaps();
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. Node weights
 * ═══════════════════════════════════════════════════════════════════════════ */

function isNodeWeightEntryVisible(entry) {
  return Boolean(
    entry &&
    isPositiveFiniteNumberLiteral(entry.weight) &&
    isPositiveFiniteNumberLiteral(entry.count)
  );
}

function resolveNodeWeightAndCount(char, previousEntry = null) {
  const rawWeight = typeof char?.weight === 'number' ? char.weight : null;
  const hasCountField = typeof char?.count === 'number';
  const rawCount = hasCountField ? char.count : null;

  const weight = isPositiveFiniteNumberLiteral(rawWeight)
    ? rawWeight
    : (previousEntry && isPositiveFiniteNumberLiteral(previousEntry.weight) ? previousEntry.weight : null);

  let count = null;
  if (hasCountField) {
    count = isPositiveFiniteNumberLiteral(rawCount) ? rawCount : null;
  } else if (previousEntry && isPositiveFiniteNumberLiteral(previousEntry.count)) {
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

  if (isPositiveFiniteNumberLiteral(weight)) {
    merged.weight = weight;
  } else {
    delete merged.weight;
  }

  if (isPositiveFiniteNumberLiteral(count)) {
    merged.count = count;
  } else if (typeof merged.count !== 'number') {
    delete merged.count;
  }

  return merged;
}

/**
 * Cytoscape elements → nodeWeights 맵.
 * @param {Array} elements
 * @returns {Object.<string, { weight: number, count: number }>}
 */
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

/**
 * 이벤트별 캐릭터 ID 병합 (빈 필드는 이전 값 유지).
 * @param {Array} eventList
 * @returns {Map<string, Object>}
 */
export function aggregateCharactersFromEvents(eventList) {
  const charactersMap = new Map();

  if (!Array.isArray(eventList)) return charactersMap;

  eventList.forEach((entry) => {
    if (!entry) return;

    const characters = asArray(entry.characters);
    forEachIdentifiedCharacter(characters, (char, id) => {

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

/**
 * weight·count → nodeWeights 맵 (직전 weight·count 상속, 없으면 노드 비표시).
 * @param {Array} characters
 * @param {Object|null} [previousNodeWeights]
 * @returns {Object.<string, { weight: number, count: number }>}
 */
function buildNodeWeights(characters, previousNodeWeights = null) {
  const nodeWeights = cloneNodeWeightsMap(previousNodeWeights);

  if (!Array.isArray(characters)) return nodeWeights;

  forEachIdentifiedCharacter(characters, (char, id) => {

    const previousEntry = nodeWeights[id] ?? null;
    const { weight, count } = resolveNodeWeightAndCount(char, previousEntry);

    if (isPositiveFiniteNumberLiteral(weight) && isPositiveFiniteNumberLiteral(count)) {
      nodeWeights[id] = { weight, count };
    } else {
      delete nodeWeights[id];
    }
  });

  return nodeWeights;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. Elements build
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * characters + relations → cytoscape elements (표시·챕터 캐시 공통 진입점).
 * processRelations → maps/weights → convertRelationsToElements 순서를 고정한다.
 * @param {Object} params
 * @param {Array} [params.characters]
 * @param {Array} [params.relations]
 * @param {Object|null} [params.eventData]
 * @param {Object|null} [params.previousNodeWeights]
 * @param {string|number|null} [params.bookId]
 * @returns {{ elements: Array, characters: Array }}
 */
export function buildElementsFromGraphPayload({
  characters,
  relations,
  eventData = null,
  previousNodeWeights = null,
  bookId = null,
} = {}) {
  const chars = enrichGraphCharacters(
    asArray(characters),
    { bookId }
  );
  const rels = processRelations(asArray(relations));
  if (chars.length === 0 && rels.length === 0) {
    return { elements: [], characters: chars };
  }

  const { idToName, idToDesc, idToMain, idToNames, idToProfileImage } =
    createCharacterMaps(chars);
  const nodeWeights = buildNodeWeights(chars, previousNodeWeights);

  const elements = convertRelationsToElements({
    relations: rels,
    idToName,
    idToDesc,
    idToMain,
    idToNames,
    nodeWeights,
    eventData,
    idToProfileImage,
    charactersOrphanMerge: chars.length > 0 ? chars : null,
    bookId,
  });

  return {
    elements: asArray(elements),
    characters: chars,
  };
}

function resolveMostRecentRelationLabel(history, latestLabels = null, fallbackLabel = '') {
  if (!history || typeof history !== 'object') {
    return pickLastRelationLabel(latestLabels) || String(fallbackLabel ?? '').trim();
  }
  let latestText = '';
  let latestOrder = null;

  for (const [text, meta] of Object.entries(history)) {
    const trimmed = String(meta?.text || text || '').trim();
    if (!trimmed) continue;
    const order = labelEventOrderHint(meta?.lastEventId, meta?.lastEventOrdinal);
    if (latestOrder == null || (order != null && order >= latestOrder)) {
      latestText = trimmed;
      latestOrder = order ?? latestOrder;
    }
  }

  return (
    latestText ||
    pickLastRelationLabel(latestLabels) ||
    String(fallbackLabel ?? '').trim()
  );
}

/** relation / latestLabels / labelHistory 필드 머지 */
function mergeEdgeLabelFields(a = {}, b = {}) {
  const relationA = asArray(a.relation);
  const relationB = asArray(b.relation);
  const latestA = asArray(a.latestLabels);
  const latestB = asArray(b.latestLabels);
  return {
    relation: uniqueStrings([...relationA, ...relationB]),
    latestLabels: uniqueStrings([...latestA, ...latestB]),
    labelHistory: mergeRelationLabelHistory(a.labelHistory, b.labelHistory),
  };
}

function normalizedRelationTagKey(data) {
  return uniqueStrings(asArray(data?.relation)).sort().join('\x1e');
}

function positivityToken(data) {
  const n = Number(data?.positivity);
  return Number.isFinite(n) ? n : null;
}

/** 역방향 두 간선의 관계(태그·positivity)가 동일한지 — 동일하면 `-` 한 줄로 합침 */
function relationPayloadEquivalent(d0, d1) {
  return (
    normalizedRelationTagKey(d0) === normalizedRelationTagKey(d1) &&
    positivityToken(d0) === positivityToken(d1)
  );
}

function cloneEdgeData(el, extra = {}) {
  return { data: { ...el.data, ...extra } };
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
    const [e0, e1] = group;
    // directed 키가 유일하므로 버킷은 단방향 1개 또는 역쌍 2개 — 그 외는 방어적으로 그대로 둠
    const isReversePair =
      group.length === 2 &&
      e0.data.source === e1.data.target &&
      e0.data.target === e1.data.source;
    if (!isReversePair) {
      group.forEach((el) => out.push(cloneEdgeData(el)));
      continue;
    }
    const s0 = e0.data.source;
    const t0 = e0.data.target;
    if (relationPayloadEquivalent(e0.data, e1.data)) {
      const [a, b] = String(s0) <= String(t0) ? [s0, t0] : [t0, s0];
      const pos = positivityToken(e0.data);
      const merged = mergeEdgeLabelFields(e0.data, e1.data);
      const baseData = {
        id: `${a}-${b}`,
        source: a,
        target: b,
        bidirectional: true,
        ...merged,
        label: resolveMostRecentRelationLabel(
          merged.labelHistory,
          merged.latestLabels,
          e1.data.label || e0.data.label
        ),
        snapshotEventId: e0.data.snapshotEventId ?? e1.data.snapshotEventId ?? null,
      };
      if (pos !== null) baseData.positivity = pos;
      out.push({ data: baseData });
    } else {
      group.forEach((el) => out.push(cloneEdgeData(el, { reciprocalPair: true })));
    }
  }
  return out;
}

function isRelationVisibleAtEvent(rel, eventData) {
  if (!eventData || typeof eventData !== 'object') return true;

  const targetChapter = toPositiveInt(
    eventUtils.resolveChapterIdx(eventData) ?? eventData.chapterIdx ?? eventData.chapter,
    NaN
  );
  const targetEventIdx = toPositiveInt(eventUtils.resolveEventNum(eventData, null), NaN);

  const meta = relationEventMetaPassthrough(rel);
  const relationChapter = toPositiveInt(meta.chapterIdx, NaN);
  const relationEventIdx = resolveRelationEventOrdinal(rel, { fallback: NaN });

  if (
    Number.isFinite(targetChapter) &&
    Number.isFinite(relationChapter) &&
    relationChapter !== targetChapter
  ) {
    return relationChapter < targetChapter;
  }

  if (Number.isFinite(targetEventIdx) && Number.isFinite(relationEventIdx)) {
    return relationEventIdx <= targetEventIdx;
  }

  return true;
}

function resolveEdgeDisplayLabel(r) {
  const fromNorm = String(r?.label ?? '').trim();
  if (fromNorm) return fromNorm;
  return (
    pickLastRelationLabel(r?.latestLabels) ||
    pickLastRelationLabel(r?.relation) ||
    ''
  );
}

/** relation 이벤트 ordinal 후보를 공통 순서로 해석 */
function resolveRelationEventOrdinal(rel, { fallback = 0 } = {}) {
  const meta = relationEventMetaPassthrough(rel);
  const candidates = [
    eventUtils.resolveEventNum(rel, null),
    eventUtils.resolveEventNum(meta, null),
    rel?.event_id,
    rel?.event?.event_id,
  ];
  for (const candidate of candidates) {
    const n = toPositiveInt(candidate, NaN);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

/** relations + orphan characters → 등장 노드 id 목록 */
function collectRelationNodeIds(relations, charactersOrphanMerge) {
  const nodeSet = new Set();
  const nodeIds = [];

  const addId = (rawId) => {
    const strId = rawId == null ? '' : String(rawId);
    if (!strId || strId === '0') return;
    if (!nodeSet.has(strId)) {
      nodeSet.add(strId);
      nodeIds.push(strId);
    }
  };

  relations.forEach((rel) => {
    const r = normalizeRelation(rel);
    if (!r) return;
    addId(r.id1);
    addId(r.id2);
  });

  if (Array.isArray(charactersOrphanMerge) && charactersOrphanMerge.length > 0) {
    charactersOrphanMerge.forEach((char) => {
      addId(extractCharacterId(char));
    });
  }

  return { nodeSet, nodeIds };
}

/** nodeSet 표시명 해석 (manifest / remember / fallback) */
function resolveDisplayNamesForNodeSet(nodeSet, idToName, bookId) {
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
  return resolvedIdToName;
}

/** id 해시 기반 결정적 난수 (원형 배치용) */
function seededRandom(id, min, max) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  const seed = Math.abs(hash) % 10000;
  return min + (seed % (max - min));
}

/** weight가 유효한 노드만 원형 배치로 생성 */
function buildVisibleNodes({
  visibleNodeIds,
  resolvedIdToName,
  nodeWeights,
  idToMain,
  idToDesc,
  idToNames,
  idToProfileImage,
}) {
  const nodes = [];
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

    const nodeData = {
      id: strId,
      label: commonName,
      name: commonName,
      isMainCharacter: idToMain[strId] || false,
      description: idToDesc[strId] || '',
      personalityText: idToDesc[strId] || '',
      names: [commonName, ...(asArray(idToNames[strId]))],
      common_name: commonName,
      weight: nodeWeight,
      count: nodeCount,
    };

    const imagePath = idToProfileImage?.[strId];
    if (imagePath?.trim?.()) {
      nodeData.image = imagePath;
    }

    nodes.push({
      data: nodeData,
      position: { x, y }
    });
  });

  return nodes;
}

/**
 * id1→id2 방향만 누적; 역쌍은 finalizeDirectedEdges에서 합침.
 * @returns {Array} finalized edges
 */
function accumulateDirectedEdges(relations, { visibleNodeIdSet, eventData }) {
  const edgeMap = new Map();
  const positivityByEdge = new Map();
  const currentEventNum = eventUtils.resolveEventNum(eventData) || NaN;

  relations.forEach((rel) => {
    const r = normalizeRelation(rel);
    if (!r) return;
    if (!isRelationVisibleAtEvent(rel, eventData)) return;

    const id1 = String(r.id1);
    const id2 = String(r.id2);

    if (!visibleNodeIdSet.has(id1) || !visibleNodeIdSet.has(id2)) return;

    const edgeKey = directedEdgeElementId(id1, id2);

    const pNum = Number(r.positivity);
    if (Number.isFinite(pNum)) {
      let info = positivityByEdge.get(edgeKey);
      if (!info) {
        info = { lastFinite: null, lastFromCurrent: null, hasFromCurrent: false };
      }
      info.lastFinite = r.positivity;
      const relEventNum = eventUtils.resolveEventNum(rel) || NaN;
      if (Number.isFinite(currentEventNum) && relEventNum === currentEventNum) {
        info.lastFromCurrent = r.positivity;
        info.hasFromCurrent = true;
      }
      positivityByEdge.set(edgeKey, info);
    }

    const relationLabel = resolveEdgeDisplayLabel(r);
    const labelEventIdx = resolveRelationEventOrdinal(rel);
    const snapshotEventId =
      eventData?.eventId ??
      eventData?.id ??
      r.latestEventId ??
      null;

    if (edgeMap.has(edgeKey)) {
      const existingEdge = edgeMap.get(edgeKey);
      Object.assign(existingEdge.data, mergeEdgeLabelFields(existingEdge.data, r));
      if (snapshotEventId != null) {
        existingEdge.data.snapshotEventId = snapshotEventId;
      }
      const prevEv = existingEdge.data._labelEventIdx ?? -1;
      if (relationLabel && (!existingEdge.data.label || labelEventIdx >= prevEv)) {
        existingEdge.data.label = relationLabel;
        existingEdge.data._labelEventIdx = labelEventIdx;
      }
    } else {
      edgeMap.set(edgeKey, {
        data: {
          id: edgeKey,
          source: id1,
          target: id2,
          relation: [...r.relation],
          latestLabels: Array.isArray(r.latestLabels) ? [...r.latestLabels] : [],
          labelHistory: r.labelHistory && typeof r.labelHistory === 'object' ? { ...r.labelHistory } : {},
          snapshotEventId,
          label: relationLabel,
          _labelEventIdx: labelEventIdx,
        },
      });
    }
  });

  for (const el of edgeMap.values()) {
    delete el.data._labelEventIdx;
    if (!el.data.label) {
      el.data.label = pickLastRelationLabel(el.data.relation);
    }
    const info = positivityByEdge.get(el.data.id);
    if (!info) continue;
    const chosen = info.hasFromCurrent ? info.lastFromCurrent : info.lastFinite;
    if (chosen != null && Number.isFinite(Number(chosen))) {
      el.data.positivity = chosen;
    }
  }

  return finalizeDirectedEdges(edgeMap);
}

/**
 * 관계 데이터를 그래프 요소로 변환.
 * @param {Object} params
 * @param {Array} params.relations
 * @param {Object} params.idToName
 * @param {Object} [params.idToDesc]
 * @param {Object} [params.idToMain]
 * @param {Object} [params.idToNames]
 * @param {Object|null} [params.nodeWeights]
 * @param {Object|null} [params.eventData]
 * @param {Object|null} [params.idToProfileImage]
 * @param {Array|null} [params.charactersOrphanMerge]
 * @param {string|number|null} [params.bookId]
 * @returns {Array}
 */
function convertRelationsToElements({
  relations,
  idToName,
  idToDesc = {},
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

  const { nodeSet, nodeIds } = collectRelationNodeIds(relations, charactersOrphanMerge);
  const resolvedIdToName = resolveDisplayNamesForNodeSet(nodeSet, idToName, bookId);

  const validNodeIds = nodeIds.filter(
    (strId) => strId !== 'undefined' && strId !== 'null'
  );

  const visibleNodeIds = validNodeIds.filter((nodeId) => isNodeWeightEntryVisible(nodeWeights?.[nodeId]));
  const visibleNodeIdSet = new Set(visibleNodeIds);

  const nodes = buildVisibleNodes({
    visibleNodeIds,
    resolvedIdToName,
    nodeWeights,
    idToMain,
    idToDesc,
    idToNames,
    idToProfileImage,
  });

  const edges = accumulateDirectedEdges(relations, {
    visibleNodeIdSet,
    eventData,
  });

  return [
    ...sortElementsByDataId(nodes),
    ...sortElementsByDataId(edges)
  ];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. Diff / fingerprints
 * ═══════════════════════════════════════════════════════════════════════════ */

const validateElements = (elements) => elements?.filter(e => e && normalizeElementId(e)) || [];

const createElementMap = (elements) => new Map(elements.map(e => [normalizeElementId(e), e]));

export function deepEqual(obj1, obj2, depth = 0) {
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
 * 그래프 diff 계산 (data 비교)
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
  // 수정: id는 같지만 data가 다름 (position은 id 시드로 결정적이라 비교 불필요)
  const updated = validCurrElements.filter((e) => {
    const prev = prevMap.get(normalizeElementId(e));
    return Boolean(prev) && !deepEqual(prev.data, e.data);
  });
  return { added, removed, updated };
}

/**
 * Cytoscape 동기화 스킵용: 동일 id의 시각적 data만 문자열화.
 * 노드 image 포함 — blob resolve 전후 fingerprint가 달라져야 data 동기화가 스킵되지 않음.
 * @param {Object} el
 * @returns {string}
 */
export function visualElementSignature(el) {
  const d = el?.data;
  if (!d) return "";
  if (d.source) {
    const rel = Array.isArray(d.relation) ? d.relation.join("|") : String(d.relation ?? "");
    const topo = d.bidirectional ? "b" : d.reciprocalPair ? "r" : "";
    return `e:${rel}:${d.label ?? ""}:${d.positivity ?? ""}:${d.lineStyle ?? ""}:${d.width ?? ""}:${topo}`;
  }
  const image = stringOrEmpty(d.image);
  return `n:${d.label ?? ""}:${d.weight ?? ""}:${d.count ?? ""}:${d.isMainCharacter ?? ""}:${d.positivity ?? ""}\x1e${image}`;
}

/** visualElementSignature 노드 문자열에서 image 구간만 추출 (blob resolve 감지용) */
export function visualSignatureImagePart(sig) {
  if (typeof sig !== 'string' || !sig.startsWith('n:')) return '';
  const sep = sig.indexOf('\x1e');
  return sep >= 0 ? sig.slice(sep + 1) : '';
}

/**
 * props elements가 새 배열이어도 그래프 의미가 동일하면 effect·layout 재실행 생략.
 * @param {Array} elements
 * @returns {string}
 */
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

/**
 * 노드 id + 간선(id·source·target)만으로 골격 동일 여부 판별(라벨·관계문구 변경 시에도 동일하면 펄스 생략).
 * @param {Array} elements
 * @returns {string}
 */
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

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. Filter / subgraph
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * seed 노드에 연결된 edge(+endpoint 노드) 서브그래프.
 * @param {Array} elements
 * @param {Set|Iterable} seedNodeIds
 * @param {Object} [options]
 * @param {'any'|'both'} [options.seedEdgeMode='any'] any=한쪽만 seed, both=양끝 모두 seed
 * @param {boolean} [options.includeIsolatedSeeds=true] seed에 간선이 없어도 노드 포함
 * @returns {Array}
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
 * 3단계 필터링 로직 (GraphPage, GraphSplitArea 등에서 공통 사용)
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

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. Chapter cache payload / reconstruct / book summary
 * ═══════════════════════════════════════════════════════════════════════════ */
