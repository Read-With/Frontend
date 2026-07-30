/** 그래프 도메인 primitive, 관계 스키마, UI 상수, 챕터 라벨 */

import {
  resolveLastEventIdxForChapter,
  getLastEventIdxFromChapterData,
  getChapterData,
  getManifestFromCache,
} from '../common/cache/manifestCache.js';
import {
  toPositiveNumberOrNull,
  toFiniteNumber,
} from '../common/valueUtils';
import {
  formatFallbackChapterLabel,
  resolveChapterTitleMeta,
  stripSharedListPrefix,
  stripChapterOrdinalPrefix,
} from '../viewer/viewerCore.js';
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from '../common/cache/cacheManager';
import { clearStyleCache } from '../styles/relationStyles';

/* ─── 요소 ID · 타입 판별 ─── */

const API_PREFIX = 'api:';

export const extractApiBookId = (folderKeyOrFilename) => {
  if (!folderKeyOrFilename) return null;
  if (typeof folderKeyOrFilename === 'number') {
    return toPositiveNumberOrNull(folderKeyOrFilename);
  }
  const key = String(folderKeyOrFilename).trim();
  if (!key) return null;
  return toPositiveNumberOrNull(key.startsWith(API_PREFIX) ? key.slice(API_PREFIX.length) : key);
};

export const normalizeElementId = (element) => element?.id ?? element?.data?.id ?? null;

export const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

export const isGraphNodeElement = (element) =>
  Boolean(element?.data && element.data.id !== undefined && !isGraphEdgeElement(element));

/** 무방향 노드 쌍 키 (순서 무관) */
export function undirectedPairKey(s, t) {
  const a = String(s);
  const b = String(t);
  return a < b ? `${a}\x1e${b}` : `${b}\x1e${a}`;
}

export const sortElementsByDataId = (elements) => {
  if (!Array.isArray(elements)) return [];
  return [...elements].sort((a, b) =>
    String(a?.data?.id ?? '').localeCompare(String(b?.data?.id ?? ''))
  );
};

export const uniqueStrings = (values, { caseInsensitive = false } = {}) => {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const str = String(value ?? '').trim();
    const key = caseInsensitive ? str.toLowerCase() : str;
    if (!str || seen.has(key)) continue;
    seen.add(key);
    result.push(str);
  }
  return result;
};

export function normalizeRelationArray(relation, label = '') {
  const values = Array.isArray(relation)
    ? relation
    : typeof relation === 'string'
      ? [relation]
      : typeof label === 'string'
        ? label.split(',')
        : [];

  return uniqueStrings(values);
}

/** 배열에서 가장 최근에 추가된(마지막) 라벨 문구 */
export function pickLastRelationLabel(labels) {
  if (!Array.isArray(labels) || labels.length === 0) return '';
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const text = String(labels[i] ?? '').trim();
    if (text) return text;
  }
  return '';
}

export function mergeRelationLabelHistory(a, b) {
  const out = { ...(a && typeof a === 'object' ? a : {}) };
  for (const [text, meta] of Object.entries(b && typeof b === 'object' ? b : {})) {
    if (!text || !meta || typeof meta !== 'object') continue;
    const prev = out[text];
    if (!prev) {
      out[text] = { ...meta, text: meta.text || text };
      continue;
    }
    out[text] = {
      text: prev.text || meta.text || text,
      firstEventId: prev.firstEventId ?? meta.firstEventId ?? null,
      lastEventId: meta.lastEventId ?? prev.lastEventId ?? null,
      firstPositivity:
        prev.firstPositivity != null ? prev.firstPositivity : meta.firstPositivity,
      lastPositivity:
        meta.lastPositivity != null ? meta.lastPositivity : prev.lastPositivity,
    };
  }
  return out;
}

/**
 * 툴팁용 관계 태그 + 시점(tone) + 긍정도 색
 * tone: added(현재 이벤트에서 최초 추가) | changed(이전에도 있고 현재에 재등장/갱신) | prior(과거)
 */
export function buildRelationTagDisplayItems({
  relation,
  label,
  labelHistory = null,
  latestLabels = null,
  currentEventId = null,
  fallbackPositivity = null,
} = {}) {
  const tags = normalizeRelationArray(relation, label);
  const history = labelHistory && typeof labelHistory === 'object' ? labelHistory : {};
  const latestSet = new Set(
    normalizeRelationArray(latestLabels).map((t) => t.toLowerCase())
  );
  const currentId = currentEventId != null ? String(currentEventId) : null;
  const fallback =
    fallbackPositivity == null || fallbackPositivity === ''
      ? null
      : Number(fallbackPositivity);

  return tags.map((text, index) => {
    const meta = history[text];
    let tone = 'prior';
    if (meta && currentId) {
      const firstId = meta.firstEventId != null ? String(meta.firstEventId) : null;
      const lastId = meta.lastEventId != null ? String(meta.lastEventId) : null;
      if (lastId === currentId) {
        tone = firstId === currentId ? 'added' : 'changed';
      }
    } else if (!meta && latestSet.has(text.toLowerCase())) {
      tone = index === tags.length - 1 ? 'changed' : 'added';
    }

    const positivityRaw =
      meta?.lastPositivity ?? meta?.firstPositivity ?? fallback;
    const positivity =
      positivityRaw == null || Number.isNaN(Number(positivityRaw))
        ? 0
        : Number(positivityRaw);

    return {
      text,
      tone,
      positivity,
      firstEventId: meta?.firstEventId ?? null,
      lastEventId: meta?.lastEventId ?? null,
      firstPositivity: meta?.firstPositivity ?? null,
      lastPositivity: meta?.lastPositivity ?? null,
    };
  });
}

/** 챕터 마지막 이벤트 인덱스 (manifest 힌트, UI·범위용). 없으면 null — 가짜 1 금지 */
export const calculateLastEventForChapter = ({
  manifestChapters,
  manifestBookId,
  chapter,
}) => {
  if (manifestBookId != null && Number.isFinite(Number(manifestBookId)) && Number(manifestBookId) > 0) {
    const manifestHint =
      Array.isArray(manifestChapters) && manifestChapters.length > 0
        ? { chapters: manifestChapters }
        : undefined;
    const fromManifest = resolveLastEventIdxForChapter(manifestBookId, chapter, manifestHint);
    if (fromManifest != null) {
      return fromManifest;
    }
  }

  if (!manifestChapters?.length) return null;

  const chapterNum = Number(chapter);
  const chapterInfo = manifestChapters.find(
    (ch) => ch && typeof ch === 'object' && Number(ch.idx) === chapterNum
  );

  if (!chapterInfo) return null;

  return getLastEventIdxFromChapterData(chapterInfo);
};

export const GRAPH_LAYOUT_CONSTANTS = {
  SIDEBAR: { OPEN_WIDTH: 280, CLOSED_WIDTH: 56 },
  /** .graph-page-topbar(2.75rem) + 여백 — 관계 분석 모달 top 기준 */
  PAGE_CHROME_OFFSET: 60,
  /** 관계 분석(레이더) 모달 — 챕터 레일·상단바로부터의 여백 */
  ANALYSIS_MODAL_INSET: 16,
  /** GraphCanvas 툴팁 사이드바 실제 너비와 동일해야 센터링이 맞음 */
  TOOLTIP_SIDEBAR_WIDTH: 480,
  /** 우측 툴팁 사이드바 slide in/out */
  ANIMATION_MS: 520,
  /** 클릭 focus 영역 이동 */
  FOCUS_PAN_MS: 480,
  /** 사이드바가 어느 정도 열린 뒤 팬 */
  FOCUS_PAN_DELAY_MS: 380,
};

/** Cytoscape 뷰포트 줌 (휠·버튼·초기 fit 공통) */
export const GRAPH_ZOOM = {
  STEP: 1.25,
  MIN: 0.2,
  MAX: 2.4,
  /** cy.fit 여백 — 줌·범례 버튼 등 가장자리 여유 */
  FIT_PADDING: 56,
  /** 초기/영역 맞춤 — 짧게 유지해 등장감 완화 */
  FIT_DURATION_MS: 140,
};

/** 표시 순서: 주요 → 주변 → 전체 (value는 filterMainCharacters와 동일) */
export const GRAPH_CHARACTER_FILTER_STAGE_OPTIONS = [
  { value: 1, label: '주요', title: '핵심 인물과 그들 사이 관계만' },
  { value: 2, label: '주변', title: '핵심 + 직접 연결된 인물' },
  { value: 0, label: '전체', title: '모든 인물' },
];

export function resolveChapterSidebarWidth(isSidebarOpen, { isNarrow = false } = {}) {
  // 좁은 화면은 오버레이 드로어 — 레이아웃 offset 없음
  if (isNarrow) return 0;
  const { OPEN_WIDTH, CLOSED_WIDTH } = GRAPH_LAYOUT_CONSTANTS.SIDEBAR;
  return isSidebarOpen ? OPEN_WIDTH : CLOSED_WIDTH;
}

/* ─── 챕터 사이드바 라벨 ─── */

/** 챕터 사이드바 목록용 항목 */
export function buildChapterSidebarItems(chapterList, manifestBookId, bookTitle, manifestHint) {
  const rows = chapterList.map((chapter) => {
    const chData =
      manifestBookId != null && Number.isFinite(chapter) && chapter >= 1
        ? getChapterData(manifestBookId, chapter, manifestHint ?? undefined)
        : null;
    const meta = resolveChapterTitleMeta(chData, bookTitle, chapter);
    const events = Array.isArray(chData?.events) ? chData.events : null;
    // manifest에 events가 있을 때만 판정. 없으면 unknown(표시만, dim 안 함)
    const hasGraph = events == null ? null : events.length > 0;
    const fallback = formatFallbackChapterLabel(chapter);

    return {
      chapter,
      label: meta.display || fallback,
      hasGraph,
    };
  });

  const stripped = stripSharedListPrefix(rows.map((row) => row.label), bookTitle);
  return rows.map((row, index) => {
    const base = stripped[index] || formatFallbackChapterLabel(row.chapter);
    const label = stripChapterOrdinalPrefix(base, row.chapter) || base;
    return { ...row, label };
  });
}

/** 챕터·이벤트 전환 시 Cytoscape viewport fit 키 */
export function buildGraphViewportRefitKey(chapter, eventNum) {
  return `${chapter ?? ''}:${eventNum ?? ''}`;
}

/* ─── 관계 정규화 · 태그 · 레이더 ─── */

export function normalizeRelation(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  try {
    const id1 = toFiniteNumber(raw.id1);
    const id2 = toFiniteNumber(raw.id2);

    if (
      !Number.isFinite(id1) ||
      !Number.isFinite(id2) ||
      id1 === 0 ||
      id2 === 0 ||
      id1 === id2
    ) {
      return null;
    }

    const positivity = raw.positivity;
    const weight = raw.weight ?? 1;
    const count = raw.count;
    const relationArray = normalizeRelationArray(raw.relation);
    const latestArray = normalizeRelationArray(raw.latestLabels);
    const tags = relationArray.length > 0 ? relationArray : latestArray;
    // 겉 라벨: 이번 델타 latestLabels 마지막 → 누적 relation 마지막 → raw.label
    const label =
      pickLastRelationLabel(latestArray) ||
      pickLastRelationLabel(tags) ||
      (typeof raw.label === 'string' ? raw.label.trim() : '') ||
      '';

    return {
      id1,
      id2,
      positivity,
      weight,
      count,
      relation: tags,
      latestLabels: latestArray,
      labelHistory:
        raw.labelHistory && typeof raw.labelHistory === 'object' ? raw.labelHistory : {},
      latestEventId: raw.latestEventId ?? null,
      label,
    };
  } catch {
    return null;
  }
}

export function isSamePair(rel, a, b) {
  if (!rel || typeof rel !== 'object') {
    return false;
  }

  const r1 = toFiniteNumber(rel.id1);
  const r2 = toFiniteNumber(rel.id2);
  const s1 = toFiniteNumber(a);
  const s2 = toFiniteNumber(b);

  if (
    !Number.isFinite(r1) ||
    !Number.isFinite(r2) ||
    !Number.isFinite(s1) ||
    !Number.isFinite(s2)
  ) {
    return false;
  }

  return undirectedPairKey(r1, r2) === undirectedPairKey(s1, s2);
}

function pickMetaField(raw, nested, keys) {
  for (const source of nested ? [raw, nested] : [raw]) {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null) return value;
    }
  }
  return undefined;
}

export function relationEventMetaPassthrough(raw) {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const nested = raw.event && typeof raw.event === 'object' ? raw.event : null;
  const chapterIdx = pickMetaField(raw, nested, ['chapterIdx', 'chapter', 'chapter_idx']);
  const eventNum = pickMetaField(raw, nested, ['eventNum', 'event_num']);
  const eventIdx = pickMetaField(raw, nested, ['eventIdx', 'event_idx']);
  const eventId = pickMetaField(raw, nested, ['eventId', 'event_id', 'id']);
  return {
    ...(chapterIdx !== undefined ? { chapterIdx } : {}),
    ...(eventNum !== undefined ? { eventNum } : {}),
    ...(eventIdx !== undefined ? { eventIdx } : {}),
    ...(eventId !== undefined ? { eventId } : {}),
  };
}

export function processRelations(relations) {
  if (!Array.isArray(relations) || relations.length === 0) {
    return [];
  }

  try {
    return relations
      .map((raw) => ({ raw, norm: normalizeRelation(raw) }))
      .filter(({ norm }) => norm != null)
      .map(({ raw, norm: r }) => ({
        id1: r.id1,
        id2: r.id2,
        positivity: r.positivity,
        relation: r.relation,
        weight: r.weight,
        count: r.count,
        ...relationEventMetaPassthrough(raw),
      }));
  } catch {
    return [];
  }
}

const relationCache = new Map();
registerCache('relationCache', relationCache, { maxSize: 1000, ttl: 600000 }); // 10분 TTL

/** 관계 태그 정규화 (캐시) */
export function processRelationTags(relation, label) {
  try {
    if (relation === undefined && label === undefined) {
      return [];
    }

    const relationStr = Array.isArray(relation) ? relation.join('|') : String(relation || '');
    const labelStr = String(label || '');
    const cacheKey = `${relationStr}::${labelStr}`;

    recordCacheAccess('relationCache');

    if (relationCache.has(cacheKey)) {
      return relationCache.get(cacheKey);
    }

    const result = normalizeRelationArray(relation, label);
    relationCache.set(cacheKey, result);
    enforceCacheSizeLimit('relationCache');
    return result;
  } catch {
    return [];
  }
}

/** 관계·스타일 캐시 일괄 정리 (툴팁 닫을 때) */
export function cleanupRelationUtils() {
  try {
    relationCache.clear();
    clearStyleCache();
  } catch {
    /* ignore */
  }
}

export const extractRadarChartData = (nodeId, relations, elements, maxDisplay = 8) => {
  if (!nodeId || !relations || !Array.isArray(relations)) return [];

  const targetNodeId = String(nodeId);
  const radarDataMap = new Map();

  relations.forEach((rel) => {
    const id1 = String(rel.id1);
    const id2 = String(rel.id2);
    let connectedNodeId = null;
    if (id1 === targetNodeId) connectedNodeId = id2;
    else if (id2 === targetNodeId) connectedNodeId = id1;

    if (!connectedNodeId) return;

    const existingData = radarDataMap.get(connectedNodeId);
    const positivity = toFiniteNumber(rel.positivity);
    if (!existingData || Math.abs(positivity) > Math.abs(existingData.positivity)) {
      const connectedNode = elements.find(
        (el) => isGraphNodeElement(el) && String(el.data.id) === connectedNodeId
      );
      if (connectedNode && Number.isFinite(positivity)) {
        const name =
          connectedNode.data.label || connectedNode.data.common_name || `인물 ${connectedNodeId}`;
        radarDataMap.set(connectedNodeId, {
          id: connectedNodeId,
          name,
          positivity,
          normalizedValue: ((positivity + 1) / 2) * 100,
          relationTags: rel.relation || [],
        });
      }
    }
  });

  const radarData = Array.from(radarDataMap.values());
  radarData.sort((a, b) => Math.abs(b.positivity) - Math.abs(a.positivity));
  return radarData.slice(0, maxDisplay);
};

/* ─── 인물 표시 이름 (from graphCharacterNames) ─── */

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

export function normalizeCharacterId(value) {
  if (value == null || value === '') return null;
  const numId = Number(value);
  if (!Number.isFinite(numId)) return null;
  return String(Math.trunc(numId));
}

export function extractCharacterId(character) {
  if (!character || typeof character !== 'object') return null;
  return normalizeCharacterId(character.id);
}

/** 표시 이름으로 쓸 수 있는 문자열인지 (ID 숫자 문자열은 제외) */
export function isUsableCharacterDisplayName(name, characterId = null) {
  if (typeof name !== 'string') return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  const id = normalizeCharacterId(characterId);
  if (id && trimmed === id) return false;
  if (/^\d+$/.test(trimmed) && (!id || trimmed === id)) return false;
  return true;
}

export function pickCharacterDisplayName(character) {
  if (!character || typeof character !== 'object') return '';
  const id = extractCharacterId(character);
  const fromNames = asArray(character.names).find((n) => isUsableCharacterDisplayName(n, id));
  const candidates = [
    character.common_name,
    character.name,
    character.label,
    character.displayName,
    fromNames,
  ];
  for (const candidate of candidates) {
    if (isUsableCharacterDisplayName(candidate, id)) return String(candidate).trim();
  }
  return '';
}

/** bookId → (characterId → displayName) — 챕터/페이지 전환 후에도 재사용 */
const characterDisplayNameMemory = new Map();

function getMemoryMap(bookId) {
  const key = normalizeCharacterId(bookId) ?? String(bookId ?? '').trim();
  if (!key) return null;
  let map = characterDisplayNameMemory.get(key);
  if (!map) {
    map = new Map();
    characterDisplayNameMemory.set(key, map);
  }
  return map;
}

export function rememberCharacterDisplayName(bookId, characterId, displayName) {
  const id = normalizeCharacterId(characterId);
  if (!id || !isUsableCharacterDisplayName(displayName, id)) return;
  const map = getMemoryMap(bookId);
  if (!map) return;
  map.set(id, String(displayName).trim());
}

export function rememberCharacterDisplayNames(bookId, characters) {
  asArray(characters).forEach((char) => {
    const id = extractCharacterId(char);
    const name = pickCharacterDisplayName(char);
    if (id && name) rememberCharacterDisplayName(bookId, id, name);
  });
}

export function lookupRememberedCharacterDisplayName(bookId, characterId) {
  const id = normalizeCharacterId(characterId);
  if (!id) return '';
  return getMemoryMap(bookId)?.get(id) || '';
}

export function buildManifestCharacterNameLookup(bookId) {
  const lookup = new Map();
  if (bookId == null || bookId === '') return lookup;
  const characters = getManifestFromCache(bookId)?.characters;
  asArray(characters).forEach((char) => {
    const id = extractCharacterId(char);
    const name = pickCharacterDisplayName(char);
    if (id && name) lookup.set(id, name);
  });
  return lookup;
}

/** payload·manifest·세션 메모리를 합쳐 ID→이름 룩업 생성 */
export function buildCharacterDisplayNameLookup(bookId, characters = null) {
  const lookup = buildManifestCharacterNameLookup(bookId);
  const memory = getMemoryMap(bookId);
  if (memory) {
    memory.forEach((name, id) => {
      if (!lookup.has(id) && isUsableCharacterDisplayName(name, id)) lookup.set(id, name);
    });
  }
  asArray(characters).forEach((char) => {
    const id = extractCharacterId(char);
    const name = pickCharacterDisplayName(char);
    if (id && name) lookup.set(id, name);
  });
  return lookup;
}

export function resolveCharacterDisplayName(characterOrId, { bookId, lookup = null } = {}) {
  const id =
    characterOrId != null && typeof characterOrId === 'object'
      ? extractCharacterId(characterOrId)
      : normalizeCharacterId(characterOrId);
  if (!id) return '';

  if (characterOrId && typeof characterOrId === 'object') {
    const picked = pickCharacterDisplayName(characterOrId);
    if (picked) return picked;
  }

  const fromLookup = lookup?.get(id);
  if (isUsableCharacterDisplayName(fromLookup, id)) return fromLookup;

  const fromManifest = buildManifestCharacterNameLookup(bookId).get(id);
  if (fromManifest) return fromManifest;

  return lookupRememberedCharacterDisplayName(bookId, id);
}

export function enrichGraphCharacters(characters, { bookId } = {}) {
  const list = asArray(characters);
  if (!list.length) return list;

  const lookup = buildCharacterDisplayNameLookup(bookId, list);
  const enriched = list.map((char) => {
    if (!char || typeof char !== 'object') return char;
    const id = extractCharacterId(char);
    const name = resolveCharacterDisplayName(char, { bookId, lookup });
    if (id && name) {
      rememberCharacterDisplayName(bookId, id, name);
      lookup.set(id, name);
    }
    if (!name) return char;

    const nextNames = asArray(char.names);
    const names =
      name && !nextNames.some((n) => String(n).trim() === name)
        ? [name, ...nextNames]
        : nextNames;

    return {
      ...char,
      common_name: name,
      name: isUsableCharacterDisplayName(char.name, id) ? String(char.name).trim() : name,
      names,
    };
  });

  rememberCharacterDisplayNames(bookId, enriched);
  return enriched;
}

export function applyDisplayNamesToElements(elements, { bookId, characters = null } = {}) {
  const list = asArray(elements);
  if (!list.length) return list;

  const lookup = buildCharacterDisplayNameLookup(bookId, characters);
  return list.map((el) => {
    if (!isGraphNodeElement(el) || !el.data) return el;
    const id = normalizeCharacterId(el.data.id);
    if (!id) return el;

    const resolved =
      resolveCharacterDisplayName(el.data, { bookId, lookup }) ||
      lookup.get(id) ||
      '';
    if (!resolved) return el;

    rememberCharacterDisplayName(bookId, id, resolved);
    const label = el.data.label;
    const common = el.data.common_name;
    const needsFix =
      !isUsableCharacterDisplayName(label, id) ||
      !isUsableCharacterDisplayName(common, id);

    if (!needsFix && label === resolved && common === resolved) return el;

    return {
      ...el,
      data: {
        ...el.data,
        label: resolved,
        name: resolved,
        common_name: resolved,
      },
    };
  });
}

export function enrichGraphPayload(payload, bookId) {
  if (!payload || typeof payload !== 'object') return payload;
  const characters = enrichGraphCharacters(payload.characters, { bookId });
  const next = { ...payload, characters };
  if (Array.isArray(payload.elements)) {
    next.elements = applyDisplayNamesToElements(payload.elements, { bookId, characters });
  }
  return next;
}
