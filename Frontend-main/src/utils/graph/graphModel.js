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
 * 6. Chapter cache payload / reconstruct / book summary / cache → events
 * 7. Chapter discover / prefetch / ensure
 * 8. Book relationship deltas / macro graph response
 */

import {
  sanitizeAssetUrl,
  resolveApiArtifactUrl,
  isProtectedPublicAsset,
} from '../common/urlUtils';
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
  labelEventOrderHint,
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
  appendRelationLabelHistory,
} from './graphCore';
import { eventUtils, cacheKeyUtils, ELEMENTS_TO_RELATIONS_OPTS } from '../viewer/viewerCore';
import {
  asArray,
  extractApiBookId,
  isPositiveFiniteNumberLiteral,
  resolveChapterIndex,
  toNumberOrNull,
  toPositiveInt,
  toPositiveNumberOrNull,
  sleep,
  toTrimmedStringOrNull,
  clampPositivity,
  errorUtils,
  stringOrEmpty,
  compareLocale,
} from '../common/valueUtils';
import { buildGraphEventMeta, fetchRelationshipDeltasList, FETCH_STATUS, hasGraphPayload } from '../api/graphApi';
import { requireBookId, toUnifiedApiResponse } from '../api/authApi';
import { getBookManifest, fetchAuthenticatedAssetBlobUrl } from '../api/booksApi';
import {
  getChapterData,
  getManifestFromCache,
  calculateMaxChapterFromChapters,
  getLastManifestEventInChapter,
  getFirstManifestEventInChapter,
  listBookManifestEventIds,
} from '../common/cache/manifestCache';
import {
  setBounded,
  loadTtlStorage,
  saveTtlStorage,
  awaitTracked,
  saveToStorage,
  removeFromStorage,
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
  idToMain: {},
  idToNames: {},
  idToProfileImage: {},
});

const resolveCharacterArray = (characters) => {
  if (!characters) return [];
  const list = characters?.characters ?? characters;
  return asArray(list);
};

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
      idToMain[id] = !!char.isMainCharacter;
      idToNames[id] = char.names || [];

      if (char.profileImage) {
        const validatedUrl = validateAndNormalizeProfileImageUrl(char.profileImage);
        if (validatedUrl) {
          idToProfileImage[id] = validatedUrl;
        } else if (import.meta.env.DEV) {
          errorUtils.logDebug('graphModel', '이미지 검증 실패', { characterId: id });
        }
      } else {
        missingProfileImage += 1;
      }
    });

    if (import.meta.env.DEV && missingProfileImage > 0) {
      errorUtils.logDebug('graphModel', '프로필 이미지 미설정 캐릭터', { count: missingProfileImage });
    }

    return maps;
  } catch (error) {
    errorUtils.logError('createCharacterMaps', error);
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
        errorUtils.logDebug('graphModel', '유효하지 않은 절대 URL');
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
        errorUtils.logDebug('graphModel', '유효하지 않은 프로토콜 상대 URL');
      }
      return null;
    }
  }

  if (trimmed.startsWith('/')) {
    return resolveApiArtifactUrl(trimmed) || trimmed;
  }

  if (import.meta.env.DEV) {
    errorUtils.logDebug('graphModel', '유효하지 않은 이미지 URL 형식');
  }
  return null;
}

/* ─── 프로필 이미지 resolve (보호 자산 → blob, 직접 URL → 로드 프로브) ─── */

export const GRAPH_IMAGE_DEFERRED_RETRY_MS = 1_500;

const stillNeedsProtectedImageResolve = (image) =>
  !!image && isProtectedPublicAsset(image) && !String(image).startsWith('blob:');

/**
 * /public/ 밖의 직접 URL(CDN 등)은 인증 없이 그대로 <img>/캔버스에 쓰인다 — CORS 차단이나
 * 파일 부재 시 브라우저가 조용히 로드를 실패시켜, 그래프 노드에 이미지도 배경색도 없이
 * 빈 원만 남는다. 실제 로드 가능 여부를 한 번 프로브해 실패분은 image 필드를 제거,
 * 스타일시트의 기본 배경색(node 셀렉터)으로 폴백시킨다.
 */
const directImageLoadableCache = new Map();
const DIRECT_IMAGE_PROBE_TIMEOUT_MS = 4_000;

const needsDirectImageVerification = (image) =>
  !!image && !isProtectedPublicAsset(image) && !String(image).startsWith('blob:');

function probeImageLoadable(url) {
  if (typeof Image === 'undefined') return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    const img = new Image();
    // Cytoscape는 background-image를 기본 crossOrigin='anonymous'로 로드한다(캔버스 오염 방지).
    // 여기서도 동일하게 설정해야, CORS 헤더가 없는 origin의 이미지를 "로드 가능"으로 오판하지 않는다
    // (crossOrigin 없는 <img> 프로브는 통과하지만 실제 캔버스 렌더링은 CORS로 차단되는 불일치 방지).
    img.crossOrigin = 'anonymous';
    img.onload = () => finish(true);
    img.onerror = () => finish(false);
    // 응답이 느릴 뿐 실패는 아닐 수 있으므로, 타임아웃은 실패로 단정하지 않고 통과시킨다.
    setTimeout(() => finish(true), DIRECT_IMAGE_PROBE_TIMEOUT_MS);
    img.src = url;
  });
}

async function isDirectImageLoadable(url) {
  if (directImageLoadableCache.has(url)) return directImageLoadableCache.get(url);
  const ok = await probeImageLoadable(url);
  directImageLoadableCache.set(url, ok);
  return ok;
}

async function resolveOneGraphProfileImage(el, { force = false } = {}) {
  const image = el?.data?.image;
  if (!image) return el;

  if (stillNeedsProtectedImageResolve(image)) {
    const blobUrl = await fetchAuthenticatedAssetBlobUrl(image, { force });
    if (!blobUrl || blobUrl === image) return el;
    return { ...el, data: { ...el.data, image: blobUrl } };
  }

  if (needsDirectImageVerification(image)) {
    const loadable = await isDirectImageLoadable(image);
    if (loadable) return el;
    const { image: _unused, ...restData } = el.data;
    return { ...el, data: restData };
  }

  return el;
}

export function graphElementsHaveUnresolvedProfileImages(elements) {
  if (!Array.isArray(elements) || elements.length === 0) return false;
  return elements.some((el) => stillNeedsProtectedImageResolve(el?.data?.image));
}

export async function resolveGraphElementsProfileImages(elements, options = {}) {
  if (!Array.isArray(elements) || elements.length === 0) return elements;
  const { force = false } = options;
  return Promise.all(elements.map((el) => resolveOneGraphProfileImage(el, { force })));
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
function buildNodeWeights(characters, previousNodeWeights = null) {
  const nodeWeights = cloneNodeWeightsMap(previousNodeWeights);

  if (!Array.isArray(characters)) return nodeWeights;

  characters.forEach((char) => {
    if (!char) return;
    const id = extractCharacterId(char);
    if (!id) return;

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
 * 그래프 diff 계산 (data 비교)
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

export function readNodeRadius(node, fallbackSize = 40) {
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
  PADDING: 8,
  MAX_ITERATIONS: 8,
  MAX_ITERATIONS_LIGHT: 3,
  /** 메인 반복 후에도 겹치면 추가 패스 */
  EXTRA_PASSES: 1,
  /** 양측·편측 밀어내기 공통 여유(px) */
  PUSH_EXTRA: 2,
  /** 이 깊이(px) 이하의 본체 겹침은 시각적 안정성을 위해 허용 */
  OVERLAP_TOLERANCE: 3,
  /** 이 깊이(px) 이상이면 완전한 여유 간격까지 강하게 분리 */
  SEVERE_OVERLAP: 12,
});

export const OVERLAP_PROFILES = Object.freeze({
  /** 최초 로딩·전체 재배치: 본체 겹침 허용 없음. 정착 상태이므로 여유 간격을 크게 둔다 */
  INITIAL: Object.freeze({ padding: 16, tolerance: 0, maxIterations: 16, extraPasses: 3 }),
  /** 동시 등장 신규 노드끼리: 본체 겹침 허용 없음. INITIAL과 동일한 여유로 배치 밀도를 맞춘다 */
  APPEAR: Object.freeze({ padding: 16, tolerance: 0, maxIterations: 12, extraPasses: 2 }),
  INCREMENTAL: Object.freeze({ padding: 6, tolerance: 3, maxIterations: 4, extraPasses: 1 }),
  RESIZE: Object.freeze({ padding: 5, tolerance: 3, maxIterations: 2, extraPasses: 0 }),
  /** 사용자 드래그: 본체 겹침 즉시 반응, 드래그 노드는 movableIds에서 제외해 자유 배치 유지 */
  USER_DRAG: Object.freeze({
    padding: 10,
    tolerance: 0,
    maxIterations: 8,
    extraPasses: 1,
    pushExtra: 2,
    severeOverlap: 1,
  }),
});

function collectNearbyPairIndexes(nodePositions, padding) {
  const maxRadius = nodePositions.reduce((max, item) => Math.max(max, item.radius), 1);
  const cellSize = Math.max(1, maxRadius * 2 + padding);
  const buckets = new Map();
  nodePositions.forEach((item, index) => {
    const x = Math.floor(item.pos.x / cellSize);
    const y = Math.floor(item.pos.y / cellSize);
    const key = `${x}:${y}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  });

  const pairs = [];
  nodePositions.forEach((item, i) => {
    const x = Math.floor(item.pos.x / cellSize);
    const y = Math.floor(item.pos.y / cellSize);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        const candidates = buckets.get(`${x + dx}:${y + dy}`) || [];
        for (const j of candidates) {
          if (j <= i) continue;
          pairs.push([i, j]);
        }
      }
    }
  });
  return pairs;
}

function pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance = 0) {
  const pairs = collectNearbyPairIndexes(nodePositions, padding);
  for (const [i, j] of pairs) {
      const a = nodePositions[i];
      const b = nodePositions[j];
      const aMovable = !movableIdSet || movableIdSet.has(a.id);
      const bMovable = !movableIdSet || movableIdSet.has(b.id);
      if (!aMovable && !bMovable) continue;
      const minDistance = Math.max(0, a.radius + b.radius - tolerance);
      const dx = a.pos.x - b.pos.x;
      const dy = a.pos.y - b.pos.y;
      if (dx * dx + dy * dy < minDistance * minDistance) return true;
  }
  return false;
}

function runOverlapPushPasses(
  nodePositions,
  movableIdSet,
  padding,
  pushExtra,
  maxIterations,
  tolerance,
  severeOverlap,
) {
  let hasOverlap = false;
  for (let iter = 0; iter < maxIterations; iter += 1) {
    let movedThisPass = false;

    const pairs = collectNearbyPairIndexes(nodePositions, padding);
    for (const [i, j] of pairs) {
        const { node: node1, id: id1, pos: pos1, radius: r1 } = nodePositions[i];
        const { node: node2, id: id2, pos: pos2, radius: r2 } = nodePositions[j];

        const node1Movable = !movableIdSet || movableIdSet.has(id1);
        const node2Movable = !movableIdSet || movableIdSet.has(id2);
        if (!node1Movable && !node2Movable) continue;

        const bodyDistance = r1 + r2;
        const activationDistance = Math.max(0, bodyDistance - tolerance);
        const dx = pos1.x - pos2.x;
        const dy = pos1.y - pos2.y;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared >= activationDistance * activationDistance) continue;

        hasOverlap = true;
        movedThisPass = true;
        const distance = Math.sqrt(distanceSquared);
        const penetration = bodyDistance - distance;
        const severe = penetration >= severeOverlap;
        const targetGap = severe ? padding : Math.min(padding, 2);
        const targetSeparation = bodyDistance + targetGap + (severe ? pushExtra : 0);
        const angle =
          distance < 1e-6
            ? (i + j) * 0.7
            : Math.atan2(dy, dx);
        const pushDistance = targetSeparation - distance;
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
            x: pos2.x + cos * targetSeparation,
            y: pos2.y + sin * targetSeparation,
          };
          node1.position(newPos1);
          nodePositions[i].pos = newPos1;
        } else {
          const newPos2 = {
            x: pos1.x - cos * targetSeparation,
            y: pos1.y - sin * targetSeparation,
          };
          node2.position(newPos2);
          nodePositions[j].pos = newPos2;
        }
    }

    if (!movedThisPass) break;
  }
  return hasOverlap;
}

/** 숫자 옵션: allowZero면 >= 0, 아니면 > 0 일 때만 채택 */
const numOpt = (value, fallback, allowZero = true) =>
  typeof value === 'number' && (allowZero ? value >= 0 : value > 0) ? value : fallback;

function parseOverlapOptions(nodeSize, options = {}) {
  const movableIdSet = options.movableIds
    ? new Set([...options.movableIds].map(String).filter((id) => id !== ''))
    : null;
  return {
    nodeSize: numOpt(nodeSize, OVERLAP_RESOLVE.FALLBACK_NODE_SIZE, false),
    movableIdSet,
    padding: numOpt(options.padding, OVERLAP_RESOLVE.PADDING),
    tolerance: numOpt(options.tolerance, OVERLAP_RESOLVE.OVERLAP_TOLERANCE),
    pushExtra: numOpt(options.pushExtra, OVERLAP_RESOLVE.PUSH_EXTRA),
    severeOverlap: numOpt(options.severeOverlap, OVERLAP_RESOLVE.SEVERE_OVERLAP, false),
    maxIterations: numOpt(
      options.maxIterations,
      movableIdSet ? OVERLAP_RESOLVE.MAX_ITERATIONS : OVERLAP_RESOLVE.MAX_ITERATIONS_LIGHT,
      false,
    ),
    extraPasses: numOpt(options.extraPasses, OVERLAP_RESOLVE.EXTRA_PASSES),
  };
}

function buildOverlapNodePositions(cy, nodeSize) {
  // spatial hash로 O(n) 검사라 노드 수 상한 없이 전량 대상
  let nodes = cy.nodes(':visible').toArray();
  if (nodes.length === 0) nodes = cy.nodes().toArray();
  if (nodes.length < 2) return null;
  return nodes.map((node) => ({
    node,
    id: String(node.id()),
    pos: node.position(),
    radius: readNodeRadius(node, nodeSize),
  }));
}

/**
 * 노드 겹침 감지 및 자동 조정
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {number} [nodeSize=OVERLAP_RESOLVE.FALLBACK_NODE_SIZE] - 크기 읽기 실패 시 fallback (지름)
 * @param {Object} [options]
 * @param {Iterable<string>|null} [options.movableIds] - 지정 시 해당 노드만 이동(기존 노드 위치 유지)
 * @param {number} [options.maxIterations] - 밀어내기 반복 횟수
 * @param {number} [options.extraPasses] - 잔여 겹침 시 추가 반복
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

  const {
    nodeSize: size,
    movableIdSet,
    padding,
    tolerance,
    pushExtra,
    severeOverlap,
    maxIterations,
    extraPasses,
  } = parseOverlapOptions(nodeSize, options);
  if (movableIdSet && movableIdSet.size === 0) {
    return false;
  }

  const nodePositions = buildOverlapNodePositions(cy, size);
  if (!nodePositions) {
    return false;
  }

  let hasOverlap = false;
  const runPasses = (iterations) =>
    runOverlapPushPasses(nodePositions, movableIdSet, padding, pushExtra, iterations, tolerance, severeOverlap);
  const apply = () => {
    hasOverlap = runPasses(maxIterations) || hasOverlap;
    if (pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance) && extraPasses > 0) {
      hasOverlap = runPasses(extraPasses) || hasOverlap;
    }
  };

  if (typeof cy.batch === 'function') {
    cy.batch(apply);
  } else {
    apply();
  }

  if (
    pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance)
    && import.meta.env?.DEV
  ) {
    errorUtils.logDebug('detectAndResolveOverlap', 'residual overlaps remain', {
      candidates: nodePositions.length,
    });
  }

  return hasOverlap;
}

/**
 * movableIds가 있으면 그중 하나 이상 포함된 쌍만 검사.
 * @returns {boolean} 겹치는 쌍이 있으면 true
 */
export function hasOverlappingNodes(
  cy,
  nodeSize = OVERLAP_RESOLVE.FALLBACK_NODE_SIZE,
  options = {},
) {
  if (!cy) return false;
  const { movableIdSet, padding, tolerance, nodeSize: size } = parseOverlapOptions(nodeSize, options);
  if (movableIdSet && movableIdSet.size === 0) return false;

  const nodePositions = buildOverlapNodePositions(cy, size);
  if (!nodePositions) return false;
  return pairStillOverlaps(nodePositions, movableIdSet, padding, tolerance);
}

/** seedIds 기준 undirected N-hop 이웃(시드 포함) */
export function collectNeighborhoodNodeIds(cy, seedIds, hops = 1) {
  const seeds = [...(seedIds || [])].map(String).filter(Boolean);
  const all = new Set(seeds);
  if (!cy || hops < 1 || seeds.length === 0) return all;

  let frontier = new Set(seeds);
  for (let h = 0; h < hops; h += 1) {
    const next = new Set();
    for (const id of frontier) {
      const node = cy.getElementById(id);
      if (!node || node.length === 0) continue;
      try {
        node.neighborhood('node').forEach((n) => {
          const nid = String(n.id());
          if (!all.has(nid)) {
            all.add(nid);
            next.add(nid);
          }
        });
      } catch {
        /* ignore */
      }
    }
    if (next.size === 0) break;
    frontier = next;
  }
  return all;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. Chapter cache payload / reconstruct / book summary
 * ═══════════════════════════════════════════════════════════════════════════ */

const cloneArray = (arr) => (Array.isArray(arr) ? arr.map((item) => structuredClone(item)) : []);

const computeCharacterDiff = (prevCharacters, nextCharacters) => {
  const prevMap = new Map();
  const nextMap = new Map();
  asArray(prevCharacters).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) prevMap.set(id, character);
  });
  asArray(nextCharacters).forEach((character) => {
    const id = extractCharacterId(character);
    if (id) nextMap.set(id, character);
  });
  const added = [];
  const updated = [];
  const removedIds = [];
  nextMap.forEach((character, id) => {
    const prev = prevMap.get(id);
    if (!prev) added.push(structuredClone(character));
    else if (!deepEqual(prev, character)) updated.push(structuredClone(character));
  });
  prevMap.forEach((_character, id) => {
    if (!nextMap.has(id)) removedIds.push(id);
  });
  return { added, updated, removedIds };
};

const toKeyedMap = (items, getKey) => {
  const map = new Map();
  for (const item of asArray(items)) {
    const id = getKey(item);
    if (id) map.set(id, item);
  }
  return map;
};

/**
 * remove → update → add 를 map에 제자리 반영. 항목은 복제하지 않고 참조 공유.
 * Map.set은 기존 key 위치를 유지하므로 매 diff마다 배열에서 Map을 다시 만든 것과 순서가 같음.
 */
const applyKeyedDiffInPlace = (map, diff, getKey) => {
  const put = (item) => {
    const id = getKey(item);
    if (id) map.set(id, item);
  };
  (diff?.removedIds || []).forEach((id) => id && map.delete(String(id)));
  (diff?.updated || []).forEach(put);
  (diff?.added || []).forEach(put);
};

/** 노드 먼저, 그다음 id 순 (Map key가 곧 id) */
const sortedElementsOf = (elementMap) => {
  const rows = Array.from(elementMap, ([id, el]) => ({ id, el, isEdge: Boolean(el?.data?.source) }));
  rows.sort((a, b) => {
    if (a.isEdge !== b.isEdge) return a.isEdge ? 1 : -1;
    return compareLocale(a.id, b.id);
  });
  return rows.map((row) => row.el);
};

/** 이벤트 1건 → elements/characters/summary (캐시 payload 루프용) */
function buildEventSnapshotRow(bookId, chapterIdx, event) {
  const inner = event.event ?? null;
  const relations = asArray(event.relations);
  let convertedElements = [];
  let snapshotCharacters = [];
  try {
    const built = buildElementsFromGraphPayload({
      characters: asArray(event.characters),
      relations,
      eventData: inner,
      bookId,
    });
    convertedElements = built.elements;
    snapshotCharacters = built.characters;
  } catch (error) {
    errorUtils.logError('buildElementsFromGraphPayload', error);
  }

  const summaryIdx = Number(event.eventIdx) || 0;
  const summary = {
    bookId,
    chapterIdx,
    eventIdx: summaryIdx,
    eventNum: toPositiveNumberOrNull(event.eventNum) ?? summaryIdx,
    eventId: eventUtils.resolveEventId(event) ?? eventUtils.resolveEventId(inner) ?? null,
    startTxtOffset: event.startTxtOffset ?? null,
    endTxtOffset: event.endTxtOffset ?? null,
    title: inner?.name ?? inner?.title ?? inner?.eventName ?? null,
    text: inner?.text ?? null,
    hasCharacters: snapshotCharacters.length > 0,
    hasRelations: relations.length > 0,
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

    // 이벤트 객체는 normalizeEventFromDeltasGraphResult에서 한 번 복제된 뒤 변경되지 않음 — 여기선 참조 공유
    const currentElements = convertedElements;
    const currentCharacters = snapshotCharacters;
    if (index === 0) {
      baseSnapshot = {
        eventIdx: eventUtils.resolveEventNum(event) || 1,
        elements: currentElements,
        characters: currentCharacters,
        eventMeta: event?.event ? structuredClone(event.event) : null,
      };
    } else {
      // diff 항목은 currentElements를 그대로 참조 (읽기 전용)
      const { added, updated, removed } = calcGraphDiff(prevElements, currentElements);
      diffs.push({
        eventIdx: eventUtils.resolveEventNum(event) || (baseSnapshot?.eventIdx ?? 1),
        eventMeta: event?.event ? structuredClone(event.event) : null,
        elementDiff: {
          added,
          updated,
          removedIds: removed.map((element) => normalizeElementId(element)).filter(Boolean),
        },
        characterDiff: computeCharacterDiff(prevCharacters, currentCharacters),
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
    events: eventSummaries,
    baseSnapshot,
    diffs,
    timestamp,
    source,
    // sortEventsByIdx가 새 배열을 반환 — 항목은 불변이라 복제하지 않음
    rawEvents: sortedEvents,
  };
};

/**
 * baseSnapshot + diffs → 시점별 그래프 상태를 돌려주는 조회 함수.
 * 오름차순으로 조회하면 diff를 한 번만 순회 (이벤트마다 처음부터 재생하면 O(k²)).
 * 내림차순 조회는 base부터 다시 재생 — 결과는 같고 느릴 뿐. 반환값은 매번 독립 복제본.
 * diff는 Map에 O(Δ)로 반영하고, 배열 변환·정렬은 조회 시 1회 (diff마다 O(N log N) 하지 않음).
 * readOnly: 반환값을 읽기만 할 때 복제 생략 (캐시 항목을 그대로 노출 — 변경 금지)
 * sortElements=false: elements를 정렬하지 않고 Map 순서로 (순서 무관한 조회용, readOnly 전용)
 */
export const createChapterGraphStateCursor = (
  cachePayload,
  { readOnly = false, sortElements = true } = {}
) => {
  const baseSnapshot = cachePayload?.baseSnapshot;
  if (!baseSnapshot || !Array.isArray(baseSnapshot.elements)) return () => null;

  const baseIdx = Number(baseSnapshot.eventIdx) || 1;
  // diffs는 eventIdx 오름차순으로 생성됨 — 정렬 키와 비교 키가 같아 break로 끊어도 결과 동일
  const diffs = eventUtils.sortEventsByIdx(cachePayload.diffs || []);
  // null이면 diff 미적용 — base 배열을 그대로 사용
  let elementMap;
  let characterMap;
  let eventMeta;
  let appliedEventIdx;
  let nextDiff;
  // 마지막 diff 적용 이후 만든 출력 배열 (다음 diff 전까지 재사용, 반환 후 변경하지 않음)
  let outElements;
  let outCharacters;
  const reset = () => {
    elementMap = null;
    characterMap = null;
    eventMeta = baseSnapshot.eventMeta ?? null;
    appliedEventIdx = baseIdx;
    nextDiff = 0;
    outElements = null;
    outCharacters = null;
  };
  reset();
  let lastTarget = -Infinity;

  const snapshot = (els, chars, meta, eventIdx) =>
    readOnly
      ? { elements: els, characters: chars, eventMeta: meta ?? null, eventIdx }
      : {
          elements: cloneArray(els),
          characters: cloneArray(chars),
          eventMeta: meta ? structuredClone(meta) : null,
          eventIdx,
        };

  return (targetEventIdx) => {
    const target = Number(targetEventIdx);
    // partial(through만 적재)은 base 이전 이벤트가 없음 — base를 돌려주면 이후 관계가 노출됨
    if (cachePayload.partial && target < baseIdx) return null;
    if (!Number.isFinite(target) || target <= baseIdx) {
      return snapshot(baseSnapshot.elements, baseSnapshot.characters || [], baseSnapshot.eventMeta, baseIdx);
    }

    if (target < lastTarget) reset();
    lastTarget = target;
    for (; nextDiff < diffs.length; nextDiff += 1) {
      const diff = diffs[nextDiff];
      const diffIdx = Number(diff?.eventIdx);
      if (!Number.isFinite(diffIdx)) continue;
      if (diffIdx > target) break;
      if (!elementMap) {
        elementMap = toKeyedMap(baseSnapshot.elements, normalizeElementId);
        characterMap = toKeyedMap(baseSnapshot.characters, extractCharacterId);
      }
      applyKeyedDiffInPlace(elementMap, diff?.elementDiff, normalizeElementId);
      applyKeyedDiffInPlace(characterMap, diff?.characterDiff, extractCharacterId);
      if (diff?.eventMeta) eventMeta = diff.eventMeta;
      appliedEventIdx = diffIdx;
      outElements = null;
      outCharacters = null;
    }
    if (!elementMap) {
      return snapshot(baseSnapshot.elements, baseSnapshot.characters || [], eventMeta, appliedEventIdx);
    }
    outElements ??=
      sortElements || !readOnly ? sortedElementsOf(elementMap) : Array.from(elementMap.values());
    outCharacters ??= Array.from(characterMap.values());
    return snapshot(outElements, outCharacters, eventMeta, appliedEventIdx);
  };
};

/** 단건 조회. 여러 시점을 볼 때는 createChapterGraphStateCursor 사용 */
export const reconstructChapterGraphState = (cachePayload, targetEventIdx) => {
  if (!cachePayload || typeof cachePayload !== 'object') return null;
  return createChapterGraphStateCursor(cachePayload)(targetEventIdx);
};

const graphBookMemoryCache = new Map();
const GRAPH_BOOK_MEMORY_MAX = 50;

const chapterEventMemoryCache = new Map();
const CHAPTER_EVENT_MEMORY_MAX = 30;

const graphBuildPromises = new Map();
const chapterDiscoverPromises = new Map();

const getChapterDiscoverKey = (bookId, chapterIdx) => `${bookId}-${chapterIdx}`;

const getGraphBookCacheKey = (bookId) => {
  const numeric = toPositiveNumberOrNull(bookId);
  if (numeric === null) return null;
  return `${GRAPH_BOOK_CACHE_PREFIX}${numeric}`;
};

/**
 * 메모리 우선 → localStorage(TTL) 순 조회, 스토리지 적중 시 메모리 재적재.
 * 메모리 우선: discover 폴링이 매 tick 전체 JSON을 파싱하지 않도록, 스토리지 저장 실패 시에도 표시 가능하도록
 */
const readTtlCache = (memoryCache, maxSize, key, label) => {
  if (!key) return null;
  try {
    const cached = memoryCache.get(key);
    if (cached && Date.now() - (Number(cached.timestamp) || 0) <= CHAPTER_EVENT_CACHE_MAX_AGE_MS) {
      return cached;
    }
    const stored = loadTtlStorage(key, CHAPTER_EVENT_CACHE_MAX_AGE_MS, 'localStorage');
    if (stored) setBounded(memoryCache, key, stored, maxSize);
    return stored;
  } catch (error) {
    errorUtils.logDebug('graphModel', `${label} 로드 실패`, { message: error?.message });
    return null;
  }
};

// 챕터 캐시와 같은 TTL — 챕터 캐시 만료 후에도 prewarm이 영구 생략되지 않도록
const readGraphBookCache = (bookId) =>
  readTtlCache(graphBookMemoryCache, GRAPH_BOOK_MEMORY_MAX, getGraphBookCacheKey(bookId), '그래프 책 캐시');

const writeGraphBookCache = (bookId, payload) => {
  const key = getGraphBookCacheKey(bookId);
  if (!key) return null;

  const normalized = {
    ...payload,
    bookId: Number(bookId),
    builtAt: payload?.builtAt ?? Date.now(),
    timestamp: Date.now(),
  };

  setBounded(graphBookMemoryCache, key, normalized, GRAPH_BOOK_MEMORY_MAX);
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

  // 공유 빌드는 합류한 모든 호출자가 abort했을 때만 중단 (signal 없는 호출자가 있으면 계속)
  const inflight = graphBuildPromises.get(numericId);
  if (inflight) {
    inflight.signals.push(signal ?? null);
    return inflight.promise;
  }

  const signals = [signal ?? null];
  const buildPromise = (async () => {
    await getBookManifest(numericId, { forceRefresh: false });
    const manifest = getManifestFromCache(numericId);

    const chapters = Array.isArray(manifest?.chapters) ? manifest.chapters : [];

    const normalizedChapterIndices = [...new Set(
      chapters
        .map((chapter) => toNumberOrNull(chapter?.idx))
        .filter((v) => v != null && v > 0)
    )].sort((a, b) => a - b);

    const chapterSummaries = [];
    let hasFailedChapter = false;

    for (const chapterIdx of normalizedChapterIndices) {
      if (signals.every((s) => s?.aborted)) {
        throw new DOMException('Aborted', 'AbortError');
      }

      let chapterCache = getCachedChapterEvents(numericId, chapterIdx);
      if (!chapterCache || chapterCache.partial || chapterCache.capped) {
        try {
          chapterCache = await discoverChapterEvents(numericId, chapterIdx, false);
        } catch (error) {
          if (error?.name === 'AbortError') throw error;
          // 실패 챕터는 요약에서 제외
          chapterCache = null;
          hasFailedChapter = true;
        }
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

    const summary = {
      bookId: numericId,
      chapters: chapterSummaries,
      maxChapter: calculateMaxChapterFromChapters(chapters),
      builtAt: Date.now(),
    };
    // 실패 챕터가 있으면 캐시하지 않음 — TTL 동안 재시도가 막히지 않도록
    return hasFailedChapter ? summary : writeGraphBookCache(numericId, summary);
  })();

  return awaitTracked(graphBuildPromises, numericId, buildPromise, { promise: buildPromise, signals });
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
  const resolvedChapterIdx = resolveChapterIndex(safe) ?? chapterIdx;
  // walker event는 { eventId, chapterIndex }뿐 — ordinal을 뽑으면 eventId 끝자리 숫자가 되므로 캐시 키(eventIdx) 기준 유지
  const resolvedEventNum =
    Number(manifestStructure?.eventNum ?? manifestStructure?.eventIdx ?? eventIdx) || eventIdx;
  const resolvedEventId =
    safe.eventId ??
    eventUtils.resolveEventId(nestedEvent) ??
    manifestStructure?.eventId ??
    null;
  const startTxtOffset = nestedEvent?.startTxtOffset ?? manifestStructure?.startTxtOffset ?? null;
  const endTxtOffset = nestedEvent?.endTxtOffset ?? manifestStructure?.endTxtOffset ?? null;

  return {
    bookId: Number(safe.bookId) || bookId,
    chapterIdx: resolvedChapterIdx,
    eventIdx,
    eventNum: resolvedEventNum,
    characters: hasCharacters ? characters.map((character) => structuredClone(character)) : [],
    relations: hasRelations ? relations.map((relation) => structuredClone(relation)) : [],
    event: {
      idx: eventIdx,
      chapterIdx: resolvedChapterIdx,
      chapterIndex: resolvedChapterIdx,
      eventId: resolvedEventId ?? eventIdx,
      startTxtOffset,
      endTxtOffset,
      startLocator: nestedEvent?.startLocator,
      endLocator: nestedEvent?.endLocator,
      rawText: nestedEvent?.rawText ?? null,
      ...(nestedEvent && typeof nestedEvent === 'object' ? nestedEvent : {}),
      eventNum: resolvedEventNum,
    },
    startTxtOffset,
    endTxtOffset,
    eventId: resolvedEventId,
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
export const getCachedChapterEvents = (bookId, chapterIdx) =>
  readTtlCache(chapterEventMemoryCache, CHAPTER_EVENT_MEMORY_MAX, getChapterEventCacheKey(bookId, chapterIdx), '챕터 이벤트 캐시');

const setCachedChapterEvents = (bookId, chapterIdx, eventData) => {
  try {
    if (!eventData) return false;
    const cacheKey = getChapterEventCacheKey(bookId, chapterIdx);
    if (!cacheKey) return false;

    const cacheData = {
      bookId,
      chapterIdx,
      maxEventIdx: Number(eventData.maxEventIdx) || 0,
      events: asArray(eventData.events),
      baseSnapshot: eventData.baseSnapshot ?? null,
      diffs: asArray(eventData.diffs),
      rawEvents: asArray(eventData.rawEvents),
      timestamp: Number(eventData.timestamp) || Date.now(),
      source: eventData.source || null,
      partial: eventData.partial === true,
      capped: eventData.capped === true,
    };

    setBounded(chapterEventMemoryCache, cacheKey, cacheData, CHAPTER_EVENT_MEMORY_MAX);
    // rawEvents(이벤트별 누적 스냅샷 전체)는 discover 이어받기용 메모리 전용 — 스토리지에 넣으면 용량 초과로 저장 자체가 실패함
    const { rawEvents: _rawEvents, ...storedData } = cacheData;
    if (!saveToStorage(cacheKey, storedData, 'localStorage')) {
      // 용량 초과 등: 이전 세션의 낡은 항목이 남아 다음 로드에 쓰이지 않도록 제거 (현재 세션은 메모리로 표시)
      removeFromStorage(cacheKey, 'localStorage');
    }
    return true;
  } catch (error) {
    errorUtils.logDebug('graphModel', '챕터 이벤트 캐시 저장 실패', { message: error?.message });
    return false;
  }
};

export function getCachedChapterMaxEventIdx(bookId, chapter) {
  return Number(getCachedChapterEvents(bookId, chapter)?.maxEventIdx) || 0;
}

/* ─── 챕터 캐시 → events state (뷰어·툴팁 조회용) ─── */

/**
 * readOnly cursor 결과 → 외부로 나가는 payload. relations는 변환 시 새 객체(relation 배열도 복사)라
 * elements는 복제할 필요 없음 — 캐시와 공유되는 characters만 복제
 */
const graphPayloadFromReconstructed = (reconstructed) => ({
  characters: cloneArray(reconstructed?.characters),
  relations: eventUtils.convertElementsToRelations(
    asArray(reconstructed?.elements),
    ELEMENTS_TO_RELATIONS_OPTS
  ),
});

const isLegacyRawEventRow = (event) =>
  Boolean(
    (event?.event && typeof event.event === 'object') ||
    Array.isArray(event?.relations) ||
    Array.isArray(event?.characters)
  );

const withEventTitleAliases = (title) => {
  const t = title ?? null;
  return { title: t, name: t, eventName: t };
};

const withEventOffsetFields = (start, end, { alsoTxtOffset = false } = {}) => {
  const s = start ?? null;
  const e = end ?? null;
  return alsoTxtOffset
    ? { startTxtOffset: s, endTxtOffset: e, start: s, end: e }
    : { start: s, end: e };
};

function baseChapterEventFields(targetChapter, eventIdx, eventNum, eventId) {
  return {
    chapter: targetChapter,
    chapterIdx: targetChapter,
    eventIdx,
    eventNum,
    eventId,
  };
}

const mapLegacyOrSummaryEvent = (event, targetChapter) => {
  const eventIdx = eventUtils.resolveEventNum(event, null);
  if (eventIdx == null || eventIdx <= 0) return null;

  const eventNum = toPositiveInt(event.eventNum, eventIdx);
  const eventId = eventUtils.resolveEventId(event) ?? event.eventId ?? eventIdx;
  const base = baseChapterEventFields(targetChapter, eventIdx, eventNum, eventId);

  if (isLegacyRawEventRow(event)) {
    return {
      ...(event.event && typeof event.event === 'object' ? event.event : {}),
      ...event,
      ...base,
      relations: asArray(event.relations),
      characters: asArray(event.characters),
      ...withEventOffsetFields(
        event?.startPos ?? event?.start ?? event?.startTxtOffset,
        event?.endPos ?? event?.end ?? event?.endTxtOffset
      ),
    };
  }

  return {
    ...base,
    ...withEventOffsetFields(event.startTxtOffset, event.endTxtOffset, { alsoTxtOffset: true }),
    ...withEventTitleAliases(event.title ?? null),
    text: event.text ?? null,
    relations: [],
    characters: [],
  };
};

function buildEventsFromChapterCache(chapterPayload, targetChapter, throughEventIdx = null) {
  if (!chapterPayload?.events?.length) return [];

  const hasDiffCache = chapterPayload.baseSnapshot && Array.isArray(chapterPayload.diffs);
  const through = Number(throughEventIdx);
  const eventMetas = Number.isFinite(through) && through > 0
    ? chapterPayload.events.filter((event) => {
        const idx = Number(event?.eventIdx) || 0;
        return idx > 0 && idx <= through;
      })
    : chapterPayload.events;

  if (!hasDiffCache) {
    return eventMetas.map((event) => mapLegacyOrSummaryEvent(event, targetChapter)).filter(Boolean);
  }

  // 이벤트마다 그래프 전체를 복제하지 않음 — 밖으로 나가는 값만 graphPayloadFromReconstructed·eventMeta에서 복제
  const stateAt = createChapterGraphStateCursor(chapterPayload, { readOnly: true });
  return eventMetas.map((eventMeta) => {
    const eventIdx = Number(eventMeta?.eventIdx) || 0;
    const eventNum = toPositiveInt(eventMeta?.eventNum, eventIdx);
    const reconstructed = stateAt(eventIdx);
    const { characters, relations } = graphPayloadFromReconstructed(reconstructed);
    const reconstructedMeta = reconstructed?.eventMeta ? structuredClone(reconstructed.eventMeta) : null;
    const title = eventMeta.title ?? reconstructedMeta?.name ?? reconstructedMeta?.title ?? null;

    return {
      ...eventMeta,
      ...baseChapterEventFields(targetChapter, eventIdx, eventNum, (
        eventUtils.resolveEventId(reconstructedMeta) ??
        eventUtils.resolveEventId(eventMeta) ??
        eventIdx
      )),
      event: reconstructedMeta ?? eventMeta?.event ?? null,
      ...withEventTitleAliases(title),
      relations,
      characters,
      ...withEventOffsetFields(
        eventMeta.startTxtOffset ?? reconstructedMeta?.startTxtOffset,
        eventMeta.endTxtOffset ?? reconstructedMeta?.endTxtOffset
      ),
    };
  });
}

/** diff 캐시 행의 표시 순번 — buildEventsFromChapterCache 결과의 eventNum과 같은 규칙 */
const diffCacheRowEventNum = (eventMeta) =>
  toPositiveInt(eventMeta?.eventNum, Number(eventMeta?.eventIdx) || 0);

function getEventsForChapter(chapter, folderKey, eventIndex) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) return [];

  const snapshot = getCachedChapterEvents(bookId, chapter);
  if (!snapshot?.events?.length || isUnusableChapterGraphCacheSource(snapshot.source)) {
    return [];
  }

  // 한 건만 필요하면 그 이벤트만 재구성 (전체 재구성 후 find 하지 않음).
  // 순번이 없는 행은 재구성 후 eventId로 매칭될 수 있으므로 남김
  const hasDiffCache = snapshot.baseSnapshot && Array.isArray(snapshot.diffs);
  const scoped = hasDiffCache
    ? {
        ...snapshot,
        events: snapshot.events.filter((meta) => {
          const num = diffCacheRowEventNum(meta);
          return !num || num === eventIndex;
        }),
      }
    : snapshot;
  return buildEventsFromChapterCache(scoped, chapter);
}

export function getEventDataByIndex(folderKey, chapter, eventIndex) {
  const bookId = extractApiBookId(folderKey);
  if (!bookId || !chapter || chapter < 1 || !eventIndex || eventIndex < 1) {
    return null;
  }

  const events = getEventsForChapter(chapter, folderKey, toNumberOrNull(eventIndex));
  if (!events.length) {
    return null;
  }

  const event = events.find(
    (entry) => eventUtils.resolveEventNum(entry) === toNumberOrNull(eventIndex)
  );
  if (!event) {
    return null;
  }

  const resolvedEventIdx = eventUtils.resolveEventNum(event) || Number(eventIndex);
  return {
    ...baseChapterEventFields(chapter, resolvedEventIdx, resolvedEventIdx, (
      eventUtils.resolveEventId(event) ?? resolvedEventIdx
    )),
    relations: asArray(event.relations),
    characters: asArray(event.characters),
    event: event.event || null,
  };
}

/** 챕터 이벤트 캐시 → events state에 병합 (React setState용) */
export function applyChapterEventsFromCache(
  prevEvents,
  bookId,
  targetChapter,
  throughEventIdx = null
) {
  const chapterPayload = getCachedChapterEvents(bookId, targetChapter);
  if (!chapterPayload?.events) {
    return { applied: false, hasPayload: false, isEmpty: false, events: prevEvents };
  }
  if (!chapterPayload.events.length) {
    return { applied: false, hasPayload: true, isEmpty: true, events: prevEvents };
  }

  const enrichedEvents = buildEventsFromChapterCache(chapterPayload, targetChapter, throughEventIdx);
  if (!enrichedEvents.length) {
    return { applied: false, hasPayload: true, isEmpty: false, events: prevEvents };
  }

  const events = eventUtils.mergeEventsInState(prevEvents, enrichedEvents, targetChapter);
  return { applied: true, hasPayload: true, isEmpty: false, events };
}

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
        const eventNum = toPositiveNumberOrNull(rawEvent.eventNum) ?? eventIdx;
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
    errorUtils.logDebug('graphModel', 'manifest 이벤트 구조 로드 실패', { message: error?.message });
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

/** partial=true: through 이벤트만 적재된 상태 (백필 전) */
/** capped=true: maxEventIdx 이후 이벤트를 의도적으로 생략한 prefix 캐시 (prefetch) */
function publishChapterPartialCache(bookId, chapterIdx, apiEvents, onPartialCache, partial = false, capped = false) {
  if (!apiEvents.length) return null;
  const payload = {
    ...buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API),
    partial,
    capped,
  };
  setCachedChapterEvents(bookId, chapterIdx, payload);
  if (typeof onPartialCache === 'function') {
    try {
      onPartialCache(payload);
    } catch (error) {
      errorUtils.logDebug('graphModel', 'onPartialCache 콜백 실패', { message: error?.message });
    }
  }
  return payload;
}

function appendSnapshotEventToContext(ctx, eventIdx, manifestStructure, snapshot) {
  ctx.apiEvents.push(
    normalizeEventFromDeltasGraphResult(ctx.bookId, ctx.chapterIdx, eventIdx, snapshot, manifestStructure)
  );
  ctx.fetchedEventIdxSet.add(eventIdx);
}

/** apiEvents에서 eventIdx 직전 이벤트 O(n) 스캔 (Phase 1 through 선적재로 순서 무보장) */
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

/** 매크로태스크로 양보 — 마이크로태스크(Promise.resolve)로는 렌더·타이머가 끼어들지 못함 */
const yieldToMainThread = () => sleep(0);

/** 정렬된 deltas → 이벤트 스냅샷 증분 적재 (through 우선 + 백필) */
async function appendEventsFromSortedDeltas(ctx, sourceBookId, sortedDeltas, eventEntries, chapterEventIdOrder) {
  if (!eventEntries.length) return;

  const { chapterIdx, fetchedEventIdxSet, apiEvents, onPartialCache } = ctx;
  const walkerOpts = { chapterIndex: chapterIdx, chapterEventIdOrder };
  const lastEntry = eventEntries[eventEntries.length - 1];
  let publishedPartial = false;

  // Phase 1: through 이벤트 우선
  if (lastEntry?.eventId && !fetchedEventIdxSet.has(lastEntry.eventIdx)) {
    const throughWalker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
    appendSnapshotEventToContext(
      ctx,
      lastEntry.eventIdx,
      lastEntry.structure,
      throughWalker.snapshotThrough(lastEntry.eventId)
    );
    publishChapterPartialCache(ctx.bookId, chapterIdx, apiEvents, onPartialCache, true, ctx.capped);
    publishedPartial = true;
    // through 결과를 먼저 그리고 ensureChapterEventsDiscovered가 반환할 틈을 줌
    await yieldToMainThread();
  }

  // Phase 2: 전체 구간 백필
  const walker = createDeltaAccumulateWalker(sourceBookId, sortedDeltas, walkerOpts);
  let appended = 0;
  for (let i = 0; i < eventEntries.length; i += 1) {
    const { eventIdx, eventId, structure } = eventEntries[i];

    // 이미 캐시에 있으면 finalize(비김) 생략하고 누적 커서만 전진
    if (fetchedEventIdxSet.has(eventIdx)) {
      if (eventId) walker.advanceThrough(eventId);
      if (i > 0 && i % 16 === 0) await yieldToMainThread();
      continue;
    }

    let snapshot;
    if (!eventId) {
      const prev = findPreviousApiEventBeforeIdx(apiEvents, eventIdx);
      snapshot = {
        bookId: sourceBookId,
        chapterIndex: chapterIdx,
        eventId: null,
        // normalizeEventFromDeltasGraphResult가 복제하므로 여기선 참조만 넘김
        characters: Array.isArray(prev?.characters) ? prev.characters : [],
        relations: Array.isArray(prev?.relations) ? prev.relations : [],
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

    if (i > 0 && i % 8 === 0) await yieldToMainThread();
  }
  // 백필할 게 없었어도 Phase 1의 partial 표시는 해제해야 함
  if (appended > 0 || publishedPartial) {
    ctx.finalPayload = publishChapterPartialCache(ctx.bookId, chapterIdx, apiEvents, onPartialCache, false, ctx.capped);
  }
}

/** 1회 deltas fetch 후 증분 누적 */
async function collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap) {
  if (!indicesToFetch.length) return;

  const { bookId, chapterIdx } = ctx;
  // 실패는 삼키지 않음 — 삼키면 discoverWithoutManifest가 같은 요청을 반복하고 api_error가 cache_missing으로 바뀜
  const fetched = await ensureBookRelationshipDeltas(bookId, {
    chapterIndex: chapterIdx,
  });

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
  const fetched = await ensureBookRelationshipDeltas(bookId, {
    chapterIndex: chapterIdx,
  });
  const deltas = Array.isArray(fetched?.deltas) ? fetched.deltas : [];
  if (!deltas.length) return;

  const sortedDeltas = sortDeltasForAccumulate(deltas);
  const seenIds = new Set();
  for (const delta of sortedDeltas) {
    const eventId = typeof delta?.eventId === 'string' ? delta.eventId.trim() : '';
    if (!eventId || seenIds.has(eventId)) continue;
    // 해당 챕터 delta만 (chapterIndex가 있으면 필터)
    const deltaChapter = Number(delta?.chapterIndex);
    if (Number.isFinite(deltaChapter) && deltaChapter !== chapterIdx) continue;
    seenIds.add(eventId);
  }
  const allIds = [...seenIds];
  const idsToBuild = cappedMaxEventIdx ? allIds.slice(0, cappedMaxEventIdx) : allIds;
  ctx.capped = idsToBuild.length < allIds.length;
  const eventEntries = idsToBuild.map((eventId, index) => ({
    eventIdx: index + 1,
    eventId,
    structure: { eventIdx: index + 1, eventId },
  }));
  ctx.targetIndices = eventEntries.map((entry) => entry.eventIdx);
  await appendEventsFromSortedDeltas(
    ctx,
    fetched.bookId ?? bookId,
    sortedDeltas,
    eventEntries,
    idsToBuild
  );
}

/** 비-partial 캐시가 챕터 전체이거나, cap까지 prefix가 적재됐는지 */
const isCompleteThrough = (cached, cappedMaxEventIdx) => {
  if (!cached || cached.partial || isUnusableChapterGraphCacheSource(cached.source)) return false;
  // capped 아닌 캐시는 챕터 전체 — cap이 챕터 끝을 넘어도 충족
  if (!cached.capped) return true;
  return Boolean(cappedMaxEventIdx) && (Number(cached.maxEventIdx) || 0) >= cappedMaxEventIdx;
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
    return buildChapterCachePayload(bookId, chapterIdx, [], CHAPTER_GRAPH_CACHE_SOURCE.INVALID);
  }

  if (!forceRefresh) {
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (isCompleteThrough(cached, cappedMaxEventIdx)) {
      return cached;
    }
  }

  const discoverKey = getChapterDiscoverKey(bookId, chapterIdx);
  if (!forceRefresh && chapterDiscoverPromises.has(discoverKey)) {
    await chapterDiscoverPromises.get(discoverKey);
    const cached = getCachedChapterEvents(bookId, chapterIdx);
    if (isCompleteThrough(cached, cappedMaxEventIdx)) {
      return cached;
    }
  }

  const discoverPromise = (async () => {
    const existingCache = !forceRefresh ? getCachedChapterEvents(bookId, chapterIdx) : null;
    const apiEvents = Array.isArray(existingCache?.rawEvents)
      ? [...existingCache.rawEvents] // push용 배열 복사 — 이벤트 항목은 불변
      : [];
    const fetchedEventIdxSet = new Set(
      apiEvents.map((event) => eventUtils.resolveEventNum(event) || 0).filter((idx) => idx > 0)
    );
    // 기존(partial) 캐시가 cap 뒤 이벤트를 갖고 있으면 cap을 늘려 prefix 연속성 유지
    const capThrough = cappedMaxEventIdx
      ? Math.max(cappedMaxEventIdx, ...fetchedEventIdxSet)
      : null;

    const ctx = {
      bookId,
      chapterIdx,
      apiEvents,
      fetchedEventIdxSet,
      onPartialCache,
      capped: false,
      /** appendEventsFromSortedDeltas가 최종(비-partial) 캐시를 저장했으면 그 payload */
      finalPayload: null,
      /** 이번 요청이 채워야 하는 eventIdx 목록 */
      targetIndices: null,
    };

    // 두 경로 공통 마무리. 대상 이벤트를 전부 확보했을 때만 새로 저장 —
    // deltas가 비어 기존 캐시 이벤트만 있을 때 capped 캐시를 완성본으로 덮지 않도록
    const finalizeChapterCache = () => {
      if (ctx.finalPayload) return ctx.finalPayload;
      const covered =
        ctx.targetIndices?.length > 0 &&
        ctx.targetIndices.every((idx) => fetchedEventIdxSet.has(idx));
      if (!covered) {
        return (
          getCachedChapterEvents(bookId, chapterIdx) ??
          buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API)
        );
      }
      const payload = {
        ...buildChapterCachePayload(bookId, chapterIdx, apiEvents, CHAPTER_GRAPH_CACHE_SOURCE.API),
        capped: ctx.capped,
      };
      setCachedChapterEvents(bookId, chapterIdx, payload);
      return payload;
    };

    const manifestEventStructures = loadManifestEventStructures(bookId, chapterIdx);
    const { manifestEventMap, sortedManifestIndices } = buildManifestEventIndex(manifestEventStructures);

    if (sortedManifestIndices.length > 0) {
      const indicesToFetch = capThrough
        ? sortedManifestIndices.filter((idx) => idx <= capThrough)
        : sortedManifestIndices;
      ctx.capped = indicesToFetch.length < sortedManifestIndices.length;
      ctx.targetIndices = indicesToFetch;

      await collectEventsFromDeltas(ctx, indicesToFetch, manifestEventMap);
      if (apiEvents.length > 0) return finalizeChapterCache();
    }

    await discoverWithoutManifest(ctx, capThrough);

    if (!apiEvents.length) {
      if (import.meta.env.DEV) {
        errorUtils.logDebug('graphModel', 'relationship-deltas 이벤트 없음', { chapterIdx });
      }
      // EMPTY를 캐시에 쓰지 않음 — "빈 성공" 고착 방지 (재요청 가능)
      return null;
    }

    return finalizeChapterCache();
  })().catch((error) => {
    if (import.meta.env.DEV) {
      errorUtils.logDebug('graphModel', '챕터 이벤트 discover 실패', { chapterIdx, message: error?.message || String(error) });
    }
    throw error;
  });

  return awaitTracked(chapterDiscoverPromises, discoverKey, discoverPromise);
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

/**
 * through 시점까지 사용 가능 캐시 여부.
 * @param {string|number} bookId
 * @param {number} chapterIdx
 * @param {number|null} [throughEventIdx]
 * @returns {boolean}
 */
export const hasUsableChapterCacheThrough = (bookId, chapterIdx, throughEventIdx = null) => {
  const cached = getCachedChapterEvents(bookId, chapterIdx);
  if (!cached || isUnusableChapterGraphCacheSource(cached.source)) return false;
  const through = Number(throughEventIdx);
  if (!Number.isFinite(through) || through < 1) return !cached.partial && !cached.capped;
  // partial은 through 우선 적재 후 백필 중이라 중간 구간이 비어 있을 수 있음 — 해당 이벤트가 있어야 사용 가능
  if (cached.partial) {
    return asArray(cached.events).some((e) => Number(e?.eventIdx) === through);
  }
  // capped 아닌 캐시는 챕터 전체 — through가 챕터 끝을 넘어도 충족 (isCompleteThrough와 동일 기준)
  if (!cached.capped) return true;
  const cachedMax = Number(cached.maxEventIdx) || 0;
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
/**
 * 16ms마다 isReady 확인. 작업이 끝나기 전에 준비되면 true, 끝났는데도 준비 안 됐으면 false.
 * promise가 실패하면 throw.
 */
async function waitUntilReady(promise, isReady) {
  for (;;) {
    if (isReady()) return true;
    const race = await Promise.race([
      promise.then(() => 'done'),
      new Promise((resolve) => {
        setTimeout(() => resolve('tick'), 16);
      }),
    ]);
    if (race === 'done') return isReady();
  }
}

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

  const isReady = () => hasUsableChapterCacheThrough(bookId, chapter, throughEventIdx);
  const maxAttempts = 2;
  let lastError = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const discoverPromise = discoverChapterEvents(bookId, chapter, attempt > 0, {
        maxEventIdx: throughEventIdx,
        onPartialCache,
      });
      // 아래에서 race 없이 조기 반환하면 이후 rejection이 unhandled가 되므로 흡수 (실패는 아래 race가 throw해 catch에서 처리)
      discoverPromise.catch(() => {});

      // through 캐시가 생기는 순간 반환 (전체 이벤트 백필 완료를 기다리지 않음)
      if (await waitUntilReady(discoverPromise, isReady)) {
        return { success: true };
      }
    } catch (error) {
      // clearBookRelationshipDeltas로 취소됨 — 재시도하면 떠난 책을 다시 받음
      if (error?.name === 'AbortError') {
        return { success: false, reason: 'aborted', error };
      }
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

/* ─── relationship-deltas 누적 (graphApi에서 이동) ─── */

const orderIndexOf = (orderIndex, eventId) => {
  const id = toTrimmedStringOrNull(eventId);
  if (id == null || !orderIndex?.has(id)) return null;
  return orderIndex.get(id);
};

const resolveManifestCharacterMeta = (bookId) => {
  const byId = new Map();
  for (const character of asArray(getManifestFromCache(bookId)?.characters)) {
    const id = Number(character?.id);
    if (Number.isFinite(id)) byId.set(id, character);
  }
  return byId;
};

const normalizeEventIdOrder = (chapterEventIdOrder) =>
  asArray(chapterEventIdOrder).map((id) => toTrimmedStringOrNull(id)).filter(Boolean);

const compareDeltasForAccumulate = (a, b, orderIndex = null) => {
  const chapterA = Number(a?.chapterIndex);
  const chapterB = Number(b?.chapterIndex);
  const hasA = Number.isFinite(chapterA);
  const hasB = Number.isFinite(chapterB);
  if (hasA && hasB && chapterA !== chapterB) return chapterA - chapterB;
  if (hasA !== hasB) return hasA ? -1 : 1;

  if (!orderIndex?.size) return 0;
  const ia = orderIndexOf(orderIndex, a?.eventId);
  const ib = orderIndexOf(orderIndex, b?.eventId);
  if (ia != null && ib != null) return ia - ib;
  if (ia != null) return -1;
  if (ib != null) return 1;
  // eventId 문자열 비교는 시간 순서와 어긋날 수 있어 사용하지 않음 (안정 정렬)
  return 0;
};

/** deltas를 챕터·manifest 이벤트 순으로 정렬 (export: discovery 공용) */
const sortDeltasForAccumulate = (deltas, chapterEventIdOrder = null) => {
  const list = asArray(deltas).filter((d) => d && typeof d === 'object');
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const orderIndex = order.length > 0 ? new Map(order.map((id, i) => [id, i])) : null;
  return [...list].sort((a, b) => compareDeltasForAccumulate(a, b, orderIndex));
};

const createEmptyDeltaAccumulateState = () => ({
  relationMap: new Map(),
  weightMap: new Map(),
  characterIds: new Set(),
  lastDelta: null,
});

const applyNodeWeights = (state, weights) => {
  if (!weights || typeof weights !== 'object') return;
  for (const [rawId, meta] of Object.entries(weights)) {
    const idNum = Number(rawId);
    if (!Number.isFinite(idNum)) continue;
    state.characterIds.add(idNum);
    if (Number.isFinite(meta?.weight)) state.weightMap.set(idNum, meta.weight);
  }
};

const mergeRelationItem = (state, item, deltaEventId) => {
  if (!item || typeof item !== 'object') return;
  const id1 = Number(item.fromCharacterId);
  const id2 = Number(item.toCharacterId);
  if (!Number.isFinite(id1) || !Number.isFinite(id2)) return;

  state.characterIds.add(id1);
  state.characterIds.add(id2);
  const key = directedEdgeElementId(id1, id2);
  const prev = state.relationMap.get(key);
  const labels = asArray(item.labels);
  const evidence = Number.isFinite(item.evidenceCount) ? item.evidenceCount : 1;
  const positivity = toNumberOrNull(item.positivity) ?? clampPositivity(prev?.positivity);

  state.relationMap.set(key, {
    id1,
    id2,
    positivity,
    count: (prev?.count ?? 0) + evidence,
    relation: uniqueStrings([...asArray(prev?.relation), ...labels], { caseInsensitive: true }),
    latestLabels: labels,
    labelHistory: appendRelationLabelHistory(prev?.labelHistory, labels, deltaEventId, positivity),
    latestReason: typeof item.reason === 'string' ? item.reason : prev?.latestReason ?? '',
    latestEventId: deltaEventId ?? prev?.latestEventId ?? null,
  });
};

const applyDeltasToAccumulateState = (state, deltas) => {
  if (!state || !deltas?.length) return state;

  for (const delta of deltas) {
    if (!delta || typeof delta !== 'object') continue;
    state.lastDelta = delta;
    const deltaEventId = toTrimmedStringOrNull(delta.eventId);
    applyNodeWeights(state, delta.nodeWeights);
    for (const item of asArray(delta.items)) mergeRelationItem(state, item, deltaEventId);
  }
  return state;
};

const finalizeAccumulateStateToGraphResult = (
  bookId,
  state,
  { chapterIndex = null, eventId = null } = {}
) => {
  const last = state.lastDelta;
  const stampedId = toTrimmedStringOrNull(eventId);
  // through 스냅샷: chapterIndex 인자 우선 / 전체 누적: last delta 우선
  const resolvedChapter = stampedId
    ? toNumberOrNull(chapterIndex) ?? last?.chapterIndex ?? null
    : last?.chapterIndex ?? toNumberOrNull(chapterIndex);
  const resolvedEventId = stampedId ?? toTrimmedStringOrNull(last?.eventId) ?? null;

  const manifestChars = resolveManifestCharacterMeta(bookId);
  const characters = [...state.characterIds]
    .sort((a, b) => a - b)
    .map((id) => {
      const meta = manifestChars.get(id);
      const commonName = pickCharacterDisplayName(meta) || '';
      if (commonName) rememberCharacterDisplayName(bookId, id, commonName);
      return {
        id,
        weight: toPositiveNumberOrNull(state.weightMap.get(id)) ?? 1,
        count: 1,
        common_name: commonName,
        name: commonName,
        names: asArray(meta?.names),
        // 인물 소개는 personalityText (profileText는 이미지 프롬프트 등 별도 용도)
        personalityText: stringOrEmpty(meta?.personalityText),
        profileText: stringOrEmpty(meta?.profileText),
        description: stringOrEmpty(meta?.personalityText),
        profileImage: stringOrEmpty(meta?.profileImage),
        isMainCharacter: Boolean(meta?.isMainCharacter),
      };
    });

  return {
    bookId: Number(bookId) || bookId || null,
    chapterIndex: resolvedChapter,
    eventId: resolvedEventId,
    characters,
    relations: [...state.relationMap.values()],
    event: buildGraphEventMeta(resolvedEventId, resolvedChapter),
  };
};

/** throughEventId까지 포함한 end index (exclusive). 목록에 없으면 order로 근사. */
const resolveThroughEndExclusive = (
  sortedDeltas,
  throughEventId,
  { chapterIndex = null, chapterEventIdOrder = null } = {}
) => {
  const list = asArray(sortedDeltas);
  const through = toTrimmedStringOrNull(throughEventId);
  if (!through || list.length === 0) return 0;

  const cut = list.findIndex((d) => toTrimmedStringOrNull(d.eventId) === through);
  if (cut >= 0) return cut + 1;

  const targetChapter = toNumberOrNull(chapterIndex);
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const throughPos = order.indexOf(through);
  if (targetChapter == null || throughPos < 0) return list.length;

  const allowedInChapter = new Set(order.slice(0, throughPos + 1));
  const orderSet = new Set(order);
  let end = 0;
  for (let i = 0; i < list.length; i += 1) {
    const d = list[i];
    const ch = Number(d?.chapterIndex);
    const id = toTrimmedStringOrNull(d?.eventId);
    let include = false;
    if (Number.isFinite(ch) && ch < targetChapter) include = true;
    else if (Number.isFinite(ch) && ch > targetChapter) include = false;
    else if (Number.isFinite(ch) && ch === targetChapter) include = id ? allowedInChapter.has(id) : false;
    else include = id ? !orderSet.has(id) : false;
    if (include) end = i + 1;
  }
  return end;
};

/**
 * 정렬된 deltas를 이벤트 순으로 증분 누적.
 * discovery에서 phase1/phase2가 동일 walker를 재사용.
 * appliedEnd는 항상 원본 sortedDeltas 기준 exclusive index.
 */
const createDeltaAccumulateWalker = (
  bookId,
  sortedDeltas,
  { chapterIndex = null, chapterEventIdOrder = null } = {}
) => {
  const state = createEmptyDeltaAccumulateState();
  let appliedEnd = 0;
  const deltas = asArray(sortedDeltas);
  const cutOpts = {
    chapterIndex,
    chapterEventIdOrder: normalizeEventIdOrder(chapterEventIdOrder),
  };

  const applyUpTo = (endExclusive) => {
    const end = Math.max(0, Math.min(endExclusive, deltas.length));
    if (end <= appliedEnd) return;
    applyDeltasToAccumulateState(state, deltas.slice(appliedEnd, end));
    appliedEnd = end;
  };

  const advanceThrough = (eventId) => {
    const id = toTrimmedStringOrNull(eventId);
    if (!id) return;
    applyUpTo(resolveThroughEndExclusive(deltas, id, cutOpts));
  };

  const snapshot = (eventId) =>
    finalizeAccumulateStateToGraphResult(bookId, state, { chapterIndex, eventId });

  return {
    advanceThrough,
    snapshotThrough(eventId) {
      const id = toTrimmedStringOrNull(eventId);
      advanceThrough(id);
      return snapshot(id);
    },
    snapshotAll() {
      applyUpTo(deltas.length);
      return snapshot(null);
    },
  };
};

/**
 * relationship-deltas → 기존 그래프 소비자용 characters/relations 누적.
 * @param {{ chapterIndex?: number|null, throughEventId?: string|null, chapterEventIdOrder?: string[]|null }} [options]
 */
export const accumulateDeltasToGraphResult = (
  bookId,
  deltas,
  { chapterIndex = null, throughEventId = null, chapterEventIdOrder = null } = {}
) => {
  const through = toTrimmedStringOrNull(throughEventId);
  const order = normalizeEventIdOrder(chapterEventIdOrder);
  const walker = createDeltaAccumulateWalker(
    bookId,
    sortDeltasForAccumulate(deltas, order),
    { chapterIndex, chapterEventIdOrder: order }
  );
  return through ? walker.snapshotThrough(through) : walker.snapshotAll();
};

export const resolveChapterEventIdOrder = (bookId, chapterIndex) => {
  if (toNumberOrNull(chapterIndex) == null) return [];
  return asArray(getChapterData(bookId, chapterIndex)?.events)
    .map(resolveManifestEventId)
    .filter(Boolean);
};

const bookDeltasCache = new Map();
const bookDeltasInflight = new Map();
/** clear 시 증가 — 진행 중이던 fetch가 지운 캐시를 다시 채우지 않도록 */
const bookDeltasGeneration = new Map();

/**
 * 책 deltas 메모리/inflight 캐시 클리어.
 * @param {string|number} bookId
 */
export const clearBookRelationshipDeltas = (bookId) => {
  const key = toPositiveNumberOrNull(bookId) ?? bookId;
  bookDeltasCache.delete(key);
  bookDeltasInflight.delete(key);
  bookDeltasGeneration.set(key, (bookDeltasGeneration.get(key) ?? 0) + 1);
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
  const ch = toPositiveInt(chapterIndex);
  if (!cached || ch == null) return false;
  const covered = toPositiveInt(cached.coveredThroughChapter);
  if (covered != null && covered >= ch) return true;
  const lastId = resolveManifestEventId(getLastManifestEventInChapter(bookId, ch));
  return lastId ? cacheCoversThrough(cached, lastId, bookId) : false;
};

const mergeDeltasByEventId = (baseDeltas, nextDeltas) => {
  const merged = Array.isArray(baseDeltas) ? [...baseDeltas] : [];
  const seen = new Set(merged.map((d) => toTrimmedStringOrNull(d?.eventId)).filter(Boolean));
  for (const delta of asArray(nextDeltas)) {
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
  { toEventId = null, coveredThroughChapter = null, response = null } = {}
) => {
  const list = asArray(deltas);
  return {
    bookId,
    deltas: list,
    toEventId: toTrimmedStringOrNull(toEventId),
    coveredThroughChapter: toPositiveInt(coveredThroughChapter),
    response,
    // 실패는 fetchAndStoreByChapter에서 throw — 캐시 항목은 항상 성공
    isSuccess: true,
  };
};

/** clearBookRelationshipDeltas 이후 끝난 요청이면 결과를 버림 */
const throwIfCleared = (key, generation) => {
  if ((bookDeltasGeneration.get(key) ?? 0) !== generation) {
    throw new DOMException('Aborted', 'AbortError');
  }
};

/** 챕터 단위 조회 실패 (hard/soft fail) → throw용 Error */
const deltasFetchError = (fetched) => {
  const err = new Error(fetched.response?.message || '관계 델타 조회에 실패했습니다.');
  err.code = fetched.response?.code || 'ERROR';
  err.response = fetched.response;
  return err;
};

/**
 * 여러 챕터를 manifest eventId 범위로 1회 요청 (챕터별 N요청은 BE 커넥션 풀에서 줄 섬).
 * 성공해 캐시에 반영하면 새 항목, 범위를 못 정했거나 빈 결과·실패면 null (챕터별 폴백).
 */
const fetchChapterRangeOnce = async (key, chapters, uptoChapter, current, generation) => {
  const fromId = chapters
    .map((ch) => resolveManifestEventId(getFirstManifestEventInChapter(key, ch)))
    .find(Boolean);
  const toId = resolveManifestEventId(getLastManifestEventInChapter(key, uptoChapter));
  if (!fromId || !toId) return null;

  try {
    const fetched = await fetchRelationshipDeltasList(key, { fromEventId: fromId, toEventId: toId });
    throwIfCleared(key, generation);
    // 빈 결과는 eventId 불일치(404→soft-empty)일 수 있어 챕터별 조회로 확인
    if (fetched.isSuccess === false || fetched.deltas.length === 0) return null;
    const entry = buildCacheEntry(
      fetched.bookId ?? key,
      mergeDeltasByEventId(current?.deltas, fetched.deltas),
      { toEventId: toId, coveredThroughChapter: uptoChapter, response: fetched.response }
    );
    bookDeltasCache.set(key, entry);
    return entry;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    // 범위 조회 실패(400 등) → 챕터별 조회로 폴백
    return null;
  }
};

const fetchAndStoreByChapter = async (key, uptoChapter) => {
  const generation = bookDeltasGeneration.get(key) ?? 0;
  let current = bookDeltasCache.get(key);
  if (current && cacheCoversChapter(current, uptoChapter, key)) return current;

  const covered = toPositiveInt(current?.coveredThroughChapter) ?? 0;
  const chapters = [];
  for (let ch = Math.max(1, covered + 1); ch <= uptoChapter; ch += 1) {
    if (!(current && cacheCoversChapter(current, ch, key))) chapters.push(ch);
  }

  if (chapters.length > 1) {
    const ranged = await fetchChapterRangeOnce(key, chapters, uptoChapter, current, generation);
    if (ranged) return ranged;
  }

  // 챕터 요청은 병렬로 보내고, 병합은 챕터 순서대로 (순차 요청 시 N챕터 = N 왕복 대기)
  const results = await Promise.allSettled(
    chapters.map((ch) => fetchRelationshipDeltasList(key, { chapterIndex: ch }))
  );
  // 일부만 받은 deltas를 성공으로 넘기면 discover가 관계 빠진 챕터 캐시를 저장함
  throwIfCleared(key, generation);

  chapters.forEach((ch, i) => {
    if (results[i].status === 'rejected') throw results[i].reason;
    const fetched = results[i].value;
    // hard/soft fail을 빈 성공·커버리지로 캐시하지 않음 (재시도 가능, noRelation과 구분)
    if (fetched.isSuccess === false) throw deltasFetchError(fetched);

    const chapterLastId = resolveManifestEventId(getLastManifestEventInChapter(key, ch));
    current = buildCacheEntry(
      fetched.bookId ?? key,
      mergeDeltasByEventId(current?.deltas, fetched.deltas),
      {
        toEventId: chapterLastId || current?.toEventId || null,
        coveredThroughChapter: ch,
        response: fetched.response,
      }
    );
    bookDeltasCache.set(key, current);
  });

  return current ?? buildCacheEntry(key, []);
};

/**
 * 책 deltas 확보 — chapterIndex(1..N) 챕터 단위 조회. 메모리 캐시 기록.
 * @param {string|number} bookId
 * @param {{ chapterIndex?: number|null }} [options]
 * @returns {Promise<{ bookId: *, deltas: Array, toEventId: string|null, coveredThroughChapter: number|null, response: *, isSuccess: boolean }>}
 */
export async function ensureBookRelationshipDeltas(bookId, { chapterIndex = null } = {}) {
  requireBookId(bookId);

  const key = toPositiveNumberOrNull(bookId) ?? bookId;
  const ch = toPositiveInt(chapterIndex);
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
      } catch (error) {
        // clear로 취소된 책은 다시 받지 않음. 그 외 실패는 아래에서 재시도
        if (error?.name === 'AbortError') throw error;
      }
      continue;
    }

    return awaitTracked(bookDeltasInflight, key, fetchAndStoreByChapter(key, ch));
  }
}

/* ─── 매크로 그래프 응답 (책 전체 누적 → API 응답 shape) ─── */

const handleApiError = (error, context) => {
  const statusMessages = {
    400: '잘못된 요청입니다',
    401: '인증이 필요합니다',
    403: '접근 권한이 없습니다',
    404: '요청한 리소스를 찾을 수 없습니다',
    500: '서버 내부 오류가 발생했습니다',
    502: '게이트웨이 오류가 발생했습니다',
    503: '서비스를 일시적으로 사용할 수 없습니다',
  };
  const statusCode = error.status || 'unknown';
  const statusMessage = statusMessages[statusCode] || 'API 요청 중 오류가 발생했습니다';
  errorUtils.logError('graphApi', error, { context, status: statusCode });
  throw new Error(
    `${context}: ${statusMessage} (${statusCode}) - ${error.message || '알 수 없는 오류'}`
  );
};

const emptyAccumulatedGraphResult = (overrides = {}) => ({
  bookId: null,
  chapterIndex: null,
  eventId: null,
  characters: [],
  relations: [],
  event: null,
  ...overrides,
});

const normalizeAccumulatedGraphResult = (payload) => {
  if (!payload || typeof payload !== 'object') return emptyAccumulatedGraphResult();
  const eventId = toTrimmedStringOrNull(payload.eventId);
  const chapterIndex = payload.chapterIndex ?? null;
  return {
    ...payload,
    bookId: payload.bookId ?? null,
    chapterIndex,
    eventId,
    characters: asArray(payload.characters),
    relations: asArray(payload.relations),
    event:
      payload.event && typeof payload.event === 'object'
        ? payload.event
        : buildGraphEventMeta(eventId, chapterIndex),
  };
};

const createRelationshipDeltasResponse = (isSuccess, code, message, result, status = null) => {
  const normalized = normalizeAccumulatedGraphResult(result);
  const hasPayload =
    normalized.characters.length > 0 || normalized.relations.length > 0 || Boolean(normalized.eventId);
  let resolvedStatus = status;
  if (!resolvedStatus) {
    if (!isSuccess) resolvedStatus = FETCH_STATUS.ERROR;
    else if (!hasPayload) resolvedStatus = FETCH_STATUS.EMPTY;
    else resolvedStatus = FETCH_STATUS.OK;
  }
  return {
    isSuccess,
    code,
    message,
    status: resolvedStatus,
    result: normalized,
  };
};

const toGraphApiResponse = ({ response, result, empty }) => {
  const resolved = result || empty;
  const hasPayload = hasGraphPayload(resolved);
  // soft-empty는 fetch 단계에서 success로 정규화됨. 여기선 누적 payload로 부분 실패 보정.
  const failed = (!response || response.isSuccess === false) && !hasPayload;
  const code = failed ? response?.code || 'ERROR' : hasPayload ? 'SUCCESS' : 'NOT_FOUND';
  const message = failed
    ? response?.message || '관계 델타 조회에 실패했습니다.'
    : hasPayload
      ? '관계 델타를 성공적으로 조회했습니다.'
      : '관계 델타를 찾을 수 없습니다.';
  return toUnifiedApiResponse(
    createRelationshipDeltasResponse(
      !failed,
      code,
      message,
      failed ? empty : resolved,
      failed ? FETCH_STATUS.ERROR : null
    )
  );
};

const relationshipDeltasInvalidParams = (empty, message = 'chapterIndex가 필요합니다.') =>
  toUnifiedApiResponse(
    createRelationshipDeltasResponse(false, 'INVALID_PARAMS', message, empty)
  );

/** 매크로 그래프: 해당 챕터까지(챕터 단위) 책 전체 누적 */
export const getBookScopeRelationshipGraph = async (bookId, uptoChapter = null) => {
  requireBookId(bookId);

  const chapterIndex = toNumberOrNull(uptoChapter);
  const bookIdNum = Number(bookId) || null;
  if (chapterIndex == null) {
    return relationshipDeltasInvalidParams(
      emptyAccumulatedGraphResult({ bookId: bookIdNum })
    );
  }

  const resolvedTo = resolveManifestEventId(getLastManifestEventInChapter(bookId, chapterIndex));
  const empty = emptyAccumulatedGraphResult({
    bookId: bookIdNum,
    chapterIndex,
    eventId: resolvedTo,
  });

  try {
    const fetched = await ensureBookRelationshipDeltas(bookId, {
      chapterIndex,
    });
    return toGraphApiResponse({
      response: fetched.response,
      result: accumulateDeltasToGraphResult(fetched.bookId, fetched.deltas, {
        chapterIndex,
        throughEventId: resolvedTo,
        chapterEventIdOrder: resolveChapterEventIdOrder(bookId, chapterIndex),
      }),
      empty,
    });
  } catch (error) {
    handleApiError(error, '관계 델타 조회 실패');
  }
};
