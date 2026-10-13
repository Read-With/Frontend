import { normalizeManifestBook } from '../bookNormalize';
import { sanitizeAssetUrl } from '../urlUtils';
import {
  asArray,
  resolveEventId,
  resolveEventNum,
  sortEventsByIdx,
  toNumberOrNull,
  toOneBasedChapterIndexOrNull,
  toPositiveInt,
  clampPercent,
  toLocator,
  errorUtils,
  stringOrEmpty,
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
// 진도 계산은 스크롤마다 불리므로 정렬·길이 조회를 매번 반복하지 않도록
const sortedChaptersMemo = new WeakMap();
const chapterLengthIndexMemo = new WeakMap();
const chapterByIdxMemo = new WeakMap();
const progressTotalLengthMemo = new WeakMap();
const bookEventIdsMemo = new WeakMap();

const memoByRef = (memo, arr, build) => {
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
const sortByChapterIdx = (chapters) =>
  Array.isArray(chapters)
    ? memoByRef(sortedChaptersMemo, chapters, (list) =>
        list
          .filter((ch) => toNumberOrNull(ch?.idx) != null && toNumberOrNull(ch.idx) >= 1)
          .sort((a, b) => toNumberOrNull(a.idx) - toNumberOrNull(b.idx))
      )
    : [];

const lengthFromChapterBody = (chapter) => {
  if (!chapter || typeof chapter !== 'object') return 0;
  const tcp = toNumberOrNull(chapter.totalCodePoints);
  if (tcp != null && tcp > 0) return tcp;
  const sp = toNumberOrNull(chapter.startPos);
  const ep = toNumberOrNull(chapter.endPos);
  if (sp != null && ep != null && ep > sp) return ep - sp;
  return 0;
};

const findChapterLengthEntryForChapter = (manifest, chapter) => {
  if (!chapter || typeof chapter !== 'object') return null;
  const lengths = manifest?.progressMetadata?.chapterLengths;
  if (!Array.isArray(lengths) || lengths.length === 0) return null;
  const idx = toNumberOrNull(chapter.idx);
  if (idx == null) return null;
  const byIdx = memoByRef(chapterLengthIndexMemo, lengths, (list) => {
    const map = new Map();
    for (const entry of list) {
      const key = toNumberOrNull(entry?.chapterIdx);
      if (!map.has(key)) map.set(key, entry);
    }
    return map;
  });
  return byIdx.get(idx) ?? null;
};

export const getEffectiveChapterLengthForProgress = (manifest, chapter) => {
  if (!chapter) return 0;
  const entry = findChapterLengthEntryForChapter(manifest, chapter);
  const fromTable = toNumberOrNull(entry?.length ?? entry?.codePointLength);
  if (fromTable != null && fromTable > 0) return fromTable;
  return lengthFromChapterBody(chapter);
};

export const calculateMaxChapterFromChapters = (chapters) => {
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

/** paragraphStarts 없을 때 챕터 길이에 맞춘 블록 스텝 (고정 3000보다 역변환 정밀도 향상) */
const resolveApproxBlockStep = (chapter) => {
  const total = toNumberOrNull(chapter?.totalCodePoints);
  if (total == null || total <= 0) return 3000;
  const targetBlocks = Math.max(1, Math.min(32, Math.ceil(total / 750)));
  return Math.max(256, Math.ceil(total / targetBlocks));
};

/** 챕터 내부 코드포인트 오프셋 → v2 locator (paragraphStarts 우선, 없으면 길이 기반 스텝 근사) */
export const locatorFromChapterLocalOffset = (chapter, local) => {
  const chIdx = toNumberOrNull(chapter?.idx);
  if (chIdx == null) return null;
  const safeLocal = Math.max(0, Math.floor(Number(local)));

  const starts = Array.isArray(chapter?.paragraphStarts) ? chapter.paragraphStarts : [];
  const lengths = Array.isArray(chapter?.paragraphLengths) ? chapter.paragraphLengths : [];

  if (starts.length > 0) {
    let block = 0;
    for (let i = 0; i < starts.length; i++) {
      const s = toNumberOrNull(starts[i]) ?? 0;
      if (s <= safeLocal) block = i;
      else break;
    }
    const startInBlock = toNumberOrNull(starts[block]) ?? 0;
    let offset = Math.max(0, safeLocal - startInBlock);
    const len = toNumberOrNull(lengths[block]);
    if (len != null && len > 0) {
      offset = Math.min(offset, len);
    }
    return { chapterIndex: chIdx, blockIndex: block, offset };
  }

  const step = resolveApproxBlockStep(chapter);
  const blockIndex = Math.floor(safeLocal / step);
  const offset = safeLocal % step;
  return { chapterIndex: chIdx, blockIndex, offset };
};

/**
 * v2 locator(blockIndex·offset)를 챕터 rawText 기준 로컬 코드포인트 위치로 환산한다.
 * paragraphStarts가 있으면 서버 분할과 동일 축을 쓰고, 없으면 chapterLocalOffsetToLocator와 동일한 스텝 근사.
 */
const chapterLocalCodePointFromLocator = (chapter, locator) => {
  if (!chapter || typeof chapter !== 'object' || !locator) return 0;
  const block = Math.max(0, Math.floor(Number(locator.blockIndex) || 0));
  const off = Math.max(0, Math.floor(Number(locator.offset) || 0));
  const starts = asArray(chapter.paragraphStarts);
  const lengths = asArray(chapter.paragraphLengths);
  const total = toNumberOrNull(chapter.totalCodePoints);

  if (starts.length > 0) {
    const lastIdx = starts.length - 1;
    if (block > lastIdx) {
      const lastStart = toNumberOrNull(starts[lastIdx]) ?? 0;
      const lastLen = toNumberOrNull(lengths[lastIdx]);
      const endExclusive = lastLen != null && lastLen > 0 ? lastStart + lastLen : lastStart + 1;
      const capped = Math.max(0, endExclusive - 1);
      const cap = Number.isFinite(total) && total > 0 ? Math.min(capped, total - 1) : capped;
      return cap;
    }
  }

  const chapterStart = starts.length > 0
    ? toNumberOrNull(starts[block]) ?? 0
    : block * resolveApproxBlockStep(chapter);
  let chapterLocal = chapterStart + off;
  if (Number.isFinite(total) && total > 0) {
    chapterLocal = Math.min(chapterLocal, Math.max(0, total - 1));
  }
  return Math.max(0, chapterLocal);
};

const pickManifestEventForChapterLocalOffset = (events, local) => {
  if (!Array.isArray(events) || events.length === 0) return null;
  const L = Number.isFinite(local) ? Math.max(0, Math.floor(local)) : 0;
  const sorted = [...events].sort(
    (a, b) => (toNumberOrNull(a.startTxtOffset) ?? 0) - (toNumberOrNull(b.startTxtOffset) ?? 0)
  );
  for (const ev of sorted) {
    const s = toNumberOrNull(ev.startTxtOffset) ?? 0;
    const eRaw = toNumberOrNull(ev.endTxtOffset);
    const e = eRaw != null && eRaw > s ? eRaw : s + 1;
    if (L >= s && L < e) return ev;
  }
  const first = sorted[0];
  const firstStart = toNumberOrNull(first.startTxtOffset) ?? 0;
  if (L < firstStart) return first;
  let best = first;
  for (const ev of sorted) {
    const s = toNumberOrNull(ev.startTxtOffset) ?? 0;
    if (s <= L) best = ev;
    else break;
  }
  return best;
};

/**
 * 이벤트 시작 locator 해석 (progress/뷰어용). 그래프 API는 relationship-deltas(eventId)를 사용.
 * 매니페스트 이벤트 구간(startTxtOffset/endTxtOffset)으로 locator에 대응하는 eventIdx를 계산한다.
 */
export const resolveLocatorToEventParams = (
  bookId,
  atLocator,
  eventIdxFallback = 1,
  manifestOverride = undefined
) => {
  const loc = toLocator(atLocator);
  if (!loc) {
    return {
      chapterIdx: undefined,
      eventIdx: Math.max(1, Number(eventIdxFallback) || 1),
      atLocator: null,
      resolved: false,
    };
  }

  const chapterData = getChapterData(bookId, loc.chapterIndex, manifestOverride);
  const events = chapterData?.events;
  if (!Array.isArray(events) || events.length === 0) {
    return {
      chapterIdx: loc.chapterIndex,
      eventIdx: Math.max(1, Number(eventIdxFallback) || 1),
      atLocator: loc,
      resolved: false,
    };
  }

  const local = chapterLocalCodePointFromLocator(chapterData, loc);
  const picked = pickManifestEventForChapterLocalOffset(events, local);
  const raw =
    toNumberOrNull(picked?.eventNum) ??
    toNumberOrNull(picked?.idx) ??
    toNumberOrNull(picked?.eventIdx) ??
    toNumberOrNull(eventIdxFallback);
  const eventIdx = Number.isFinite(raw) && raw >= 1 ? raw : Math.max(1, Number(eventIdxFallback) || 1);
  const eventId = picked?.eventId ? String(picked.eventId).trim() : '';

  return {
    chapterIdx: loc.chapterIndex,
    eventIdx,
    ...(eventId ? { eventId } : {}),
    atLocator: loc,
    resolved: true,
  };
};

/**
 * GET /api/v2/progress 등에 locator 없이 startTxtOffset만 올 때,
 * manifest의 챕터 길이 누적을 기준으로 도서 전체 기준 절대 코드포인트 위치를 v2 locator로 근사한다.
 */
export const locatorFromBookAbsoluteOffset = (bookId, absoluteOffset, manifestOverride = undefined) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  const pos = toNumberOrNull(absoluteOffset);
  if (!manifest?.chapters?.length || pos == null || pos < 0) return null;

  const chapters = sortByChapterIdx(manifest.chapters);

  let cum = 0;
  let lastChapterWithLen = null;
  let lastLen = 0;

  for (const ch of chapters) {
    const L = getEffectiveChapterLengthForProgress(manifest, ch);
    if (L <= 0) continue;
    lastChapterWithLen = ch;
    lastLen = L;
    const end = cum + L;
    if (pos < end) {
      const local = Math.max(0, Math.min(pos - cum, L - 1));
      return locatorFromChapterLocalOffset(ch, local);
    }
    cum = end;
  }

  if (lastChapterWithLen && lastLen > 0) {
    return locatorFromChapterLocalOffset(lastChapterWithLen, lastLen - 1);
  }
  return null;
};

const resolveManifestForProgress = (bookId, manifestOverride = undefined) => {
  const useOverride =
    manifestOverride &&
    typeof manifestOverride === 'object' &&
    Array.isArray(manifestOverride.chapters) &&
    manifestOverride.chapters.length > 0;
  return useOverride ? manifestOverride : getManifestFromCache(bookId);
};

const getProgressTotalLength = (manifest) => {
  if (!manifest || typeof manifest !== 'object') return 0;
  const metaTotal = toNumberOrNull(manifest.progressMetadata?.totalLength);
  if (metaTotal != null && metaTotal > 0) return metaTotal;
  return memoByRef(progressTotalLengthMemo, manifest, (m) =>
    sortByChapterIdx(m.chapters).reduce((sum, ch) => sum + getEffectiveChapterLengthForProgress(m, ch), 0)
  );
};

/** paragraphStarts 없으면 스텝 인코딩, 페이지 인코딩(block이 챕터 길이를 넘김)이면 offset을 챕터 로컬로 사용 */
export const chapterLocalOffsetFromLocator = (chapter, locator) => {
  if (!chapter || !locator) return 0;
  const starts = asArray(chapter.paragraphStarts);
  if (starts.length > 0) {
    return chapterLocalCodePointFromLocator(chapter, locator);
  }
  const block = Math.max(0, Math.floor(Number(locator.blockIndex) || 0));
  const off = Math.max(0, Math.floor(Number(locator.offset) || 0));
  const step = resolveApproxBlockStep(chapter);
  const total = toNumberOrNull(chapter.totalCodePoints) ?? lengthFromChapterBody(chapter);
  if (total > 0 && block * step >= total) {
    return Math.min(Math.max(0, off), Math.max(0, total - 1));
  }
  return chapterLocalCodePointFromLocator(chapter, locator);
};

const percentFromOffsetInLength = (offset, length) => {
  if (!(length > 0) || !Number.isFinite(offset)) return null;
  if (length <= 1) return offset > 0 ? 100 : 0;
  const local = Math.min(Math.max(0, offset), length - 1);
  return clampPercent((local / (length - 1)) * 100);
};

export const canResolveProgressMetrics = (bookId, manifestOverride = undefined) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  if (!manifest?.chapters?.length) return false;
  return getProgressTotalLength(manifest) > 0;
};

export const locatorToBookAbsoluteOffset = (bookId, locator, manifestOverride = undefined) => {
  const loc = toLocator(locator);
  if (!loc) return null;
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  if (!manifest?.chapters?.length) return null;

  const chapters = sortByChapterIdx(manifest.chapters);
  let cum = 0;
  for (const ch of chapters) {
    const L = getEffectiveChapterLengthForProgress(manifest, ch);
    const idx = toNumberOrNull(ch.idx);
    if (idx === loc.chapterIndex) {
      const local = chapterLocalOffsetFromLocator(ch, loc);
      if (!(L > 0)) return cum;
      return cum + Math.min(Math.max(0, local), L - 1);
    }
    if (L > 0) cum += L;
  }
  return null;
};

export const readingProgressPercentFromLocator = (bookId, locator, manifestOverride = undefined) => {
  const abs = locatorToBookAbsoluteOffset(bookId, locator, manifestOverride);
  if (abs == null) return null;
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  return percentFromOffsetInLength(abs, getProgressTotalLength(manifest));
};

export const absoluteOffsetFromReadingProgressPercent = (
  bookId,
  percent,
  manifestOverride = undefined
) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  const total = getProgressTotalLength(manifest);
  if (!(total > 0)) return null;
  const p = Number(percent);
  if (!Number.isFinite(p)) return null;
  const clamped = Math.min(100, Math.max(0, p));
  if (total <= 1) return 0;
  return Math.min(total - 1, Math.max(0, Math.round((clamped / 100) * (total - 1))));
};

export const resolveProgressMetricsFromLocator = (bookId, locator, manifestOverride = undefined) => {
  const loc = toLocator(locator);
  if (!loc) return null;
  const readingProgressPercent = readingProgressPercentFromLocator(bookId, loc, manifestOverride);
  if (readingProgressPercent == null) return null;

  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  const chapter = getChapterData(bookId, loc.chapterIndex, manifestOverride);
  const chapterLen = getEffectiveChapterLengthForProgress(manifest, chapter);
  const local = chapterLocalOffsetFromLocator(chapter, loc);
  return {
    readingProgressPercent,
    chapterProgress: percentFromOffsetInLength(local, chapterLen),
  };
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


const manifestEventIndex = (event) => {
  const idx = resolveEventNum(event);
  return idx > 0 ? idx : null;
};

/** 챕터 manifest events에서 eventId 또는 eventIdx로 이벤트 조회 */
export const findManifestEventInChapter = (
  bookId,
  chapterIdx,
  { eventId = null, eventIdx = null } = {},
  manifestOverride = undefined
) => {
  const events = asArray(getChapterData(bookId, chapterIdx, manifestOverride)?.events);
  const byId = eventId == null ? '' : String(eventId).trim();
  if (byId) {
    return events.find((row) => String(row?.eventId ?? '').trim() === byId) ?? null;
  }
  const idx = toNumberOrNull(eventIdx);
  if (idx != null) {
    return events.find((ev) => manifestEventIndex(ev) === idx) ?? null;
  }
  return null;
};

/** 챕터 manifest events 중 가장 마지막(최대 인덱스) 이벤트 */
export const getLastManifestEventInChapter = (
  bookId,
  chapterIdx,
  manifestOverride = undefined
) => {
  const events = asArray(getChapterData(bookId, chapterIdx, manifestOverride)?.events);
  return events.reduce((last, event) => {
    const num = manifestEventIndex(event);
    if (!num) return last;
    const lastNum = last ? manifestEventIndex(last) : 0;
    return num >= lastNum ? event : last;
  }, null);
};

/** 챕터 manifest events 중 가장 처음(최소 인덱스) 이벤트 */
export const getFirstManifestEventInChapter = (bookId, chapterIdx, manifestOverride = undefined) => {
  const events = asArray(getChapterData(bookId, chapterIdx, manifestOverride)?.events);
  return events.reduce((first, event) => {
    const num = manifestEventIndex(event);
    if (!num) return first;
    return !first || num < manifestEventIndex(first) ? event : first;
  }, null);
};

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
 * v2 manifest 챕터의 이벤트 인덱스 상한(힌트). 그래프 본문은 relationship-deltas.
 * events가 없으면 null — 가짜 1로 probe/누적을 막지 않음.
 */
const getLastEventIdxFromChapterData = (chapterData) => {
  if (!chapterData || typeof chapterData !== 'object') return null;
  if (!Array.isArray(chapterData.events) || chapterData.events.length === 0) {
    return null;
  }
  let maxIdx = -Infinity;
  for (const ev of chapterData.events) {
    const num = manifestEventIndex(ev);
    if (num != null) maxIdx = Math.max(maxIdx, num);
  }
  return Number.isFinite(maxIdx) && maxIdx >= 1 ? maxIdx : null;
};

/**
 * 매니페스트 기준 마지막 이벤트 인덱스 (챕터 그래프 eventIdx 상한 힌트).
 */
export const resolveLastEventIdxForChapter = (bookId, chapterIdx, manifestOverride = undefined) => {
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  if (!chapterData) return null;
  return getLastEventIdxFromChapterData(chapterData);
};

export const getMaxChapter = (bookId, manifest = null, { fallback = 0 } = {}) => {
  const manifestData = manifest ?? (bookId ? getManifestFromCache(bookId) : null);
  const chapters = Array.isArray(manifestData?.chapters) ? manifestData.chapters : [];
  const fromChapters = calculateMaxChapterFromChapters(chapters);
  const fromMeta = toPositiveInt(manifestData?.progressMetadata?.maxChapter, 0) ?? 0;
  const max = Math.max(fromChapters, fromMeta);
  return max > 0 ? max : fallback;
};
