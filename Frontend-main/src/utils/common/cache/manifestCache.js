import { normalizeManifestBook } from '../bookNormalize';
import { sanitizeAssetUrl } from '../urlUtils';
import {
  asArray,
  toNumberOrNull,
  toOneBasedChapterIndexOrNull,
  toPositiveInt,
  errorUtils,
  stringOrEmpty,
  resolveEventId,
  resolveEventNum,
  sortEventsByIdx,
} from '../valueUtils';
import {
  setBounded,
  loadTtlStorage,
  saveToStorage,
  MANIFEST_CACHE_PREFIX,
  MANIFEST_TTL_MS,
} from './cacheManager';

const toFiniteNumberArray = (values) =>
  (asArray(values))
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));

const normalizeTextSpan = (startValue, endValue) => {
  const start = toNumberOrNull(startValue) ?? 0;
  const endRaw = toNumberOrNull(endValue);
  const end = endRaw != null && endRaw >= start ? endRaw : start;
  return { start, end };
};

const parseManifestJsonNumberArray = (value) => {
  if (Array.isArray(value)) return toFiniteNumberArray(value);
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    return toFiniteNumberArray(JSON.parse(value));
  } catch {
    return [];
  }
};

const normalizeEvent = (event) => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const idx = toNumberOrNull(event.idx);
  if (idx == null || idx < 1) return null;
  const apiNum = toNumberOrNull(event.eventNum);
  const eventNum = apiNum != null && apiNum >= 1 ? apiNum : idx;
  const eventIdRaw = event.eventId ?? event.id ?? idx;
  const { start, end } = normalizeTextSpan(event.startTxtOffset, event.endTxtOffset);
  return {
    idx,
    eventIdx: idx,
    eventNum,
    eventId: eventIdRaw != null ? String(eventIdRaw) : '',
    startTxtOffset: start,
    endTxtOffset: end,
    startPos: start,
    endPos: end,
    rawText: stringOrEmpty(event.rawText),
  };
};

const normalizeChapter = (chapter) => {
  if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) return null;
  const idx = toNumberOrNull(chapter.idx);
  if (idx == null || idx < 1) return null;

  const title = stringOrEmpty(chapter.title);
  const navTitle =
    typeof chapter.navTitle === 'string'
      ? chapter.navTitle
      : stringOrEmpty(chapter.navLabel);
  const tocTitle =
    typeof chapter.tocTitle === 'string'
      ? chapter.tocTitle
      : stringOrEmpty(chapter.tocLabel);
  const paragraphStarts = parseManifestJsonNumberArray(chapter.paragraphStartsJson);
  const paragraphLengths = parseManifestJsonNumberArray(chapter.paragraphLengthsJson);
  const paragraphCount = toNumberOrNull(chapter.paragraphCount) ?? 0;
  const totalCodePoints = toNumberOrNull(chapter.totalCodePoints) ?? 0;
  const startPos = toNumberOrNull(chapter.startPos) ?? 0;
  const endPos = toNumberOrNull(chapter.endPos) ?? startPos;
  const normalizedEvents = Array.isArray(chapter.events)
    ? chapter.events.map((ev) => normalizeEvent(ev)).filter(Boolean)
    : [];
  const sortedEvents = sortEventsByIdx(normalizedEvents);
  const firstEvent = sortedEvents[0] ?? null;
  const lastEvent = sortedEvents.length > 0 ? sortedEvents[sortedEvents.length - 1] : null;
  const normalizedStartPos = startPos > 0 ? startPos : (firstEvent?.startPos ?? 0);
  const normalizedEndPos = endPos >= normalizedStartPos ? endPos : (lastEvent?.endPos ?? normalizedStartPos);

  return {
    idx,
    chapterIdx: idx,
    chapterIndex: idx,
    title,
    navTitle,
    tocTitle,
    label: stringOrEmpty(chapter.label),
    name: stringOrEmpty(chapter.name),
    spineHref: chapter.spineHref != null ? String(chapter.spineHref) : '',
    paragraphCount,
    paragraphStartsJson: stringOrEmpty(chapter.paragraphStartsJson),
    paragraphLengthsJson: stringOrEmpty(chapter.paragraphLengthsJson),
    paragraphStarts,
    paragraphLengths,
    totalCodePoints,
    startPos: normalizedStartPos,
    endPos: normalizedEndPos,
    rawText: stringOrEmpty(chapter.rawText),
    summaryText: stringOrEmpty(chapter.summaryText),
    summaryUploadUrl:
      chapter.summaryUploadUrl != null ? sanitizeAssetUrl(String(chapter.summaryUploadUrl)) : '',
    povSummariesCached: Boolean(chapter.povSummariesCached),
    events: sortedEvents,
  };
};

const parseCharacterNames = (names) => {
  if (Array.isArray(names)) return names.map((n) => String(n).trim()).filter(Boolean);
  if (typeof names !== 'string' || !names.trim()) return [];
  try {
    const parsed = JSON.parse(names);
    if (Array.isArray(parsed)) return parsed.map((n) => String(n).trim()).filter(Boolean);
  } catch {
    /* plain string */
  }
  if (names.includes(',')) return names.split(',').map((n) => n.trim()).filter(Boolean);
  return [names.trim()];
};

const normalizeCharacter = (character) => {
  if (!character || typeof character !== 'object' || Array.isArray(character)) return null;
  const id = toNumberOrNull(character.id);
  if (id == null) return null;
  return {
    id,
    name: stringOrEmpty(character.name),
    names: parseCharacterNames(character.names),
    profileImage:
      character.profileImage != null ? sanitizeAssetUrl(String(character.profileImage)) : '',
    firstChapterIdx: toNumberOrNull(character.firstChapterIdx) ?? 0,
    personalityText: stringOrEmpty(character.personalityText),
    profileText: stringOrEmpty(character.profileText),
    isMainCharacter: Boolean(character.isMainCharacter),
  };
};

const normalizeReaderArtifacts = (readerArtifacts) => {
  if (!readerArtifacts || typeof readerArtifacts !== 'object' || Array.isArray(readerArtifacts)) {
    return readerArtifacts;
  }
  const path =
    typeof readerArtifacts.combinedXhtmlPath === 'string'
      ? sanitizeAssetUrl(readerArtifacts.combinedXhtmlPath)
      : '';
  return {
    ...readerArtifacts,
    ...(path ? { combinedXhtmlPath: path } : {}),
    dataAttributes: asArray(readerArtifacts.dataAttributes),
  };
};

const normalizeProgressMetadata = (progressMetadata) => {
  if (!progressMetadata || typeof progressMetadata !== 'object') return progressMetadata;
  const chapterLengths = (asArray(progressMetadata.chapterLengths))
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const chapterIdx = toNumberOrNull(item.chapterIdx);
      const length = toNumberOrNull(item.length);
      if (chapterIdx == null) return null;
      return { chapterIdx, length: length ?? 0 };
    })
    .filter(Boolean);
  const summed = chapterLengths.reduce((sum, e) => sum + (e.length ?? 0), 0);
  const totalLength = toNumberOrNull(progressMetadata.totalLength) ?? summed;
  return {
    maxChapter: toNumberOrNull(progressMetadata.maxChapter) ?? 0,
    chapterLengths,
    totalLength: totalLength > 0 ? totalLength : 0,
  };
};

const normalizeManifestData = (manifestData) => {
  if (!manifestData || typeof manifestData !== 'object') return manifestData;
  const normalizedChapters = Array.isArray(manifestData.chapters)
    ? manifestData.chapters.map((chapter) => normalizeChapter(chapter)).filter((ch) => ch != null)
    : manifestData.chapters;
  const progressMetadata = normalizeProgressMetadata(manifestData.progressMetadata);
  const normalizedCharacters = Array.isArray(manifestData.characters)
    ? manifestData.characters.map(normalizeCharacter).filter(Boolean)
    : manifestData.characters;
  const readerArtifacts = manifestData.readerArtifacts
    ? normalizeReaderArtifacts(manifestData.readerArtifacts)
    : manifestData.readerArtifacts;
  const book =
    manifestData.book && typeof manifestData.book === 'object' && !Array.isArray(manifestData.book)
      ? normalizeManifestBook(manifestData.book)
      : manifestData.book;
  return {
    ...manifestData,
    book,
    chapters: normalizedChapters,
    characters: normalizedCharacters,
    progressMetadata: progressMetadata ?? manifestData.progressMetadata,
    readerArtifacts,
  };
};

// 캐시된 manifest 배열은 변경하지 않음(getManifestFromCache 참고) — 배열·객체 identity 기준으로 파생값 메모.
// 진도 계산(readingProgress)은 스크롤마다 불리므로 정렬·길이 조회를 매번 반복하지 않도록 — memoByRef·sortByChapterIdx 공용
const sortedChaptersMemo = new WeakMap();
const chapterByIdxMemo = new WeakMap();
const bookEventIdsMemo = new WeakMap();
const chapterEventIndexMemo = new WeakMap();

export const memoByRef = (memo, arr, build) => {
  let value = memo.get(arr);
  if (value === undefined) {
    value = build(arr);
    memo.set(arr, value);
  }
  return value;
};

/** 개발 모드에서 캐시 manifest를 얼려 직접 변경 시 바로 TypeError — 위 메모가 낡은 값을 내지 않도록 */
const freezeInDev = (value) => {
  if (!import.meta.env?.DEV) return value;
  const freeze = (v) => {
    if (!v || typeof v !== 'object' || Object.isFrozen(v) || ArrayBuffer.isView(v)) return;
    Object.freeze(v);
    Object.values(v).forEach(freeze);
  };
  freeze(value);
  return value;
};

/** 반환 배열은 공유됨 — 변경 금지 */
export const sortByChapterIdx = (chapters) =>
  Array.isArray(chapters)
    ? memoByRef(sortedChaptersMemo, chapters, (list) =>
        list
          .filter((ch) => toNumberOrNull(ch?.idx) != null && toNumberOrNull(ch.idx) >= 1)
          .sort((a, b) => toNumberOrNull(a.idx) - toNumberOrNull(b.idx))
      )
    : [];

const calculateMaxChapterFromChapters = (chapters) => {
  if (!Array.isArray(chapters) || chapters.length === 0) return 0;
  let maxV = -Infinity;
  for (const ch of chapters) {
    const v = toNumberOrNull(ch?.idx);
    if (v != null) maxV = Math.max(maxV, v);
  }
  return Number.isFinite(maxV) ? maxV : 0;
};

function migrateLegacyManifestStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('manifest_cache_') && !key.startsWith(MANIFEST_CACHE_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
  } catch {
    /* ignore */
  }
}
migrateLegacyManifestStorage();

const manifestCache = new Map();
const MANIFEST_MEMORY_MAX = 100;

const getManifestCacheKey = (bookId) => `${MANIFEST_CACHE_PREFIX}${bookId}`;

export const resolveManifestForProgress = (bookId, manifestOverride = undefined) => {
  const useOverride =
    manifestOverride &&
    typeof manifestOverride === 'object' &&
    Array.isArray(manifestOverride.chapters) &&
    manifestOverride.chapters.length > 0;
  return useOverride ? manifestOverride : getManifestFromCache(bookId);
};

export const setManifestData = (bookId, manifestData, { persist = true } = {}) => {
  try {
    if (!bookId || !manifestData) {
      return null;
    }

    const normalizedData = freezeInDev(normalizeManifestData(manifestData));
    const cacheKey = getManifestCacheKey(bookId);
    const payload = {
      data: normalizedData,
      timestamp: Date.now(),
    };

    setBounded(manifestCache, String(bookId), payload, MANIFEST_MEMORY_MAX);

    if (persist) {
      saveToStorage(cacheKey, payload, 'localStorage');
    }

    return normalizedData;
  } catch (error) {
    errorUtils.logWarning('manifestCache', 'Manifest 캐시 저장 실패', { message: error?.message });
    return null;
  }
};

export const getManifestFromCache = (bookId) => {
  if (!bookId) return null;

  const key = String(bookId);
  const cachedInMemory = manifestCache.get(key);
  // 메모리 항목은 정규화된 상태로만 저장 — 읽을 때마다 챕터·paragraph JSON 재파싱하지 않도록. 반환값 변경 금지
  if (cachedInMemory && Date.now() - cachedInMemory.timestamp <= MANIFEST_TTL_MS) {
    return cachedInMemory.data;
  }

  const fromStorage = loadTtlStorage(getManifestCacheKey(bookId), MANIFEST_TTL_MS);
  if (fromStorage?.data) {
    const data = freezeInDev(normalizeManifestData(fromStorage.data));
    setBounded(manifestCache, key, { ...fromStorage, data }, MANIFEST_MEMORY_MAX);
    return data;
  }

  return null;
};

/**
 * @param {object|null|undefined} manifest
 * @param {unknown} chapterIdx
 */
export const getChapterDataFromManifest = (manifest, chapterIdx) => {
  if (!manifest || !Array.isArray(manifest.chapters)) return null;
  const targetIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (targetIdx == null) return null;
  const byIdx = memoByRef(chapterByIdxMemo, manifest.chapters, (list) => {
    const map = new Map();
    for (const ch of list) {
      if (!ch || typeof ch !== 'object') continue;
      const key = toNumberOrNull(ch.idx);
      if (!map.has(key)) map.set(key, ch);
    }
    return map;
  });
  return byIdx.get(targetIdx) ?? null;
};

/**
 * @param {string|number} bookId
 * @param {unknown} chapterIdx
 * @param {object|null|undefined} manifestOverride
 */
export const getChapterData = (bookId, chapterIdx, manifestOverride = undefined) =>
  getChapterDataFromManifest(resolveManifestForProgress(bookId, manifestOverride), chapterIdx);


/**
 * 챕터 events 조회 인덱스 (events 배열 identity 기준 메모 — 이벤트마다 배열을 훑지 않음, O(E) → O(1)).
 * byId·byNum은 첫 항목, last는 순번 최대 중 마지막 항목, first는 순번 최소 중 첫 항목
 */
const getChapterEventIndex = (events) =>
  memoByRef(chapterEventIndexMemo, events, (list) => {
    const byId = new Map();
    const byNum = new Map();
    let first = null;
    let firstNum = 0;
    let last = null;
    let lastNum = 0;
    for (const event of list) {
      const id = String(event?.eventId ?? '').trim();
      if (id && !byId.has(id)) byId.set(id, event);
      const num = resolveEventNum(event, null);
      if (num != null && !byNum.has(num)) byNum.set(num, event);
      if (!num) continue;
      if (num >= lastNum) {
        lastNum = num;
        last = event;
      }
      if (!first || num < firstNum) {
        firstNum = num;
        first = event;
      }
    }
    return { byId, byNum, first, last };
  });

const EMPTY_EVENT_INDEX = Object.freeze({ byId: new Map(), byNum: new Map(), first: null, last: null });

const chapterEventIndexOf = (bookId, chapterIdx, manifestOverride) => {
  const events = getChapterData(bookId, chapterIdx, manifestOverride)?.events;
  return Array.isArray(events) && events.length ? getChapterEventIndex(events) : EMPTY_EVENT_INDEX;
};

/** 챕터 manifest events에서 eventId 또는 eventIdx로 이벤트 조회 */
export const findManifestEventInChapter = (
  bookId,
  chapterIdx,
  { eventId = null, eventIdx = null } = {},
  manifestOverride = undefined
) => {
  const index = chapterEventIndexOf(bookId, chapterIdx, manifestOverride);
  const byId = eventId == null ? '' : String(eventId).trim();
  if (byId) return index.byId.get(byId) ?? null;
  const idx = toNumberOrNull(eventIdx);
  return idx != null ? index.byNum.get(idx) ?? null : null;
};

/** 챕터 manifest events 중 가장 마지막(최대 인덱스) 이벤트 */
export const getLastManifestEventInChapter = (bookId, chapterIdx, manifestOverride = undefined) =>
  chapterEventIndexOf(bookId, chapterIdx, manifestOverride).last;

/** 챕터 manifest events 중 가장 처음(최소 인덱스) 이벤트 */
export const getFirstManifestEventInChapter = (bookId, chapterIdx, manifestOverride = undefined) =>
  chapterEventIndexOf(bookId, chapterIdx, manifestOverride).first;

/** 책 전체 eventId를 챕터·이벤트 순으로. manifest identity 기준 메모 — 반환 배열은 공유됨, 변경 금지 */
export const listBookManifestEventIds = (bookId, manifestOverride = undefined) => {
  const manifest = manifestOverride ?? (bookId ? getManifestFromCache(bookId) : null);
  // chapters가 비면 getChapterData가 캐시 manifest로 폴백하므로 메모하지 않음
  if (!manifest?.chapters?.length) return buildBookManifestEventIds(bookId, manifest);
  return memoByRef(bookEventIdsMemo, manifest, (m) => buildBookManifestEventIds(bookId, m));
};

const buildBookManifestEventIds = (bookId, manifest) => {
  const chapters = sortByChapterIdx(manifest?.chapters);
  const ids = [];
  for (const chapter of chapters) {
    const chapterIdx = toNumberOrNull(chapter?.idx);
    if (chapterIdx == null || chapterIdx < 1) continue;
    const events = asArray(getChapterData(bookId, chapterIdx, manifest)?.events);
    const ordered = [...events].sort((a, b) => {
      const na = resolveEventNum(a) || 0;
      const nb = resolveEventNum(b) || 0;
      return na - nb;
    });
    for (const ev of ordered) {
      const id = resolveEventId(ev);
      if (typeof id === 'string' && id.trim()) ids.push(id.trim());
    }
  }
  return ids;
};

/**
 * 매니페스트 기준 마지막 이벤트 인덱스 (챕터 그래프 eventIdx 상한 힌트).
 * events가 없으면 null — 가짜 1로 probe/누적을 막지 않음.
 */
export const resolveLastEventIdxForChapter = (bookId, chapterIdx, manifestOverride = undefined) =>
  resolveEventNum(getLastManifestEventInChapter(bookId, chapterIdx, manifestOverride), null);

export const getMaxChapter = (bookId, manifest = null, { fallback = 0 } = {}) => {
  const manifestData = manifest ?? (bookId ? getManifestFromCache(bookId) : null);
  const chapters = Array.isArray(manifestData?.chapters) ? manifestData.chapters : [];
  const fromChapters = calculateMaxChapterFromChapters(chapters);
  const fromMeta = toPositiveInt(manifestData?.progressMetadata?.maxChapter, 0) ?? 0;
  const max = Math.max(fromChapters, fromMeta);
  return max > 0 ? max : fallback;
};
