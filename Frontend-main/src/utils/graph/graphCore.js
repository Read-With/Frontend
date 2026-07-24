/** 그래프 도메인 primitive, 관계 스키마, UI 상수, 챕터 라벨 */

import {
  resolveLastEventIdxForChapter,
  getLastEventIdxFromChapterData,
  getChapterData,
} from '../common/cache/manifestCache.js';
import {
  toPositiveNumberOrNull,
  toFiniteNumber,
} from '../common/valueUtils';
import { stripRedundantBookTitlePrefix } from '../viewer/viewerCore';
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

/** 챕터 마지막 이벤트 인덱스 (manifest 힌트, UI·범위용) */
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

  if (!manifestChapters?.length) return 1;

  const chapterNum = Number(chapter);
  const chapterInfo = manifestChapters.find(
    (ch) => ch && typeof ch === 'object' && Number(ch.idx) === chapterNum
  );

  if (!chapterInfo) return 1;

  const resolved = getLastEventIdxFromChapterData(chapterInfo);
  return resolved != null && resolved >= 1 ? resolved : 1;
};

export const GRAPH_LAYOUT_CONSTANTS = {
  SIDEBAR: { OPEN_WIDTH: 280, CLOSED_WIDTH: 56 },
  TOP_BAR_HEIGHT: 54,
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
  /** 초기/영역 맞춤 등장 애니메이션(ms) */
  FIT_DURATION_MS: 420,
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

/** 챕터 표시용 제목. 없으면 raw/display 모두 빈 문자열 */
function getChapterTitleParts(manifestBookId, chapterNum, bookTitle, manifestHint) {
  if (manifestBookId == null) {
    return { raw: '', display: '' };
  }
  const n = Number(chapterNum);
  if (!Number.isFinite(n) || n < 1) {
    return { raw: '', display: '' };
  }
  const ch = getChapterData(manifestBookId, n, manifestHint ?? undefined);
  const raw = String(ch?.title ?? '').trim();
  if (!raw) {
    return { raw: '', display: '' };
  }
  const display = stripRedundantBookTitlePrefix(raw, bookTitle).trim() || raw;
  return { raw, display };
}

export function resolveChapterDisplayTitle(manifestBookId, chapterNum, bookTitle, manifestHint) {
  return getChapterTitleParts(manifestBookId, chapterNum, bookTitle, manifestHint).display;
}

function collapseWhitespace(value) {
  return String(value ?? '')
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toComparable(value) {
  return collapseWhitespace(value).normalize('NFC');
}

function normalizeLabel(value) {
  return toComparable(value).toLowerCase();
}

function fallbackChapterLabel(idx) {
  const n = Number(idx);
  return Number.isFinite(n) && n >= 1 ? `제${n}장` : '제—장';
}

function isFallbackLabel(label) {
  return /^제[\d—]+장$/.test(toComparable(label));
}

/** 목록 라벨용: 책 제목을 전역 제거(prefix만이 아님). display 경로는 stripRedundantBookTitlePrefix 사용. */
function stripLeadingSep(text) {
  return collapseWhitespace(text.replace(/^[-–—:|/]+\s*/, ''));
}

function stripBookTitleFromText(label, bookTitle) {
  let text = toComparable(label);
  const book = toComparable(bookTitle);
  if (!text) return '';
  if (!book) return text;

  text = collapseWhitespace(
    text
      .replace(new RegExp(escapeRegExp(book), 'gi'), ' ')
      .replace(/^[-–—:|/]+\s*|\s*[-–—:|/]+$/g, '')
  );

  const textN = normalizeLabel(text);
  const bookN = normalizeLabel(book);
  if (textN === bookN) return '';
  if (textN.startsWith(bookN)) {
    text = stripLeadingSep(text.slice(book.length));
  }
  return text;
}

function cleanChapterListLabel(rawTitle, bookTitle) {
  const withoutChapterWord = collapseWhitespace(
    String(rawTitle ?? '').replace(/(?:chapter|ch\.?|챕터)\s*\d*\s*[:.-]?\s*/gi, ' ')
  );
  const label = stripBookTitleFromText(withoutChapterWord, bookTitle);
  const bookN = normalizeLabel(bookTitle);
  if (!label || (bookN && normalizeLabel(label) === bookN)) return '';
  return label;
}

function stripSharedListPrefix(labels, bookTitle) {
  const usable = labels
    .map((label) => toComparable(label))
    .filter((label) => label && !isFallbackLabel(label));
  if (usable.length < 2) return labels;

  let prefix = usable[0];
  for (let i = 1; i < usable.length; i += 1) {
    const next = usable[i];
    while (prefix && !next.toLowerCase().startsWith(prefix.toLowerCase())) {
      prefix = prefix.slice(0, -1);
    }
    if (!prefix) return labels;
  }

  prefix = toComparable(prefix.replace(/[-–—:|/]+\s*$/, ''));
  if (prefix.length < 2) return labels;

  const bookN = normalizeLabel(bookTitle);
  const prefixN = normalizeLabel(prefix);
  const matchesBook =
    !!bookN && (prefixN === bookN || prefixN.startsWith(bookN) || bookN.startsWith(prefixN));
  const hasSepAfterPrefix = usable.every((label) => {
    if (normalizeLabel(label) === prefixN) return true;
    return /^[-–—:|/\s]/.test(label.slice(prefix.length));
  });
  if (!matchesBook && !(prefix.length >= 6 && hasSepAfterPrefix)) return labels;

  return labels.map((label) => {
    const text = toComparable(label);
    if (!text || isFallbackLabel(text)) return text;
    if (normalizeLabel(text) === prefixN) return '';
    if (!text.toLowerCase().startsWith(prefix.toLowerCase())) return text;
    return stripLeadingSep(text.slice(prefix.length));
  });
}

function stripChapterOrdinalPrefix(label, chapter) {
  const text = String(label || '').trim();
  if (!text || !Number.isFinite(chapter) || chapter < 1) return text;
  const n = String(chapter);
  const patterns = [
    new RegExp(`^제\\s*${n}\\s*장\\s*[:.\\-–—]?\\s*`, 'i'),
    new RegExp(`^챕터\\s*${n}\\s*[:.\\-–—]?\\s*`, 'i'),
    new RegExp(`^chapter\\s*${n}\\s*[:.\\-–—]?\\s*`, 'i'),
    new RegExp(`^${n}\\s*[.\\-–—:]\\s+`, 'i'),
  ];
  let out = text;
  for (const re of patterns) {
    const next = out.replace(re, '').trim();
    if (next) out = next;
  }
  return out || text;
}

/** 챕터 사이드바 목록용 라벨/툴팁 */
export function buildChapterSidebarItems(chapterList, manifestBookId, bookTitle, manifestHint) {
  const rows = chapterList.map((chapter) => {
    const { raw } = getChapterTitleParts(manifestBookId, chapter, bookTitle, manifestHint);
    const idxStr = Number.isFinite(chapter) && chapter >= 1 ? String(chapter) : '—';
    const chData =
      manifestBookId != null && Number.isFinite(chapter) && chapter >= 1
        ? getChapterData(manifestBookId, chapter, manifestHint ?? undefined)
        : null;
    const events = Array.isArray(chData?.events) ? chData.events : null;
    // manifest에 events가 있을 때만 판정. 없으면 unknown(표시만, dim 안 함)
    const hasGraph = events == null ? null : events.length > 0;
    const eventCount = events == null ? null : events.length;

    if (!raw) {
      return {
        chapter,
        label: fallbackChapterLabel(chapter),
        tooltip: manifestBookId == null || !Number.isFinite(chapter) || chapter < 1
          ? idxStr
          : `챕터 ${idxStr}`,
        hasGraph,
        eventCount,
      };
    }
    return {
      chapter,
      label: cleanChapterListLabel(raw, bookTitle) || fallbackChapterLabel(chapter),
      tooltip: `챕터 ${idxStr} — ${raw}`,
      hasGraph,
      eventCount,
    };
  });

  const stripped = stripSharedListPrefix(rows.map((row) => row.label), bookTitle);
  return rows.map((row, index) => {
    const base = stripped[index] || fallbackChapterLabel(row.chapter);
    return {
      ...row,
      label: stripChapterOrdinalPrefix(base, row.chapter) || base,
    };
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
    const relationSource =
      (Array.isArray(raw.relation) && raw.relation.length > 0 && raw.relation) ||
      (Array.isArray(raw.latestLabels) && raw.latestLabels.length > 0 && raw.latestLabels) ||
      raw.relation;
    const relationArray = normalizeRelationArray(relationSource);

    const label = relationArray[0] || (typeof raw.label === 'string' ? raw.label : '');

    return { id1, id2, positivity, weight, count, relation: relationArray, label };
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
