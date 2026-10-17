/** 그래프 도메인 기반: element 판별·eventUtils·캐시 키 · 인물 id·표시 이름 · 관계 스키마 · 공용 UI 상수 (다른 graph 모듈에 의존하지 않음) */

import {
  asArray,
  toPositiveNumberFromId,
  toNumberOrNull,
  toTrimmedStringOrNull,
  clampPositivity,
  compareLocale,
  resolveEventId,
  resolveEventNum,
  resolveEventChapterIndex,
} from '../common/valueUtils';
import { getManifestFromCache } from '../common/cache/manifestCache.js';

/* ─── 그래프 도메인 primitive: element 판별, eventUtils, 캐시 키 ─── */

export const isGraphEdgeElement = (element) =>
  Boolean(element?.data && element.data.source !== undefined && element.data.target !== undefined);

export const isGraphNodeElement = (element) =>
  Boolean(element?.data && element.data.id !== undefined && !isGraphEdgeElement(element));

/** elements → relations 변환 시 공통 옵션 (표시용) */
export const ELEMENTS_TO_RELATIONS_OPTS = {
  includeLabel: true,
  includeCount: false,
  positivityDefault: null,
};

function chapterNumOf(event) {
  return Number(resolveEventChapterIndex(event));
}

function chapterNumOrZero(event) {
  return Number(resolveEventChapterIndex(event) ?? 0);
}

function compareByEventNum(a, b) {
  return resolveEventNum(a) - resolveEventNum(b);
}

function compareByChapterThenEvent(a, b) {
  const chapterA = chapterNumOrZero(a);
  const chapterB = chapterNumOrZero(b);
  if (chapterA !== chapterB) return chapterA - chapterB;
  return compareByEventNum(a, b);
}

export const eventUtils = {
  resolveRelationNodeIds: (relation) => {
    if (!relation || typeof relation !== 'object') return { id1: null, id2: null };
    const id1 = relation.id1 ?? relation.source ?? null;
    const id2 = relation.id2 ?? relation.target ?? null;
    return {
      id1: id1 != null ? String(id1) : null,
      id2: id2 != null ? String(id2) : null,
    };
  },

  convertElementsToRelations: (elements, options = {}) => {
    if (!Array.isArray(elements) || elements.length === 0) return [];

    const { includeLabel = false, includeCount = true, positivityDefault = null } = options;

    return elements
      .filter(isGraphEdgeElement)
      .map((edge) => {
        const relation = {
          id1: edge.data.source,
          id2: edge.data.target,
          relation: Array.isArray(edge.data.relation) ? [...edge.data.relation] : [],
          positivity:
            typeof edge.data.positivity === 'number' ? edge.data.positivity : positivityDefault,
        };
        if (includeLabel) relation.label = edge.data.label || '';
        if (includeCount) relation.count = edge.data.count || 1;
        return relation;
      });
  },

  updateEventsInState: (prevEvents, newEvent, targetChapter) =>
    eventUtils.mergeEventsInState(prevEvents, [newEvent], targetChapter),

  /** 같은 순번은 병합, 없으면 추가 — 여러 건을 한 번에 (건별 filter·정렬 반복 없음) */
  mergeEventsInState: (prevEvents, newEvents, targetChapter) => {
    const previous = asArray(prevEvents);
    const otherChapterEvents = previous.filter(
      (evt) => chapterNumOf(evt) !== targetChapter
    );
    // 정렬은 마지막 1회 — 안정 정렬이라 같은 순번 중 "처음 것"은 원래 순서 기준으로 동일
    const current = previous.filter((evt) => chapterNumOf(evt) === targetChapter);

    const indexByNum = new Map();
    current.forEach((evt, idx) => {
      const num = resolveEventNum(evt);
      if (!indexByNum.has(num)) indexByNum.set(num, idx);
    });
    for (const newEvent of asArray(newEvents)) {
      const num = resolveEventNum(newEvent);
      const existingIdx = indexByNum.get(num);
      if (existingIdx != null) {
        current[existingIdx] = { ...current[existingIdx], ...newEvent };
      } else {
        indexByNum.set(num, current.length);
        current.push(newEvent);
      }
    }

    return [...otherChapterEvents, ...current].sort(compareByChapterThenEvent);
  },
};

export const cacheKeyUtils = {
  createChapterKey: (bookId, chapter) => `${bookId}-${chapter}`,
  createEventKey: (bookId, chapter, eventIdx) => `${bookId}-${chapter}-${eventIdx}`,
  createCacheKey: (chapter, eventIdx) => `${chapter}-${eventIdx}`,
  macroGraphStorage: (bookId, chapter) => `graph_macro_${Number(bookId)}_upto_${Number(chapter)}`,
  macroSession: (bookId, chapter) => `${Number(bookId)}:${Number(chapter)}`,
};

/* ─── 인물 id·표시 이름: 이름 고르기·기억(책별)·manifest 조회·elements/payload에 표시 이름 반영 ─── */

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

/** id·표시 이름이 모두 있는 인물만 fn(id, name) 호출 */
/** id가 있는 인물만 visit(char, id) */
export function forEachIdentifiedCharacter(characters, visit) {
  asArray(characters).forEach((char) => {
    const id = char ? extractCharacterId(char) : null;
    if (id) visit(char, id);
  });
}

function forEachCharacterName(characters, fn) {
  forEachIdentifiedCharacter(characters, (char, id) => {
    const name = pickCharacterDisplayName(char);
    if (name) fn(id, name);
  });
}

function rememberCharacterDisplayNames(bookId, characters) {
  forEachCharacterName(characters, (id, name) => rememberCharacterDisplayName(bookId, id, name));
}

export function lookupRememberedCharacterDisplayName(bookId, characterId) {
  const id = normalizeCharacterId(characterId);
  if (!id) return '';
  return getMemoryMap(bookId)?.get(id) || '';
}

// manifest 객체는 캐시 후 변경하지 않음 — 객체 identity 기준 메모 (인물·요소마다 Map 재생성 방지)
const manifestNameLookupMemo = new WeakMap();

/** 읽기 전용 공유 Map (없으면 null) — 변경 금지 */
function getManifestCharacterNameLookup(bookId) {
  if (bookId == null || bookId === '') return null;
  const manifest = getManifestFromCache(bookId);
  if (!manifest || typeof manifest !== 'object') return null;
  let lookup = manifestNameLookupMemo.get(manifest);
  if (!lookup) {
    lookup = new Map();
    forEachCharacterName(manifest.characters, (id, name) => lookup.set(id, name));
    manifestNameLookupMemo.set(manifest, lookup);
  }
  return lookup;
}

/** 호출부가 변경해도 되는 복사본 */
export function buildManifestCharacterNameLookup(bookId) {
  return new Map(getManifestCharacterNameLookup(bookId));
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
  forEachCharacterName(characters, (id, name) => lookup.set(id, name));
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

  const fromManifest = getManifestCharacterNameLookup(bookId)?.get(id);
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

/* ─── element id·관계 라벨 이력·태그 표시 · 공용 UI 상수 ─── */

export const directedEdgeElementId = (fromId, toId) => `${String(fromId)}->${String(toId)}`;

export const normalizeElementId = (element) => element?.id ?? element?.data?.id ?? null;

/** 무방향 노드 쌍 키 (순서 무관) */
export function undirectedPairKey(s, t) {
  const a = String(s);
  const b = String(t);
  return a < b ? `${a}\x1e${b}` : `${b}\x1e${a}`;
}

export const sortElementsByDataId = (elements) => {
  if (!Array.isArray(elements)) return [];
  return [...elements].sort((a, b) =>
    compareLocale(String(a?.data?.id ?? ''), String(b?.data?.id ?? ''))
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

  // 소문자 → 원래 key (먼저 들어온 key 우선). 라벨마다 Object.keys 전체를 훑지 않도록 1회 구성
  let keyByLower = null;
  const findExistingKey = (text) => {
    if (Object.prototype.hasOwnProperty.call(next, text)) return text;
    if (!keyByLower) {
      keyByLower = new Map();
      for (const k of Object.keys(next)) {
        const lk = k.toLowerCase();
        if (!keyByLower.has(lk)) keyByLower.set(lk, k);
      }
    }
    return keyByLower.get(text.toLowerCase()) ?? null;
  };

  for (const raw of asArray(labels)) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const existingKey = findExistingKey(text);
    if (!existingKey) {
      const lower = text.toLowerCase();
      if (keyByLower && !keyByLower.has(lower)) keyByLower.set(lower, text);
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

export const GRAPH_LAYOUT_CONSTANTS = {
  SIDEBAR: { OPEN_WIDTH: 280, CLOSED_WIDTH: 56 },
  /** .graph-page-topbar(2.75rem) + 여백 — 관계 분석 모달 top 기준 */
  PAGE_CHROME_OFFSET: 60,
  /** 관계 분석(레이더) 모달 — 챕터 레일·상단바로부터의 여백 */
  ANALYSIS_MODAL_INSET: 16,
  /** GraphPageSidebar 툴팁 사이드바 실제 너비와 동일해야 센터링이 맞음 */
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
  FIT_PADDING: 44,
  /** 최초/챕터 fit 전용 여백 — 등장 시 노드·간선이 캔버스 가장자리에 닿지 않도록 충분히 확보 */
  FIT_PADDING_INITIAL: 44,
  /** 초기 fit 후 추가 줌인 배율 (1 = 추가 없음).
   *  1보다 크면 fit 이후 화면 밖으로 나가는 노드가 재보정 없이 방치되므로 1로 고정 */
  FIT_FILL: 1,
  /** 초기/영역 맞춤 — 짧게 유지해 등장감 완화 */
  FIT_DURATION_MS: 140,
};

/** 표시 순서: 주요 → 주변 → 전체 (value는 filterMainCharacters와 동일) */
export const GRAPH_CHARACTER_FILTER_STAGE_OPTIONS = [
  { value: 1, label: '주요', title: '핵심 인물과 그들 사이 관계만' },
  { value: 2, label: '주변', title: '핵심 + 직접 연결된 인물' },
  { value: 0, label: '전체', title: '모든 인물' },
];

export const getCharacterFilterStageLabel = (stage) =>
  GRAPH_CHARACTER_FILTER_STAGE_OPTIONS.find((o) => o.value === stage)?.label;

/* ─── 관계 정규화 · 태그 · 레이더 ─── */

export function normalizeRelation(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  const id1 = toNumberOrNull(raw.id1);
  const id2 = toNumberOrNull(raw.id2);

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
    (typeof raw.label === 'string' ? raw.label.trim() : '');

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
}

export function isSamePair(rel, a, b) {
  if (!rel || typeof rel !== 'object') {
    return false;
  }

  const r1 = toNumberOrNull(rel.id1);
  const r2 = toNumberOrNull(rel.id2);
  const s1 = toNumberOrNull(a);
  const s2 = toNumberOrNull(b);

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
  return toTrimmedStringOrNull(resolveEventId(ev));
}

export function processRelations(relations) {
  if (!Array.isArray(relations) || relations.length === 0) {
    return [];
  }

  return relations
    .map((raw) => ({ raw, norm: normalizeRelation(raw) }))
    .filter(({ norm }) => norm != null)
    .map(({ raw, norm }) => ({ ...norm, ...relationEventMetaPassthrough(raw) }));
}

/* ─── 노드 툴팁 · 관계 분석 연결 상태 ─── */

export const RELATION_CONNECTION_KIND = Object.freeze({
  SUFFICIENT: 'sufficient_connections',
  SINGLE: 'single_connection',
  PAIR: 'pair_connections',
  NONE: 'no_connections',
  ERROR: 'load_error',
});

/** POV/레이더 뷰 상태 */
export const NODE_TOOLTIP_VIEW_STATUS = Object.freeze({
  NO_DATA: 'no-data',
  OK: 'ok',
  ERROR: 'error',
  LOADING: 'loading',
  READY: 'ready',
  PENDING: 'pending',
});

/** id/이름 비교용 문자열 */
function normalizeGraphIdString(value) {
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
    normalizedNodeName: normalizeGraphIdString(pickCharacterDisplayName(nodeLike)),
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
  const candidateName = pickCharacterDisplayName(candidate);

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

    const positivityRaw = toNumberOrNull(rel.positivity);
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
