import { normalizeManifestBook } from '../../api/booksApi';
import { sanitizeAssetUrl } from '../artifactUrlUtils';
import { toNumberOrNull, toOneBasedChapterIndexOrNull } from '../numberUtils';
import { toLocator } from '../locatorUtils';
import { sortEventsByIdx } from '../../graph/graphData';
import { eventUtils } from '../../viewer/viewerCoreStateUtils';
import { 
  registerCache, 
  getCacheItem, 
  setCacheItem, 
  removeCacheItem,
  loadFromStorage,
  saveToStorage,
  removeFromStorage
} from './cacheManager';

const manifestCachePrefix = 'manifest_cache_v2_';
const MANIFEST_TTL_MS = 1000 * 60 * 15;

function migrateLegacyManifestStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key?.startsWith('manifest_cache_') && !key.startsWith(manifestCachePrefix)) {
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
registerCache('manifestCache', manifestCache, {
  maxSize: 100,
  ttl: MANIFEST_TTL_MS,
  cleanupInterval: 300000
});

const prefetchPromises = new Map();

const toFiniteNumberArray = (values) =>
  (Array.isArray(values) ? values : [])
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n));

const normalizeTextSpan = (startValue, endValue) => {
  const start = toNumberOrNull(startValue) ?? 0;
  const endRaw = toNumberOrNull(endValue);
  const end = endRaw != null && endRaw >= start ? endRaw : start;
  return { start, end };
};

const sortByChapterIdx = (chapters) =>
  [...(Array.isArray(chapters) ? chapters : [])]
    .filter((ch) => toNumberOrNull(ch?.idx) != null && toNumberOrNull(ch.idx) >= 1)
    .sort((a, b) => toNumberOrNull(a.idx) - toNumberOrNull(b.idx));

export const getManifestCacheKey = (bookId) => {
  return `${manifestCachePrefix}${bookId}`;
};

/** GET /api/v2/books/{bookId}/manifest — chapters[].paragraphStartsJson / paragraphLengthsJson */
const parseManifestJsonNumberArray = (value) => {
  if (Array.isArray(value)) {
    return toFiniteNumberArray(value);
  }
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return toFiniteNumberArray(parsed);
  } catch (_e) {
    return [];
  }
};

/** chapters[].events[] — idx, eventNum, eventId, startTxtOffset, endTxtOffset, rawText */
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
    rawText: typeof event.rawText === 'string' ? event.rawText : '',
  };
};

/** chapters[] — OpenAPI: idx, title, spineHref, paragraphCount, paragraphStartsJson, … */
const normalizeChapter = (chapter) => {
  if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) {
    return null;
  }
  const idx = toNumberOrNull(chapter.idx);
  if (idx == null || idx < 1) return null;

  const title = typeof chapter.title === 'string' ? chapter.title : '';
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
    chapterTitle: title,
    spineHref: chapter.spineHref != null ? String(chapter.spineHref) : '',
    paragraphCount,
    paragraphStartsJson: typeof chapter.paragraphStartsJson === 'string' ? chapter.paragraphStartsJson : '',
    paragraphLengthsJson: typeof chapter.paragraphLengthsJson === 'string' ? chapter.paragraphLengthsJson : '',
    paragraphStarts,
    paragraphLengths,
    totalCodePoints,
    startPos: normalizedStartPos,
    endPos: normalizedEndPos,
    rawText: typeof chapter.rawText === 'string' ? chapter.rawText : '',
    summaryText: typeof chapter.summaryText === 'string' ? chapter.summaryText : '',
    summaryUploadUrl:
      chapter.summaryUploadUrl != null
        ? sanitizeAssetUrl(String(chapter.summaryUploadUrl))
        : '',
    povSummariesCached: Boolean(chapter.povSummariesCached),
    events: sortedEvents,
  };
};

const parseCharacterNames = (names) => {
  if (Array.isArray(names)) {
    return names.map((n) => String(n).trim()).filter(Boolean);
  }
  if (typeof names !== 'string' || !names.trim()) return [];
  try {
    const parsed = JSON.parse(names);
    if (Array.isArray(parsed)) {
      return parsed.map((n) => String(n).trim()).filter(Boolean);
    }
  } catch (_e) {
    /* plain string */
  }
  if (names.includes(',')) {
    return names.split(',').map((n) => n.trim()).filter(Boolean);
  }
  return [names.trim()];
};

/** characters[] — id, name, names, profileImage, firstChapterIdx, personalityText, profileText, isMainCharacter */
const normalizeCharacter = (character) => {
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    return null;
  }
  const id = toNumberOrNull(character.id);
  if (id == null) return null;
  const profileText = typeof character.profileText === 'string' ? character.profileText : '';
  const personalityText = typeof character.personalityText === 'string' ? character.personalityText : '';
  const isMain = Boolean(character.isMainCharacter);
  const names = parseCharacterNames(character.names);
  return {
    id,
    name: typeof character.name === 'string' ? character.name : '',
    names,
    profileImage:
      character.profileImage != null
        ? sanitizeAssetUrl(String(character.profileImage))
        : '',
    firstChapterIdx: toNumberOrNull(character.firstChapterIdx) ?? 0,
    personalityText,
    profileText,
    isMainCharacter: isMain,
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
  const dataAttributes = Array.isArray(readerArtifacts.dataAttributes)
    ? readerArtifacts.dataAttributes
    : [];
  return {
    ...readerArtifacts,
    ...(path ? { combinedXhtmlPath: path } : {}),
    dataAttributes,
  };
};

/** progressMetadata — maxChapter, chapterLengths[{ chapterIdx, length }], totalLength */
const normalizeProgressMetadata = (progressMetadata) => {
  if (!progressMetadata || typeof progressMetadata !== 'object') {
    return progressMetadata;
  }
  const rawLengths = Array.isArray(progressMetadata.chapterLengths) ? progressMetadata.chapterLengths : [];
  const chapterLengths = rawLengths
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const chapterIdx = toNumberOrNull(item.chapterIdx);
      const length = toNumberOrNull(item.length);
      if (chapterIdx == null) return null;
      return { chapterIdx, length: length ?? 0 };
    })
    .filter(Boolean);
  const maxChapter = toNumberOrNull(progressMetadata.maxChapter) ?? 0;
  const summed = chapterLengths.reduce((sum, e) => sum + (e.length ?? 0), 0);
  const totalLength = toNumberOrNull(progressMetadata.totalLength) ?? summed;
  return {
    maxChapter,
    chapterLengths,
    totalLength: totalLength > 0 ? totalLength : 0,
  };
};

/** 챕터 본문에 붙은 길이(진도용) — totalCodePoints, startPos/endPos */
const lengthFromChapterBody = (chapter) => {
  if (!chapter || typeof chapter !== 'object') return 0;
  const tcp = toNumberOrNull(chapter.totalCodePoints);
  if (tcp != null && tcp > 0) return tcp;
  const sp = toNumberOrNull(chapter.startPos);
  const ep = toNumberOrNull(chapter.endPos);
  if (sp != null && ep != null && ep > sp) return ep - sp;
  return 0;
};

/** progressMetadata.chapterLengths 에서 chapter.idx 와 chapterIdx 일치 항목 */
const findChapterLengthEntryForChapter = (manifest, chapter) => {
  if (!chapter || typeof chapter !== 'object') return null;
  const lengths = manifest?.progressMetadata?.chapterLengths;
  if (!Array.isArray(lengths) || lengths.length === 0) return null;
  const idx = toNumberOrNull(chapter.idx);
  if (idx == null) return null;
  return lengths.find((e) => toNumberOrNull(e.chapterIdx) === idx) ?? null;
};

/** chapterLengths 매칭 후에도 0이면 totalCodePoints·start/end span 사용 */
export const getEffectiveChapterLengthForProgress = (manifest, chapter) => {
  if (!chapter) return 0;
  const entry = findChapterLengthEntryForChapter(manifest, chapter);
  const fromTable = toNumberOrNull(entry?.length ?? entry?.codePointLength);
  if (fromTable != null && fromTable > 0) return fromTable;
  return lengthFromChapterBody(chapter);
};

/** paragraphStarts 없을 때 챕터 길이에 맞춘 블록 스텝 (고정 3000보다 역변환 정밀도 향상) */
const resolveApproxBlockStep = (chapter) => {
  const total = toNumberOrNull(chapter?.totalCodePoints);
  if (total == null || total <= 0) return 3000;
  const targetBlocks = Math.max(1, Math.min(32, Math.ceil(total / 750)));
  return Math.max(256, Math.ceil(total / targetBlocks));
};

/** 챕터 내부 코드포인트 오프셋 → v2 locator (paragraphStarts 우선, 없으면 길이 기반 스텝 근사) */
const chapterLocalOffsetToLocator = (chapter, local) => {
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
export const chapterLocalCodePointFromLocator = (chapter, locator) => {
  if (!chapter || typeof chapter !== 'object' || !locator) return 0;
  const block = Math.max(0, Math.floor(Number(locator.blockIndex) || 0));
  const off = Math.max(0, Math.floor(Number(locator.offset) || 0));
  const starts = Array.isArray(chapter.paragraphStarts) ? chapter.paragraphStarts : [];
  const lengths = Array.isArray(chapter.paragraphLengths) ? chapter.paragraphLengths : [];
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
    const startInBlock = toNumberOrNull(starts[block]) ?? 0;
    let chapterLocal = startInBlock + off;
    if (Number.isFinite(total) && total > 0) {
      chapterLocal = Math.min(chapterLocal, Math.max(0, total - 1));
    }
    return Math.max(0, chapterLocal);
  }

  const step = resolveApproxBlockStep(chapter);
  let chapterLocal = block * step + off;
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
 * GET /api/v2/books/{bookId}/relationship-graph locator 호출에서 blockIndex 불일치(400)를 피하기 위해
 * 매니페스트 이벤트 구간(startTxtOffset/endTxtOffset)으로 locator에 대응하는 eventIdx를 계산한다.
 */
export const resolveFineGraphLocatorToEventParams = (
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

export const resolveFineGraphEventToLocator = (
  bookId,
  chapterIdx,
  eventIdx,
  manifestOverride = undefined
) => {
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  if (!chapterData) return null;
  const manifestEvent = getManifestEventData(bookId, chapterIdx, eventIdx, manifestOverride);
  const startTxtOffset = toNumberOrNull(manifestEvent?.startTxtOffset);
  if (startTxtOffset != null && startTxtOffset >= 0) {
    return chapterLocalOffsetToLocator(chapterData, startTxtOffset);
  }
  return chapterLocalOffsetToLocator(chapterData, 0);
};

/**
 * GET /api/v2/progress 등에 locator 없이 startTxtOffset만 올 때,
 * manifest의 챕터 길이 누적을 기준으로 도서 전체 기준 절대 코드포인트 위치를 v2 locator로 근사한다.
 * (startTxtOffset이 챕터 상대값이면 서버에서 locator를 내려주는 편이 맞다.)
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
      return chapterLocalOffsetToLocator(ch, local);
    }
    cum = end;
  }

  if (lastChapterWithLen && lastLen > 0) {
    return chapterLocalOffsetToLocator(lastChapterWithLen, lastLen - 1);
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
  if (!manifest) return 0;
  const metaTotal = toNumberOrNull(manifest.progressMetadata?.totalLength);
  if (metaTotal != null && metaTotal > 0) return metaTotal;
  const chapters = sortByChapterIdx(manifest.chapters);
  return chapters.reduce((sum, ch) => sum + getEffectiveChapterLengthForProgress(manifest, ch), 0);
};

/** manifest 챕터 길이 합(진도 % 분모) */
export const getBookTotalLengthForProgress = (manifest) => getProgressTotalLength(manifest);

/** paragraphStarts 없으면 스텝 인코딩, 페이지 인코딩(block이 챕터 길이를 넘김)이면 offset을 챕터 로컬로 사용 */
const chapterLocalForProgress = (chapter, locator) => {
  if (!chapter || !locator) return 0;
  const starts = Array.isArray(chapter.paragraphStarts) ? chapter.paragraphStarts : [];
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
  return Math.min(100, Math.max(0, Math.round((local / (length - 1)) * 100)));
};

export const canResolveProgressMetrics = (bookId, manifestOverride = undefined) => {
  const manifest = resolveManifestForProgress(bookId, manifestOverride);
  if (!manifest?.chapters?.length) return false;
  return getProgressTotalLength(manifest) > 0;
};

export const locatorFromChapterLocalOffset = (chapter, local) =>
  chapterLocalOffsetToLocator(chapter, local);

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
      const local = chapterLocalForProgress(ch, loc);
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
  const local = chapterLocalForProgress(chapter, loc);
  return {
    readingProgressPercent,
    chapterProgress: percentFromOffsetInLength(local, chapterLen),
  };
};

export const chapterProgressPercentFromLocator = (bookId, locator, manifestOverride = undefined) =>
  resolveProgressMetricsFromLocator(bookId, locator, manifestOverride)?.chapterProgress ?? null;

const normalizeManifestData = (manifestData) => {
  if (!manifestData || typeof manifestData !== 'object') {
    return manifestData;
  }

  const normalizedChapters = Array.isArray(manifestData.chapters)
    ? manifestData.chapters
        .map((chapter) => normalizeChapter(chapter))
        .filter((ch) => ch != null && typeof ch === 'object')
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

const isExpired = (timestamp) => {
  if (!timestamp || MANIFEST_TTL_MS <= 0) return false;
  return Date.now() - timestamp > MANIFEST_TTL_MS;
};

export const setManifestData = (bookId, manifestData, { persist = true } = {}) => {
  try {
    if (!bookId || !manifestData) {
      return null;
    }

    const normalizedData = normalizeManifestData(manifestData);
    const cacheKey = getManifestCacheKey(bookId);
    const payload = {
      data: normalizedData,
      timestamp: Date.now(),
    };

    setCacheItem('manifestCache', String(bookId), payload);

    if (persist) {
      saveToStorage(cacheKey, payload, 'localStorage');
    }

    return normalizedData;
  } catch (error) {
    console.error('Manifest 캐시 저장 실패:', error);
    return null;
  }
};

export const getManifestFromCache = (bookId) => {
  if (!bookId) return null;

  const key = String(bookId);
  const cachedInMemory = getCacheItem('manifestCache', key);
  if (cachedInMemory && !isExpired(cachedInMemory.timestamp)) {
    return normalizeManifestData(cachedInMemory.data);
  }

  const cacheKey = getManifestCacheKey(bookId);
  const fromStorage = loadFromStorage(cacheKey, 'localStorage');
  if (fromStorage && !isExpired(fromStorage.timestamp)) {
    setCacheItem('manifestCache', key, fromStorage);
    return normalizeManifestData(fromStorage.data);
  }

  return null;
};

export const hasManifestData = (bookId) => {
  const key = String(bookId);
  const cachedInMemory = getCacheItem('manifestCache', key);
  if (cachedInMemory && !isExpired(cachedInMemory.timestamp)) {
    return true;
  }
  
  const cacheKey = getManifestCacheKey(bookId);
  const fromStorage = loadFromStorage(cacheKey, 'localStorage');
  return !!(fromStorage && !isExpired(fromStorage.timestamp) && fromStorage.data);
};

export const invalidateManifest = (bookId) => {
  if (!bookId) return;
  const key = String(bookId);
  removeCacheItem('manifestCache', key);
  const cacheKey = getManifestCacheKey(bookId);
  removeFromStorage(cacheKey, 'localStorage');
  import('../../viewer/xhtmlLoadCache.js')
    .then(({ invalidateCachedXhtml }) => {
      invalidateCachedXhtml(bookId);
    })
    .catch(() => {});
};

export const prefetchManifest = async (bookId, fetcher) => {
  if (!bookId || typeof fetcher !== 'function') {
    return null;
  }

  if (hasManifestData(bookId)) {
    return getManifestFromCache(bookId);
  }

  const key = String(bookId);
  if (prefetchPromises.has(key)) {
    return prefetchPromises.get(key);
  }

  const promise = (async () => {
    try {
      const response = await fetcher(bookId);
      const manifest = response?.result ?? null;

      if (response?.isSuccess && manifest) {
        return setManifestData(bookId, manifest);
      }

      return null;
    } catch (error) {
      console.warn('Manifest 프리패치 실패:', error);
      return null;
    } finally {
      prefetchPromises.delete(key);
    }
  })();

  prefetchPromises.set(key, promise);
  return promise;
};

const manifestChapterMatchesIdx = (ch, targetIdx) => {
  if (!ch || typeof ch !== 'object' || targetIdx == null) return false;
  return toNumberOrNull(ch.idx) === targetIdx;
};

/**
 * @param {object|null|undefined} manifest
 * @param {unknown} chapterIdx
 */
export const getChapterDataFromManifest = (manifest, chapterIdx) => {
  if (!manifest || !Array.isArray(manifest.chapters)) return null;
  const targetIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (targetIdx == null) return null;
  return manifest.chapters.find((ch) => manifestChapterMatchesIdx(ch, targetIdx)) ?? null;
};

/**
 * @param {string|number} bookId
 * @param {unknown} chapterIdx
 * @param {object|null|undefined} manifestOverride - React 등 화면이 들고 있는 매니페스트가 있으면 캐시보다 우선(캐시 미스·TTL 불일치 완화)
 */
export const getChapterData = (bookId, chapterIdx, manifestOverride = undefined) => {
  const useOverride =
    manifestOverride &&
    typeof manifestOverride === 'object' &&
    Array.isArray(manifestOverride.chapters) &&
    manifestOverride.chapters.length > 0;
  const manifest = useOverride ? manifestOverride : getManifestFromCache(bookId);
  return getChapterDataFromManifest(manifest, chapterIdx);
};

/** POST progress — 서버 blockIndex 검증에 맞게 paragraphStarts 축으로 재매핑 */
export const normalizeLocatorForServerProgress = (bookId, locator, manifestOverride = undefined) => {
  const loc = toLocator(locator);
  if (!loc) return null;
  const chapter = getChapterData(bookId, loc.chapterIndex, manifestOverride);
  if (!chapter) return loc;
  const starts = Array.isArray(chapter.paragraphStarts) ? chapter.paragraphStarts : [];
  if (starts.length === 0) return loc;
  const local = chapterLocalCodePointFromLocator(chapter, loc);
  const out = chapterLocalOffsetToLocator(chapter, local);
  return out ?? loc;
};

export const manifestChapterIndex = (row) =>
  toNumberOrNull(row?.idx ?? row?.chapterIdx ?? row?.chapterIndex);

const manifestEventIndex = (event) => {
  const idx = eventUtils.extractRawEventIdx(event);
  return idx > 0 ? idx : null;
};

/** 챕터 manifest events에서 eventId 또는 eventIdx로 이벤트 조회 */
export const findManifestEventInChapter = (
  bookId,
  chapterIdx,
  { eventId = null, eventIdx = null } = {},
  manifestOverride = undefined
) => {
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  const events = Array.isArray(chapterData?.events) ? chapterData.events : [];
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
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  const events = Array.isArray(chapterData?.events) ? chapterData.events : [];
  return events.reduce((last, event) => {
    const num = manifestEventIndex(event);
    if (!num) return last;
    const lastNum = last ? manifestEventIndex(last) : 0;
    return num >= lastNum ? event : last;
  }, null);
};

export const getManifestEventData = (bookId, chapterIdx, eventIdx, manifestOverride = undefined) =>
  findManifestEventInChapter(bookId, chapterIdx, { eventIdx }, manifestOverride);

export const isValidEvent = (bookId, chapterIdx, eventIdx, manifestOverride = undefined) =>
  getManifestEventData(bookId, chapterIdx, eventIdx, manifestOverride) !== null;

/**
 * v2 manifest 챕터의 이벤트 인덱스 상한(힌트). 그래프 본문은 GET /api/v2/books/{bookId}/relationship-graph.
 */
export const getLastFineGraphEventIdxFromChapterData = (chapterData) => {
  if (!chapterData || typeof chapterData !== 'object') return null;
  if (!Array.isArray(chapterData.events) || chapterData.events.length === 0) {
    return 1;
  }
  let maxIdx = -Infinity;
  for (const ev of chapterData.events) {
    const num = manifestEventIndex(ev);
    if (num != null) maxIdx = Math.max(maxIdx, num);
  }
  return Number.isFinite(maxIdx) && maxIdx >= 1 ? maxIdx : 1;
};

/**
 * 매니페스트 기준 마지막 이벤트 인덱스( fine API 호출 시 eventIdx 상한 힌트로 사용 ).
 * manifestOverride가 있으면 메모리 캐시보다 우선.
 */
export const resolveLastEventIdxForFineGraph = (bookId, chapterIdx, manifestOverride = undefined) => {
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  if (!chapterData) return null;
  return getLastFineGraphEventIdxFromChapterData(chapterData);
};

/** chapters[].idx 최댓값 */
export const calculateMaxChapterFromChapters = (chapters) => {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return 0;
  }
  let maxV = -Infinity;
  for (const ch of chapters) {
    const v = toNumberOrNull(ch?.idx);
    if (v != null) {
      maxV = Math.max(maxV, v);
    }
  }
  return Number.isFinite(maxV) ? maxV : 0;
};

export const getMaxChapter = (bookId) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest?.chapters) return 0;
  return calculateMaxChapterFromChapters(manifest.chapters);
};
