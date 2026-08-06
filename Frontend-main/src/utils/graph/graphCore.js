/** 그래프 도메인 primitive, 관계 스키마, UI 상수, 챕터 라벨 */

import {
  resolveLastEventIdxForChapter,
  getLastEventIdxFromChapterData,
  getChapterData,
  getManifestFromCache,
} from '../common/cache/manifestCache.js';
import { getProgressFromCache } from '../common/cache/progressCache.js';
import {
  toPositiveNumberOrNull,
  toPositiveNumberFromId,
  toFiniteNumber,
  toNumberOrNull,
  toTrimmedStringOrNull,
  asArray,
  clampPositivity,
} from '../common/valueUtils';
import {
  formatFallbackChapterLabel,
  resolveChapterTitleMeta,
  stripSharedListPrefix,
  stripChapterOrdinalPrefix,
  eventUtils,
} from '../viewer/viewerCore.js';

/* ─── 요소 ID · 타입 판별 ─── */

const API_PREFIX = 'api:';

export const directedEdgeElementId = (fromId, toId) => `${String(fromId)}->${String(toId)}`;

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

/** uniqueStrings → 정렬 후 join (태그 fingerprint 등) */
export function sortedUniqueJoin(values, sep = '\x1e', options) {
  return uniqueStrings(values, options).sort().join(sep);
}

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

/** 라벨 history 조회/머지용 정규 키 (대소문자 무시) */
function labelHistoryLookupKey(text) {
  return String(text ?? '').trim().toLowerCase();
}

/** eventId·ordinal에서 상대 순서 힌트 (작을수록 이른 등장) */
export function labelEventOrderHint(eventId, ordinal) {
  // Number(null) === 0 이므로 null ordinal은 무시
  if (ordinal != null && Number.isFinite(Number(ordinal))) return Number(ordinal);
  return toPositiveNumberFromId(eventId);
}

function pickEarlierLabelFirst(a, b) {
  const ordA = labelEventOrderHint(a?.firstEventId, a?.firstEventOrdinal);
  const ordB = labelEventOrderHint(b?.firstEventId, b?.firstEventOrdinal);
  if (ordA != null && ordB != null) return ordA <= ordB ? a : b;
  if (ordA != null) return a;
  if (ordB != null) return b;
  if (a?.firstPositivity != null) return a;
  return b;
}

function pickLaterLabelLast(a, b) {
  const ordA = labelEventOrderHint(a?.lastEventId, a?.lastEventOrdinal);
  const ordB = labelEventOrderHint(b?.lastEventId, b?.lastEventOrdinal);
  if (ordA != null && ordB != null) return ordA >= ordB ? a : b;
  if (ordB != null) return b;
  if (ordA != null) return a;
  if (b?.lastPositivity != null) return b;
  return a;
}

function normalizeLabelHistoryMeta(text, meta) {
  const ordinalFirst =
    meta?.firstEventOrdinal != null
      ? Number(meta.firstEventOrdinal)
      : labelEventOrderHint(meta?.firstEventId, null);
  const ordinalLast =
    meta?.lastEventOrdinal != null
      ? Number(meta.lastEventOrdinal)
      : labelEventOrderHint(meta?.lastEventId, null);
  return {
    text: meta?.text || text,
    firstEventId: meta?.firstEventId ?? null,
    lastEventId: meta?.lastEventId ?? null,
    firstPositivity: meta?.firstPositivity != null ? Number(meta.firstPositivity) : null,
    lastPositivity: meta?.lastPositivity != null ? Number(meta.lastPositivity) : null,
    firstEventOrdinal: Number.isFinite(ordinalFirst) ? ordinalFirst : null,
    lastEventOrdinal: Number.isFinite(ordinalLast) ? ordinalLast : null,
  };
}

/** 양방향·중복 키를 대소문자 무시로 합치고, 더 이른 first / 더 늦은 last 유지 */
export function mergeRelationLabelHistory(a, b) {
  const byKey = new Map();

  const ingest = (history) => {
    for (const [text, meta] of Object.entries(history && typeof history === 'object' ? history : {})) {
      if (!text || !meta || typeof meta !== 'object') continue;
      const key = labelHistoryLookupKey(text);
      const normalized = normalizeLabelHistoryMeta(text, meta);
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, normalized);
        continue;
      }
      const firstSrc = pickEarlierLabelFirst(prev, normalized);
      const lastSrc = pickLaterLabelLast(prev, normalized);
      byKey.set(key, {
        text: prev.text || normalized.text || text,
        firstEventId: firstSrc.firstEventId ?? null,
        lastEventId: lastSrc.lastEventId ?? null,
        firstPositivity:
          firstSrc.firstPositivity != null ? firstSrc.firstPositivity : lastSrc.firstPositivity,
        lastPositivity:
          lastSrc.lastPositivity != null ? lastSrc.lastPositivity : firstSrc.lastPositivity,
        firstEventOrdinal: firstSrc.firstEventOrdinal ?? null,
        lastEventOrdinal: lastSrc.lastEventOrdinal ?? null,
      });
    }
  };

  ingest(a);
  ingest(b);

  const out = {};
  for (const meta of byKey.values()) {
    out[meta.text] = meta;
  }
  return out;
}

/**
 * deltas accumulate용: 현재 이벤트 라벨을 history에 증분 반영
 * apply 순서 기준 — last*는 항상 현재 이벤트로 덮음 (ordinal 비교 없음)
 */
export function appendRelationLabelHistory(prevHistory, labels, eventId, positivity) {
  const next = { ...(prevHistory && typeof prevHistory === 'object' ? prevHistory : {}) };
  const pos = Number.isFinite(Number(positivity)) ? Number(positivity) : 0;
  const ordinal = toPositiveNumberFromId(eventId);

  const findExistingKey = (text) => {
    if (Object.prototype.hasOwnProperty.call(next, text)) return text;
    const lower = text.toLowerCase();
    return Object.keys(next).find((k) => k.toLowerCase() === lower) ?? null;
  };

  for (const raw of asArray(labels)) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const existingKey = findExistingKey(text);
    if (!existingKey) {
      next[text] = {
        text,
        firstEventId: eventId,
        lastEventId: eventId,
        firstPositivity: pos,
        lastPositivity: pos,
        firstEventOrdinal: ordinal,
        lastEventOrdinal: ordinal,
      };
      continue;
    }
    const existing = next[existingKey];
    next[existingKey] = {
      ...existing,
      text: existing.text || text,
      lastEventId: eventId ?? existing.lastEventId,
      lastPositivity: pos,
      lastEventOrdinal: ordinal ?? existing.lastEventOrdinal ?? null,
    };
  }
  return next;
}

function indexLabelHistoryByLower(history) {
  const map = new Map();
  if (!history || typeof history !== 'object') return map;
  for (const [text, meta] of Object.entries(history)) {
    if (!meta || typeof meta !== 'object') continue;
    const key = labelHistoryLookupKey(text);
    if (!map.has(key)) map.set(key, meta);
  }
  return map;
}

/**
 * 툴팁용 관계 태그 + 시점(tone) + 긍정도 색
 * tone: added(현재 이벤트에서 최초 추가) | changed(이전에도 있고 현재에 재등장/갱신) | prior(과거)
 * 색: 라벨별 첫 등장 시점 positivity로 고정 (이후 간선 긍정도 변화와 무관)
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
  const historyByLower = indexLabelHistoryByLower(history);
  const latestSet = new Set(
    normalizeRelationArray(latestLabels).map((t) => t.toLowerCase())
  );
  const currentId = currentEventId != null ? String(currentEventId) : null;
  const fallback =
    fallbackPositivity == null || fallbackPositivity === ''
      ? null
      : Number(fallbackPositivity);

  return tags.map((text, index) => {
    const meta = history[text] ?? historyByLower.get(labelHistoryLookupKey(text)) ?? null;
    const inLatest = latestSet.has(text.toLowerCase());
    let tone = 'prior';
    if (meta && currentId) {
      const firstId = meta.firstEventId != null ? String(meta.firstEventId) : null;
      const lastId = meta.lastEventId != null ? String(meta.lastEventId) : null;
      if (lastId === currentId) {
        tone = firstId === currentId ? 'added' : 'changed';
      }
    } else if (!meta && inLatest) {
      // history 없는 옛 캐시: 이번 델타 라벨이면 현재 간선값이 첫등장에 가깝다고 본다
      tone = index === tags.length - 1 ? 'changed' : 'added';
    }

    // 라벨별 첫 등장 색 고정. history 없거나 first만 비면:
    // - 이번 추가(added) → 현재 간선 positivity (첫등장 ≈ 현재)
    // - 그 외 → lastPositivity → 간선 fallback
    let positivityRaw = meta?.firstPositivity;
    if (positivityRaw == null) {
      if (!meta && tone === 'added') {
        positivityRaw = fallback;
      } else {
        positivityRaw = meta?.lastPositivity ?? fallback;
      }
    }
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
  /** 노드/엣지 툴팁 및 관련 오버레이 공통 z-index */
  Z_INDEX_TOOLTIP: 99999,
};

/** Cytoscape 뷰포트 줌 (휠·버튼·초기 fit 공통) */
export const GRAPH_ZOOM = {
  STEP: 1.25,
  /** 마우스 휠 한 단계의 확대·축소 변화량. 낮을수록 더 세밀하다. */
  WHEEL_SENSITIVITY: 0.25,
  MIN: 0.2,
  /** 소규모 그래프가 화면에 가깝게 채워지도록 상한을 넉넉히 */
  MAX: 3.2,
  /** cy.fit 여백 — 가장자리 여유 (작을수록 그래프가 크게 보임) */
  FIT_PADDING: 32,
  /** 최초/챕터 fit 전용 여백 */
  FIT_PADDING_INITIAL: 24,
  /** 초기 fit 후 살짝 줌인 (1 = 추가 없음). 라벨이 살짝 잘려도 본체가 읽히게 */
  FIT_FILL: 1.1,
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

/** manifest / structure / delta 이벤트에서 eventId 추출 */
export function resolveManifestEventId(ev) {
  return toTrimmedStringOrNull(eventUtils.resolveEventId(ev) ?? ev?.eventId ?? ev?.id);
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
        latestLabels: r.latestLabels,
        labelHistory: r.labelHistory,
        latestEventId: r.latestEventId,
        label: r.label,
        ...relationEventMetaPassthrough(raw),
      }));
  } catch {
    return [];
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

function normalizeCharacterId(value) {
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

function rememberCharacterDisplayNames(bookId, characters) {
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
function buildCharacterDisplayNameLookup(bookId, characters = null) {
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

function resolveCharacterDisplayName(characterOrId, { bookId, lookup = null } = {}) {
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

/** 상단 메타·스크러버 공통: `Event 3` / `Event ?` */
export function formatGraphEventMetaLabel(eventNum, { unknown = '?' } = {}) {
  const n = Number(eventNum);
  if (Number.isFinite(n) && n > 0) return `Event ${Math.trunc(n)}`;
  return `Event ${unknown}`;
}

/** 챕터 manifest events → 정렬된 eventIdx 목록 */
export function listChapterEventIndices(bookId, chapter, manifestHint) {
  if (bookId == null) return [];
  const ch = getChapterData(bookId, chapter, manifestHint);
  const events = Array.isArray(ch?.events) ? ch.events : [];
  const nums = [];
  const seen = new Set();
  for (const ev of events) {
    const n = eventUtils.resolveEventNum(ev);
    if (n > 0 && !seen.has(n)) {
      seen.add(n);
      nums.push(n);
    }
  }
  nums.sort((a, b) => a - b);
  return nums;
}

/** 진도 캐시 기준, 해당 챕터의 읽기 중 사건 번호 */
export function resolveReadingEventNumForChapter(bookId, chapter) {
  if (bookId == null) return null;
  const progress = getProgressFromCache(bookId);
  if (!progress) return null;
  const ch = Number(progress.chapterIdx);
  const ev = Number(progress.eventNum);
  if (ch === Number(chapter) && Number.isFinite(ev) && ev > 0) {
    return Math.trunc(ev);
  }
  return null;
}

/* ─── 노드 툴팁 · 관계 분석 연결 상태 ─── */

export const RELATION_CONNECTION_KIND = Object.freeze({
  SUFFICIENT: 'sufficient_connections',
  SINGLE: 'single_connection',
  PAIR: 'pair_connections',
  NONE: 'no_connections',
  ERROR: 'load_error',
});

/** 레이더 연결 수 → 모달 connectionKind */
export function resolveRelationConnectionKind(connectionCount, { hasError = false, enabled = true } = {}) {
  if (!enabled) return RELATION_CONNECTION_KIND.NONE;
  if (hasError) return RELATION_CONNECTION_KIND.ERROR;
  const n = Number(connectionCount) || 0;
  if (n === 0) return RELATION_CONNECTION_KIND.NONE;
  if (n === 1) return RELATION_CONNECTION_KIND.SINGLE;
  if (n === 2) return RELATION_CONNECTION_KIND.PAIR;
  return RELATION_CONNECTION_KIND.SUFFICIENT;
}

/** POV/레이더 뷰 상태 (FETCH_STATUS.EMPTY와 구분) */
export const NODE_TOOLTIP_VIEW_STATUS = Object.freeze({
  NO_DATA: 'no-data',
  OK: 'ok',
  ERROR: 'error',
  LOADING: 'loading',
  READY: 'ready',
  PENDING: 'pending',
});

export function normalizeMatchName(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function collectNodeMatchNames(node) {
  const names = [];
  const push = (v) => {
    if (typeof v !== 'string') return;
    const n = normalizeMatchName(v);
    if (n) names.push(n);
  };
  push(node?.common_name);
  push(node?.label);
  push(node?.displayName);
  push(node?.name);
  if (Array.isArray(node?.names)) {
    node.names.forEach(push);
  }
  return [...new Set(names)];
}

/** id/이름 비교용 문자열 */
export function normalizeGraphIdString(value) {
  if (value == null) return '';
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.trunc(value)) : '';
  }
  return String(value).trim();
}

export function buildNodeIdentityContext(nodeLike) {
  const normalizedNodeId = normalizeGraphIdString(nodeLike?.id);
  return {
    normalizedNodeId,
    nodeIdNum: toNumberOrNull(normalizedNodeId),
    normalizedNodeName: normalizeGraphIdString(
      nodeLike?.common_name ?? nodeLike?.label ?? nodeLike?.name,
    ),
  };
}

export function isSameNodeIdentifier(candidate, idCtx) {
  if (!candidate || !idCtx) return false;
  const candidateId =
    candidate.id ??
    candidate.character_id ??
    candidate.characterId ??
    candidate.char_id ??
    candidate.pk ??
    candidate.node_id;
  const candidateName =
    candidate.common_name ?? candidate.name ?? candidate.label ?? candidate.displayName;

  const candidateIdStr = normalizeGraphIdString(candidateId);
  if (candidateIdStr && idCtx.normalizedNodeId && candidateIdStr === idCtx.normalizedNodeId) {
    return true;
  }

  const candidateIdNum = toNumberOrNull(candidateIdStr);
  if (candidateIdNum !== null && idCtx.nodeIdNum !== null && candidateIdNum === idCtx.nodeIdNum) {
    return true;
  }

  const candidateNameStr = normalizeGraphIdString(candidateName);
  return !!(
    candidateNameStr &&
    idCtx.normalizedNodeName &&
    candidateNameStr === idCtx.normalizedNodeName
  );
}

/** 무방향 관계 목록 (동일 쌍 1회) */
export function collectUndirectedRelations(rawRelations, targetNodeId = null) {
  const relationMap = new Map();
  const targetStr = targetNodeId != null ? String(targetNodeId) : null;

  asArray(rawRelations).forEach((rel) => {
    const id1 = rel.id1 ?? rel.source;
    const id2 = rel.id2 ?? rel.target;
    if (id1 == null || id2 == null) return;
    if (targetStr != null && String(id1) !== targetStr && String(id2) !== targetStr) return;

    const key = undirectedPairKey(id1, id2);
    if (relationMap.has(key)) return;

    const positivityRaw = toFiniteNumber(rel.positivity);
    relationMap.set(key, {
      id1,
      id2,
      relation: rel.relation || ['관계'],
      count: rel.count || rel.strength || 1,
      positivity: Number.isFinite(positivityRaw) ? clampPositivity(positivityRaw) : 0,
    });
  });

  return Array.from(relationMap.values());
}

/** 툴팁용 노드 표시 모델 */
export function buildProcessedNode(data) {
  const raw = (data && (data.id || data.label))
    ? data
    : (data?.data || { id: data?.id, label: data?.label });
  if (!raw) return null;

  // personalityText만 표시 (profileText/프롬프트 폴백 금지)
  const description = String(raw.personalityText || raw.description || '').trim();
  return {
    ...raw,
    names: normalizeRelationArray(raw.names || [], raw.common_name),
    displayName: raw.common_name || raw.label || 'Unknown',
    hasImage: !!raw.image,
    isMainCharacter: !!raw.isMainCharacter,
    description,
  };
}

const POV_SPOILER_SESSION_KEY = 'readwith:pov-spoiler-unlocked';

/** @deprecated 세션 유지 안 함 — 선택 해제 후 안내 문구가 다시 보이도록 false 고정 */
export function readPovSpoilerUnlocked() {
  return false;
}

/** @deprecated 세션에 저장하지 않음 */
export function unlockPovSpoilerSession() {
  clearPovSpoilerSession();
}

export function clearPovSpoilerSession() {
  try {
    sessionStorage.removeItem(POV_SPOILER_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @returns {{ text: string, status: string }}
 */
export function resolvePovSummary(
  node,
  currentChapter,
  povSummaries,
  povError = null,
  { isLoading = false, povCached = null } = {},
) {
  const S = NODE_TOOLTIP_VIEW_STATUS;
  if (!node) {
    return {
      text: '해당 챕터에서는 해당 캐릭터의 등장 비중이 낮아 별도의 분석 내용이 제공되지 않습니다.',
      status: S.NO_DATA,
    };
  }

  if (isLoading) {
    return { text: '시점 요약을 불러오는 중…', status: S.LOADING };
  }

  if (povError) {
    return {
      text: typeof povError === 'string' ? povError : '관점 요약을 불러오지 못했습니다.',
      status: S.ERROR,
    };
  }

  const list = povSummaries?.povSummaries;
  if (Array.isArray(list) && list.length > 0) {
    const nodeId = Number(node.id);
    let match = Number.isFinite(nodeId)
      ? list.find((s) => Number(s.characterId) === nodeId)
      : null;
    if (!match) {
      const names = collectNodeMatchNames(node);
      match = list.find((s) => names.includes(normalizeMatchName(s.characterName)));
    }
    const summaryText = typeof match?.summaryText === 'string' ? match.summaryText.trim() : '';
    if (summaryText) {
      return { text: summaryText, status: S.READY };
    }
  }

  const chapterLabel = currentChapter || 1;
  if (povCached === false) {
    return {
      text: `${node.displayName}의 챕터 ${chapterLabel} 시점 요약은 아직 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.`,
      status: S.PENDING,
    };
  }

  return {
    text: `${node.displayName}에 대한 챕터 ${chapterLabel} 시점 요약이 아직 준비되지 않았습니다.`,
    status: S.PENDING,
  };
}
