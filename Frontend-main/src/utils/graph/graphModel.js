/**
 * graphModel: 캐릭터·relations → Cytoscape elements 변환 + 챕터/델타 캐시.
 * (파일 분리 없이 섹션으로만 구분)
 *
 * 섹션:
 * 1. Character maps / profile URL
 * 2. Node weights
 * 3. Elements build
 * 4. Diff / fingerprints
 * 5. Filter / subgraph / overlap
 * 6. Chapter cache payload / reconstruct / book summary
 * 7. Chapter discover / prefetch / ensure
 * 8. Book relationship deltas
 */

import { sanitizeAssetUrl, resolveApiArtifactUrl } from '../common/urlUtils';
import {
  isGraphEdgeElement,
  isGraphNodeElement,
  normalizeElementId,
  sortElementsByDataId,
  undirectedPairKey,
  directedEdgeElementId,
  uniqueStrings,
  normalizeRelation,
  pickLastRelationLabel,
  mergeRelationLabelHistory,
  relationEventMetaPassthrough,
  pickCharacterDisplayName,
  lookupRememberedCharacterDisplayName,
  buildManifestCharacterNameLookup,
  rememberCharacterDisplayName,
  isUsableCharacterDisplayName,
  enrichGraphCharacters,
  extractCharacterId,
  resolveManifestEventId,
  processRelations,
} from './graphCore';
import { eventUtils, cacheKeyUtils } from '../viewer/viewerCore';
import {
  deepClone,
  resolveChapterIndex,
  toNumberOrNull,
  toPositiveInt,
  toPositiveNumberOrNull,
  toTrimmedStringOrNull,
} from '../common/valueUtils';
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
  CHAPTER_EVENT_CACHE_PREFIX,
  CHAPTER_GRAPH_CACHE_SOURCE,
  isUnusableChapterGraphCacheSource,
} from '../common/cache/cacheManager';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. Character maps / profile URL
 * ═══════════════════════════════════════════════════════════════════════════ */

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

/**
 * 캐릭터 배열 → id 기반 lookup 맵.
 * @param {Array|Object|null} characters
 * @returns {{ idToName: Object, idToDesc: Object, idToDescKo: Object, idToMain: Object, idToNames: Object, idToProfileImage: Object }}
 */
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
      // 소개: personalityText 우선. profileText는 이미지/캐릭터 프롬프트라 제외
      const personalityText =
        typeof char.personalityText === 'string' ? char.personalityText.trim() : '';
      const legacyDescription =
        typeof char.description === 'string' ? char.description.trim() : '';
      const bio = personalityText || legacyDescription;
      idToDesc[id] = bio;
      idToDescKo[id] = bio;
      idToMain[id] = !!char.isMainCharacter;
      idToNames[id] = char.names || [];

      if (char.profileImage) {
        const validatedUrl = validateAndNormalizeProfileImageUrl(char.profileImage);
        if (validatedUrl) {
          idToProfileImage[id] = validatedUrl;
        } else if (import.meta.env.DEV) {
          console.debug(`[이미지 검증 실패] 캐릭터 ID: ${id}`);
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
      if (import.meta.env.DEV) {
        console.debug(`[이미지 검증] 유효하지 않은 절대 URL`);
      }
      return null;
    }
  }

  if (trimmed.startsWith('//')) {
    try {
      const resolved = new URL(trimmed, 'https://placeholder.local');
      return resolved.origin + resolved.pathname + resolved.search + resolved.hash;
    } catch {
      if (import.meta.env.DEV) {
        console.debug(`[이미지 검증] 유효하지 않은 프로토콜 상대 URL`);
      }
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    return resolveApiArtifactUrl(trimmed) || trimmed;
  }

  if (import.meta.env.DEV) {
    console.debug(`[이미지 검증] 유효하지 않은 이미지 URL 형식`);
  }
  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. Node weights
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 노드 weight가 양의 유한수인지 검사.
 * @param {*} weight
 * @returns {boolean}
 */
export function isValidNodeWeight(weight) {
  return typeof weight === 'number' && Number.isFinite(weight) && weight > 0;
}

function isValidNodeCount(count) {
  return typeof count === 'number' && Number.isFinite(count) && count > 0;
}

function isNodeWeightEntryVisible(entry) {
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

/**
 * weight·count → nodeWeights 맵 (직전 weight·count 상속, 없으면 노드 비표시).
 * @param {Array} characters
 * @param {Object|null} [previousNodeWeights]
 * @returns {Object.<string, { weight: number, count: number }>}
 */
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
function toNodeWeightsOrNull(nodeWeights) {
  if (!nodeWeights || typeof nodeWeights !== 'object') return null;
  return Object.keys(nodeWeights).length > 0 ? nodeWeights : null;
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
 * @param {Object|null} [params.deps] 테스트용 override
 * @returns {{ elements: Array, characters: Array }}
 */
export function buildElementsFromGraphPayload({
  characters,
  relations,
  eventData = null,
  previousNodeWeights = null,
  bookId = null,
  deps = null,
} = {}) {
  const mapsFn = deps?.createCharacterMaps ?? createCharacterMaps;
  const weightsFn = deps?.buildNodeWeights ?? buildNodeWeights;
  const convertFn = deps?.convertRelationsToElements ?? convertRelationsToElements;

  const chars = enrichGraphCharacters(
    Array.isArray(characters) ? characters : [],
    { bookId }
  );
  const rels = processRelations(Array.isArray(relations) ? relations : []);
  if (chars.length === 0 && rels.length === 0) {
    return { elements: [], characters: chars };
  }

  const { idToName, idToDesc, idToDescKo, idToMain, idToNames, idToProfileImage } =
    mapsFn(chars);
  const nodeWeights = weightsFn(chars, previousNodeWeights);

  const elements = convertFn({
    relations: rels,
    idToName,
    idToDesc,
    idToDescKo,
    idToMain,
    idToNames,
    nodeWeights: toNodeWeightsOrNull(nodeWeights),
    eventData,
    idToProfileImage,
    charactersOrphanMerge: chars.length > 0 ? chars : null,
    bookId,
  });

  return {
    elements: Array.isArray(elements) ? elements : [],
    characters: chars,
  };
}

function mergeEdgeLabels(a, b) {
  const t1 = String(a ?? '').trim();
  const t2 = String(b ?? '').trim();
  // 양방향 합칠 때도 한쪽(최근) 라벨만 겉에 표시
  return t2 || t1;
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
          latestLabels: uniqueStrings([
            ...(Array.isArray(e0.data.latestLabels) ? e0.data.latestLabels : []),
            ...(Array.isArray(e1.data.latestLabels) ? e1.data.latestLabels : []),
          ]),
          labelHistory: mergeRelationLabelHistory(e0.data.labelHistory, e1.data.labelHistory),
          snapshotEventId: e0.data.snapshotEventId ?? e1.data.snapshotEventId ?? null,
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

function resolveEdgeDisplayLabel(r) {
  const fromNorm = String(r?.label ?? '').trim();
  if (fromNorm) return fromNorm;
  return (
    pickLastRelationLabel(r?.latestLabels) ||
    pickLastRelationLabel(r?.relation) ||
    ''
  );
}

function relationEventOrdinal(rel) {
  const meta = relationEventMetaPassthrough(rel);
  const candidates = [
    eventUtils.resolveEventOrdinal(rel),
    eventUtils.resolveEventOrdinal(meta),
    rel?.event_id,
    rel?.event?.event_id,
  ];
  for (const candidate of candidates) {
    const n = toPositiveIntOrNaN(candidate);
    if (Number.isFinite(n)) return n;
  }
  return 0;
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

const SEEDED_RANDOM_MAX_CACHE = 500;

/** id 해시 기반 결정적 난수 (원형 배치용). cache Map은 호출측에서 재사용. */
function seededRandom(randomCache, id, min, max) {
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

  if (randomCache.size >= SEEDED_RANDOM_MAX_CACHE) {
    const entries = Array.from(randomCache.entries());
    const toDelete = entries.slice(0, Math.floor(SEEDED_RANDOM_MAX_CACHE / 2));
    toDelete.forEach(([key]) => randomCache.delete(key));
  }

  randomCache.set(cacheKey, result);
  return result;
}

/** weight가 유효한 노드만 원형 배치로 생성 */
function buildVisibleNodes({
  visibleNodeIds,
  resolvedIdToName,
  nodeWeights,
  idToMain,
  idToDesc,
  idToDescKo,
  idToNames,
  idToProfileImage,
  randomCache,
}) {
  const nodes = [];
  const centerX = 500;
  const centerY = 350;
  const radius = 320;

  visibleNodeIds.forEach((strId) => {
    const angle = seededRandom(randomCache, strId, 0, 360) * Math.PI / 180;
    const r = radius * (0.7 + 0.3 * (seededRandom(randomCache, strId, 0, 1000) / 1000));
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

  return nodes;
}

/**
 * id1→id2 방향만 누적; 역쌍은 finalizeDirectedEdges에서 합침.
 * @returns {Array} finalized edges
 */
function accumulateDirectedEdges(relations, { nodeSet, visibleNodeIdSet, eventData }) {
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

    const relationLabel = resolveEdgeDisplayLabel(r);
    const relEv = relationEventOrdinal(rel);
    const snapshotEventId =
      eventData?.eventId ??
      eventData?.id ??
      r.latestEventId ??
      null;

    if (edgeMap.has(edgeKey)) {
      const existingEdge = edgeMap.get(edgeKey);
      existingEdge.data.relation = uniqueStrings([...existingEdge.data.relation, ...r.relation]);
      existingEdge.data.latestLabels = uniqueStrings([
        ...(Array.isArray(existingEdge.data.latestLabels) ? existingEdge.data.latestLabels : []),
        ...(Array.isArray(r.latestLabels) ? r.latestLabels : []),
      ]);
      existingEdge.data.labelHistory = mergeRelationLabelHistory(
        existingEdge.data.labelHistory,
        r.labelHistory
      );
      if (snapshotEventId != null) {
        existingEdge.data.snapshotEventId = snapshotEventId;
      }
      const prevEv = existingEdge.data._labelEventIdx ?? -1;
      if (relationLabel && relEv >= prevEv) {
        existingEdge.data.label = relationLabel;
        existingEdge.data._labelEventIdx = relEv;
      } else if (!existingEdge.data.label && relationLabel) {
        existingEdge.data.label = relationLabel;
        existingEdge.data._labelEventIdx = relEv;
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
          _labelEventIdx: relEv,
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

  const { nodeSet, nodeIds } = collectRelationNodeIds(relations, charactersOrphanMerge);
  const resolvedIdToName = resolveDisplayNamesForNodeSet(nodeSet, idToName, bookId);
  const randomCache = new Map();

  const validNodeIds = nodeIds.filter(
    (strId) => strId && strId !== '0' && strId !== 'undefined' && strId !== 'null'
  );

  const visibleNodeIds = validNodeIds.filter((nodeId) => isNodeWeightEntryVisible(nodeWeights?.[nodeId]));
  const visibleNodeIdSet = new Set(visibleNodeIds);

  const nodes = buildVisibleNodes({
    visibleNodeIds,
    resolvedIdToName,
    nodeWeights,
    idToMain,
    idToDesc,
    idToDescKo,
    idToNames,
    idToProfileImage,
    randomCache,
  });

  const edges = accumulateDirectedEdges(relations, {
    nodeSet,
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
 * 그래프 diff 계산 (position까지 비교)
 */
function calcGraphDiff(prevElements, currElements) {
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

/**
 * Cytoscape 동기화 스킵용: 동일 id의 시각적 data만 문자열화.
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
  return `n:${d.label ?? ""}:${d.weight ?? ""}:${d.count ?? ""}:${d.isMainCharacter ?? ""}:${d.positivity ?? ""}`;
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
 * 5. Filter / subgraph / overlap
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

function readNodeRadius(node, fallbackSize = 40) {
  try {
    const w = typeof node.outerWidth === 'function' ? node.outerWidth() : 0;
    const h = typeof node.outerHeight === 'function' ? node.outerHeight() : 0;
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
      return Math.max(w, h) / 2;
    }
  } catch {
    /* ignore */
  }
  const size = typeof fallbackSize === 'number' && fallbackSize > 0 ? fallbackSize : 40;
  return size / 2;
}

/** detectAndResolveOverlap / 호출부 공용 기본값 */
export const OVERLAP_RESOLVE = Object.freeze({
  FALLBACK_NODE_SIZE: 40,
  PADDING: 16,
  MAX_ITERATIONS: 12,
  MAX_ITERATIONS_LIGHT: 8,
  MAX_NODES: 150,
});

/**
 * 노드 겹침 감지 및 자동 조정
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {number} [nodeSize=OVERLAP_RESOLVE.FALLBACK_NODE_SIZE] - 크기 읽기 실패 시 fallback (지름)
 * @param {Object} [options]
 * @param {Iterable<string>|null} [options.movableIds] - 지정 시 해당 노드만 이동(기존 노드 위치 유지)
 * @param {number} [options.maxIterations] - 밀어내기 반복 횟수
 * @param {number} [options.padding] - 반경 합에 더하는 여유 간격
 * @returns {boolean} 겹침이 있었는지 여부
 */
export function detectAndResolveOverlap(
  cy,
  nodeSize = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE,
  options = {},
) {
  if (!cy) {
    return false;
  }

  if (typeof nodeSize !== 'number' || nodeSize <= 0) {
    nodeSize = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE;
  }

  const movableIdSet = options.movableIds
    ? new Set([...options.movableIds].map(String).filter((id) => id !== ''))
    : null;
  if (movableIdSet && movableIdSet.size === 0) {
    return false;
  }

  const nodes = cy.nodes();
  const padding =
    typeof options.padding === 'number' && options.padding >= 0
      ? options.padding
      : OVERLAP_RESOLVE.PADDING;
  const maxIterations =
    typeof options.maxIterations === 'number' && options.maxIterations > 0
      ? options.maxIterations
      : movableIdSet
        ? OVERLAP_RESOLVE.MAX_ITERATIONS
        : OVERLAP_RESOLVE.MAX_ITERATIONS_LIGHT;
  let hasOverlap = false;

  if (nodes.length > OVERLAP_RESOLVE.MAX_NODES) {
    return false;
  }

  const nodePositions = nodes.map((node) => ({
    node,
    id: String(node.id()),
    pos: node.position(),
    radius: readNodeRadius(node, nodeSize),
  }));

  for (let iter = 0; iter < maxIterations; iter++) {
    let movedThisPass = false;

    for (let i = 0; i < nodePositions.length; i++) {
      for (let j = i + 1; j < nodePositions.length; j++) {
        const { node: node1, id: id1, pos: pos1, radius: r1 } = nodePositions[i];
        const { node: node2, id: id2, pos: pos2, radius: r2 } = nodePositions[j];

        const node1Movable = !movableIdSet || movableIdSet.has(id1);
        const node2Movable = !movableIdSet || movableIdSet.has(id2);
        if (!node1Movable && !node2Movable) continue;

        const minDistance = r1 + r2 + padding;
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared >= minDistance * minDistance) continue;

        hasOverlap = true;
        movedThisPass = true;
        const distance = Math.sqrt(distanceSquared);
        const angle =
          distance < 1e-6
            ? (i + j) * 0.7
            : Math.atan2(dy, dx);
        const pushDistance = minDistance - distance + 8;
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
          const newPos1 = {
            x: pos2.x + cos * minDistance,
            y: pos2.y + sin * minDistance,
          };
          node1.position(newPos1);
          nodePositions[i].pos = newPos1;
        } else {
          const newPos2 = {
            x: pos1.x - cos * minDistance,
            y: pos1.y - sin * minDistance,
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

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. Chapter cache payload / reconstruct / book summary
 * ═══════════════════════════════════════════════════════════════════════════ */

const cloneArray = (arr) => (Array.isArray(arr) ? arr.map(deepClone) : []);

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
    else if (!deepEqual(prev, character)) updated.push(deepClone(character));
  });
  prevMap.forEach((_character, id) => {
    if (!nextMap.has(id)) removedIds.push(id);
  });
  return { added, updated, removedIds };
};

/** map → remove → update → add. getKey는 item → string id */
const applyKeyedDiff = (prevItems, diff, getKey) => {
  const map = new Map();
  (Array.isArray(prevItems) ? prevItems : []).forEach((item) => {
    const id = getKey(item);
    if (id) map.set(id, deepClone(item));
  });
  (diff?.removedIds || []).forEach((id) => id && map.delete(String(id)));
  (diff?.updated || []).forEach((item) => {
    const id = getKey(item);
    if (id) map.set(id, deepClone(item));
  });
  (diff?.added || []).forEach((item) => {
    const id = getKey(item);
    if (id) map.set(id, deepClone(item));
  });
  return map;
};

const applyCharacterDiff = (prevCharacters, diff) =>
  Array.from(applyKeyedDiff(prevCharacters, diff, extractCharacterId).values());

const applyElementDiff = (prevElements, diff) => {
  const map = applyKeyedDiff(prevElements, diff, normalizeElementId);
  const result = Array.from(map.values());
  result.sort((a, b) => {
    const aIsEdge = Boolean(a?.data?.source);
    const bIsEdge = Boolean(b?.data?.source);
    if (aIsEdge !== bIsEdge) return aIsEdge ? 1 : -1;
    return (normalizeElementId(a) || '').localeCompare(normalizeElementId(b) || '');
  });
  return result;
};

/** 이벤트 1건 → elements/characters/summary (캐시 payload 루프용) */
function buildEventSnapshotRow(bookId, chapterIdx, event) {
  let convertedElements = [];
  let snapshotCharacters = [];
  try {
    const built = buildElementsFromGraphPayload({
      characters: Array.isArray(event?.characters) ? event.characters : [],
      relations: Array.isArray(event?.relations) ? event.relations : [],
      eventData: event?.event ?? null,
      bookId,
    });
    convertedElements = built.elements;
    snapshotCharacters = built.characters;
  } catch (error) {
    console.error('buildElementsFromGraphPayload 실패:', error);
  }

  const summaryEventNum = Number(event.eventNum);
  const summaryIdx = Number(event.eventIdx) || 0;
  const summary = {
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
    hasRelations: Array.isArray(event?.relations) && event.relations.length > 0,
  };

  return { convertedElements, snapshotCharacters, summary };
}

const buildChapterCachePayload = (
  bookId,
  chapterIdx,
  events,
  source = CHAPTER_GRAPH_CACHE_SOURCE.API
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
    const { convertedElements, snapshotCharacters, summary } = buildEventSnapshotRow(
      bookId,
      chapterIdx,
      event
    );

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
    eventSummaries.push(summary);
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

/**
 * baseSnapshot + diffs → targetEventIdx 시점 그래프 상태.
 * @param {Object} cachePayload
 * @param {number} targetEventIdx
 * @returns {{ elements: Array, characters: Array, eventMeta: Object|null, eventIdx: number }|null}
 */
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

/**
 * 책 단위 챕터 요약 캐시 빌드/보장. 메모리 + localStorage 기록.
 * @param {string|number} bookId
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<Object|null>}
 */
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

/**
 * book/chapter/eventIdx 누적 그래프 상태 조회 (챕터 TTL 캐시 기반).
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number} eventIdx
 * @returns {{ elements: Array, characters: Array, eventMeta: Object|null, eventIdx: number }|null}
 */
export const getGraphEventState = (bookId, chapterIdx, eventIdx) => {
  const chapterPayload = getCachedChapterEvents(bookId, chapterIdx);
  if (!chapterPayload) return null;
  return reconstructChapterGraphState(chapterPayload, eventIdx);
};

/**
 * deltas 누적 graph 스냅샷 한 건 → 챕터 캐시 이벤트 행.
 * (graphFetch.mapLegacyOrSummaryEvent와 별도; 입력은 deltas walker snapshot)
 */
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
  return `${CHAPTER_EVENT_CACHE_PREFIX}${cacheKeyUtils.createChapterKey(bookIdNum, chapterIdxNum)}`;
};

/**
 * 챕터 이벤트 TTL 캐시 로드.
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @returns {Object|null}
 */
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

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. Chapter discover / prefetch / ensure
 * ═══════════════════════════════════════════════════════════════════════════ */

function loadManifestEventStructures(bookId, chapterIdx) {
  try {
    const manifestChapter = getChapterData(bookId, chapterIdx);
    if (!manifestChapter?.events?.length) return [];
    return manifestChapter.events
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
  } catch (error) {
    console.warn('manifest 이벤트 구조 로드 실패:', error);
    return [];
  }
}

function buildManifestEventIndex(manifestEventStructures) {
  const manifestEventMap = new Map();
  const manifestEventIndices = [];
  manifestEventStructures.forEach((structure) => {
    const idx = Number(structure?.eventIdx);
    if (!Number.isFinite(idx) || idx <= 0 || manifestEventMap.has(idx)) return;
    manifestEventMap.set(idx, structure);
    manifestEventIndices.push(idx);
  });
  return {
    manifestEventMap,
    sortedManifestIndices: manifestEventIndices.sort((a, b) => a - b),
  };
}

function publishChapterPartialCache(bookId, chapterIdx, apiEvents, onPartialCache) {
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
}

function appendSnapshotEventToContext(ctx, eventIdx, manifestStructure, snapshot) {
  const norm = normalizeEventFromDeltasGraphResult(
    ctx.bookId,
    ctx.chapterIdx,
    eventIdx,
    snapshot,
    manifestStructure
  );
  if (norm.skip) return false;
  ctx.apiEvents.push(norm.event);
  ctx.fetchedEventIdxSet.add(eventIdx);
  return true;
}

/** apiEvents가 증가 적재된다는 전제에서 eventIdx 직전 이벤트 O(n) 스캔 */
function findPreviousApiEventBeforeIdx(apiEvents, eventIdx) {
  let best = null;
  let bestIdx = -1;
  for (let i = 0; i < apiEvents.length; i += 1) {
    const n = eventUtils.resolveEventNum(apiEvents[i]) || 0;
    if (n > 0 && n < eventIdx && n >= bestIdx) {
      bestIdx = n;
      best = apiEvents[i];
    }
  }
  return best;
}

/** 정렬된 deltas → 이벤트 스냅샷 증분 적재 (through 우선 + 백필) */
async function appendEventsFromSortedDeltas(ctx, sourceBookId, sortedDeltas, eventEntries, chapterEventIdOrder) {
  if (!eventEntries.length) return;

  const { chapterIdx, fetchedEventIdxSet, apiEvents, onPartialCache } = ctx;
  const walkerOpts = { chapterIndex: chapterIdx, chapterEventIdOrder };
  const lastEntry = eventEntries[eventEntries.length - 1];

  // Phase 1: through 이벤트 우선
  if (lastEntry?.eventId && !fetchedEventIdxSet.has(lastEntry.eventIdx)) {
    const throughWalker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
    appendSnapshotEventToContext(
      ctx,
      lastEntry.eventIdx,
      lastEntry.structure,
      throughWalker.snapshotThrough(lastEntry.eventId)
    );
    publishChapterPartialCache(ctx.bookId, chapterIdx, apiEvents, onPartialCache);
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
      const prev = findPreviousApiEventBeforeIdx(apiEvents, eventIdx);
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

    appendSnapshotEventToContext(ctx, eventIdx, structure, snapshot);
    appended += 1;

    if (i > 0 && i % 8 === 0) await Promise.resolve();
  }
  if (appended > 0) {
    publishChapterPartialCache(ctx.bookId, chapterIdx, apiEvents, onPartialCache);
  }
}

/** 1회 deltas fetch 후 증분 누적 */
async function collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap) {
  if (!indicesToFetch.length) return;

  const { bookId, chapterIdx } = ctx;
  let fetched;
  try {
    fetched = await ensureBookRelationshipDeltas(bookId, {
      chapterIndex: chapterIdx,
    });
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug(`챕터 ${chapterIdx} relationship-deltas 조회 실패`, error?.message || error);
    }
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
    ctx,
    fetched.bookId ?? bookId,
    sortedDeltas,
    eventEntries,
    chapterEventIdOrder
  );
}

/** manifest 이벤트 없을 때: 챕터 단위 deltas + 로컬 누적 */
async function discoverWithoutManifest(ctx, cappedMaxEventIdx) {
  const { bookId, chapterIdx } = ctx;
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
        ctx,
        fetched.bookId ?? bookId,
        sortedDeltas,
        eventEntries,
        idsToBuild
      );
    }
  } catch (error) {
    if (import.meta.env.DEV) {
      console.debug(`챕터 ${chapterIdx} relationship-deltas(챕터) 조회 실패`, error?.message || error);
    }
  }
}

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
    if (cached && !isUnusableChapterGraphCacheSource(cached.source)) {
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
    if (cached && !isUnusableChapterGraphCacheSource(cached.source)) {
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

    const ctx = {
      bookId,
      chapterIdx,
      apiEvents,
      fetchedEventIdxSet,
      onPartialCache,
    };

    const manifestEventStructures = loadManifestEventStructures(bookId, chapterIdx);
    const { manifestEventMap, sortedManifestIndices } = buildManifestEventIndex(manifestEventStructures);

    if (sortedManifestIndices.length > 0) {
      const indicesToFetch = cappedMaxEventIdx
        ? sortedManifestIndices.filter((idx) => idx <= cappedMaxEventIdx)
        : sortedManifestIndices;

      await collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap);
      if (apiEvents.length > 0) {
        return (
          getCachedChapterEvents(bookId, chapterIdx) ??
          buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API)
        );
      }
    }

    await discoverWithoutManifest(ctx, cappedMaxEventIdx);

    if (!apiEvents.length) {
      if (import.meta.env.DEV) {
        console.debug(`챕터 ${chapterIdx}: relationship-deltas 이벤트 없음`);
      }
      // EMPTY를 캐시에 쓰지 않음 — "빈 성공" 고착 방지 (재요청 가능)
      return null;
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

/**
 * 읽기 위치 기준으로 필요한 이벤트만 선행 캐시 (TTL 스토리지 기록).
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number} throughEventIdx
 * @returns {Promise<Object|null>}
 */
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
  if (isUnusableChapterGraphCacheSource(cached.source)) return false;
  return true;
};

/**
 * through 시점까지 사용 가능 캐시 여부.
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number|null} [throughEventIdx]
 * @returns {boolean}
 */
export const hasUsableChapterCacheThrough = (bookId, chapterIdx, throughEventIdx = null) => {
  if (!hasUsableChapterCache(bookId, chapterIdx)) return false;
  const through = Number(throughEventIdx);
  if (!Number.isFinite(through) || through < 1) return true;
  const cachedMax = Number(getCachedChapterEvents(bookId, chapterIdx)?.maxEventIdx) || 0;
  return cachedMax >= through;
};

/**
 * 챕터 이벤트 캐시 확보. through 시점이 준비되면 즉시 success (백필은 백그라운드 계속).
 * @param {string|number} bookId
 * @param {number} chapter
 * @param {Object} [options]
 * @param {Function|null} [options.onPartialCache]
 * @param {number|null} [options.throughEventIdx]
 * @returns {Promise<{ success: boolean, reason?: string, error?: Error }>}
 */
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

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. Book relationship deltas
 * ═══════════════════════════════════════════════════════════════════════════ */

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

/**
 * 책 deltas 메모리/inflight 캐시 클리어.
 * @param {string|number} bookId
 */
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
) => {
  const list = Array.isArray(deltas) ? deltas : [];
  return {
    bookId,
    deltas: list,
    toEventId: toTrimmedStringOrNull(toEventId),
    coveredThroughChapter: toChapterIndexOrNull(coveredThroughChapter),
    response,
    // soft/hard fail은 성공으로 덮지 않음 — 호출측에서 ERROR와 빈 데이터를 구분
    isSuccess: isSuccess !== false,
  };
};

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
    const chapterOk = fetched.isSuccess !== false;

    // hard/soft fail을 빈 성공·커버리지로 캐시하지 않음 (재시도 가능, noRelation과 구분)
    if (!chapterOk) {
      const err = new Error(
        fetched.response?.message || '관계 델타 조회에 실패했습니다.'
      );
      err.code = fetched.response?.code || 'ERROR';
      err.response = fetched.response;
      throw err;
    }

    current = buildCacheEntry(
      fetched.bookId ?? key,
      mergeDeltasByEventId(current?.deltas, fetched.deltas),
      {
        toEventId: chapterLastId || current?.toEventId || null,
        coveredThroughChapter: ch,
        response: fetched.response,
        isSuccess: true,
      }
    );
    bookDeltasCache.set(key, current);
  }

  return current ?? buildCacheEntry(key, []);
};

/**
 * 책 deltas 확보 — chapterIndex(1..N) 챕터 단위 조회. 메모리 캐시 기록.
 * @param {string|number} bookId
 * @param {{ chapterIndex?: number|null }} [options]
 * @returns {Promise<{ bookId: *, deltas: Array, toEventId: string|null, coveredThroughChapter: number|null, response: *, isSuccess: boolean }>}
 */
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
