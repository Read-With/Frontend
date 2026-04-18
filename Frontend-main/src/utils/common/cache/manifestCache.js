import { toNumberOrNull, toOneBasedChapterIndexOrNull } from '../numberUtils';
import { 
  registerCache, 
  getCacheItem, 
  setCacheItem, 
  removeCacheItem,
  loadFromStorage,
  saveToStorage,
  removeFromStorage
} from './cacheManager';

const manifestCachePrefix = 'manifest_cache_';
const MANIFEST_TTL_MS = 1000 * 60 * 15;

const manifestCache = new Map();
registerCache('manifestCache', manifestCache, {
  maxSize: 100,
  ttl: MANIFEST_TTL_MS,
  cleanupInterval: 300000
});

const prefetchPromises = new Map();

export const getManifestCacheKey = (bookId) => {
  return `${manifestCachePrefix}${bookId}`;
};

/** GET /api/v2/books/{bookId}/manifest — chapters[].paragraphStartsJson / paragraphLengthsJson */
const parseManifestJsonNumberArray = (value) => {
  if (Array.isArray(value)) {
    return value.map((x) => Number(x)).filter((n) => Number.isFinite(n));
  }
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((x) => Number(x)).filter((n) => Number.isFinite(n)) : [];
  } catch (_e) {
    return [];
  }
};

/** chapters[].events[] — idx, eventId, startTxtOffset, endTxtOffset, rawText */
const normalizeEvent = (event) => {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const idx = toNumberOrNull(event.idx);
  if (idx == null || idx < 1) return null;
  const start = toNumberOrNull(event.startTxtOffset) ?? 0;
  const endRaw = toNumberOrNull(event.endTxtOffset);
  const end = endRaw != null && endRaw >= start ? endRaw : start;
  return {
    idx,
    eventIdx: idx,
    eventId: event.eventId != null ? String(event.eventId) : '',
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

  const firstEvent = normalizedEvents[0] ?? null;
  const lastEvent = normalizedEvents.length > 0 ? normalizedEvents[normalizedEvents.length - 1] : null;
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
    summaryUploadUrl: chapter.summaryUploadUrl != null ? String(chapter.summaryUploadUrl) : '',
    povSummariesCached: Boolean(chapter.povSummariesCached),
    events: normalizedEvents,
  };
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
  return {
    id,
    name: typeof character.name === 'string' ? character.name : '',
    names: typeof character.names === 'string' ? character.names : '',
    profileImage: character.profileImage != null ? String(character.profileImage) : '',
    firstChapterIdx: toNumberOrNull(character.firstChapterIdx) ?? 0,
    personalityText,
    profileText,
    isMainCharacter: isMain,
    main_character: isMain,
    profile_text: profileText,
    description: profileText,
    description_ko: personalityText,
  };
};

const normalizeReaderArtifacts = (readerArtifacts) => {
  if (!readerArtifacts || typeof readerArtifacts !== 'object' || Array.isArray(readerArtifacts)) {
    return readerArtifacts;
  }
  const path = readerArtifacts.combinedXhtmlPath ?? '';
  const dataAttributes = Array.isArray(readerArtifacts.dataAttributes)
    ? readerArtifacts.dataAttributes
    : [];
  return {
    ...readerArtifacts,
    ...(typeof path === 'string' && path ? { combinedXhtmlPath: path } : {}),
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
const getEffectiveChapterLengthForProgress = (manifest, chapter) => {
  if (!chapter) return 0;
  const entry = findChapterLengthEntryForChapter(manifest, chapter);
  const fromTable = toNumberOrNull(entry?.length ?? entry?.codePointLength);
  if (fromTable != null && fromTable > 0) return fromTable;
  return lengthFromChapterBody(chapter);
};

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
      ? { ...manifestData.book }
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
    return cachedInMemory.data;
  }

  const cacheKey = getManifestCacheKey(bookId);
  const fromStorage = loadFromStorage(cacheKey, 'localStorage');
  if (fromStorage && !isExpired(fromStorage.timestamp)) {
    setCacheItem('manifestCache', key, fromStorage);
    return fromStorage.data;
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
      const manifest = response?.result ?? response?.data ?? null;

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

export const getEventData = (bookId, chapterIdx, eventIdx, manifestOverride = undefined) => {
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  if (!chapterData || !chapterData.events) return null;
  
  const targetEventIdx = toNumberOrNull(eventIdx);
  if (targetEventIdx == null) return null;
  return chapterData.events.find(ev => toNumberOrNull(ev.idx) === targetEventIdx) ?? null;
};

export const isValidEvent = (bookId, chapterIdx, eventIdx, manifestOverride = undefined) => {
  const chapterData = getChapterData(bookId, chapterIdx, manifestOverride);
  if (!chapterData || !chapterData.events) return false;
  const targetEventIdx = toNumberOrNull(eventIdx);
  if (targetEventIdx == null) return false;
  return chapterData.events.some(ev => toNumberOrNull(ev.idx) === targetEventIdx);
};

/** 세밀 그래프용: 해당 챕터 events[].idx 중 최댓값 (v2 manifest 이벤트) */
export const getLastFineGraphEventIdxFromChapterData = (chapterData) => {
  if (!chapterData || typeof chapterData !== 'object') return null;
  if (!Array.isArray(chapterData.events) || chapterData.events.length === 0) {
    return 1;
  }
  let maxIdx = -Infinity;
  for (const ev of chapterData.events) {
    const idx = toNumberOrNull(ev?.idx);
    if (idx != null && idx >= 1) maxIdx = Math.max(maxIdx, idx);
  }
  return Number.isFinite(maxIdx) && maxIdx >= 1 ? maxIdx : 1;
};

/**
 * getChapterData·isValidEvent와 동일한 챕터 해석(진도/그래프 API 공통).
 * manifestOverride가 있으면 캐시보다 우선.
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

export const getTotalLength = (bookId) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.progressMetadata) return 0;
  
  return manifest.progressMetadata.totalLength || 0;
};

export const getChapterLength = (bookId, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest?.chapters) return 0;
  const targetIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (targetIdx == null) return 0;
  const chapterData = getChapterData(bookId, targetIdx);
  if (!chapterData) return 0;
  const fromEffective = getEffectiveChapterLengthForProgress(manifest, chapterData);
  if (fromEffective > 0) return fromEffective;
  const lengths = manifest.progressMetadata?.chapterLengths;
  if (!Array.isArray(lengths)) return 0;
  const row = lengths.find((cl) => toNumberOrNull(cl.chapterIdx) === targetIdx);
  return toNumberOrNull(row?.length) ?? 0;
};

export const calculateApiChapterProgressFromLocator = (bookId, startLocator, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest?.chapters) {
    return { currentChars: 0, totalChars: 0, progress: 0, chapterStartPos: 0 };
  }
  const targetChapterIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (targetChapterIdx == null) {
    return { currentChars: 0, totalChars: 0, progress: 0, chapterStartPos: 0 };
  }
  const chapterData = manifest.chapters.find((ch) => toNumberOrNull(ch.idx) === targetChapterIdx);
  if (!chapterData) {
    return { currentChars: 0, totalChars: 0, progress: 0, chapterStartPos: 0 };
  }
  const lengthEntry = findChapterLengthEntryForChapter(manifest, chapterData);
  const fallbackLengthFromEvents = () => {
    if (!Array.isArray(chapterData.events) || chapterData.events.length === 0) return 0;
    const firstEvent = chapterData.events[0];
    const lastEvent = chapterData.events[chapterData.events.length - 1];
    const span = (lastEvent?.endPos ?? 0) - (firstEvent?.startPos ?? 0);
    return span > 0 ? span : 0;
  };
  let totalChars = 0;
  if (typeof chapterData.endPos === 'number' && typeof chapterData.startPos === 'number') {
    const span = chapterData.endPos - chapterData.startPos;
    if (span > 0) totalChars = span;
  }
  if (totalChars <= 0 && lengthEntry?.length) totalChars = toNumberOrNull(lengthEntry.length) ?? 0;
  if (totalChars <= 0) {
    const fromBody = lengthFromChapterBody(chapterData);
    if (fromBody > 0) totalChars = fromBody;
  }
  if (totalChars <= 0) totalChars = fallbackLengthFromEvents();
  let chapterStartPos = typeof chapterData.startPos === 'number' ? chapterData.startPos : null;
  if ((chapterStartPos == null || chapterStartPos <= 0) && Array.isArray(manifest.chapters)) {
    let cumulative = 0;
    for (const ch of manifest.chapters) {
      const chIdx = toNumberOrNull(ch.idx);
      if (chIdx === targetChapterIdx) break;
      cumulative += getEffectiveChapterLengthForProgress(manifest, ch);
    }
    if (cumulative > 0) chapterStartPos = cumulative;
  }
  if (chapterStartPos == null || chapterStartPos < 0) chapterStartPos = 0;
  if (!startLocator || Number(startLocator.chapterIndex) !== targetChapterIdx) {
    return { currentChars: 0, totalChars, progress: 0, chapterStartPos };
  }
  const b = Number(startLocator.blockIndex) || 0;
  const o = Number(startLocator.offset) || 0;
  const chapterCurrentChars = totalChars > 0 ? Math.min(b * 3000 + o, totalChars) : b * 3000 + o;
  const progress = totalChars > 0 ? (chapterCurrentChars / totalChars) * 100 : 0;
  return {
    currentChars: chapterCurrentChars,
    totalChars,
    progress: Math.round(progress * 100) / 100,
    chapterStartPos,
    absoluteCurrent: chapterStartPos + chapterCurrentChars,
    lengthSource: totalChars > 0 ? 'chapter' : 'unknown',
  };
};

export const findApiEventFromChars = async (bookId, chapterIdx, currentChars, chapterStartPos = 0) => {
  const targetChapterIdx = toOneBasedChapterIndexOrNull(chapterIdx);
  if (targetChapterIdx == null) return null;

  let chapterEvents = null;
  try {
    const { getCachedChapterEvents } = await import('./chapterEventCache');
    const cached = getCachedChapterEvents(bookId, targetChapterIdx);
    if (cached && cached.events) {
      chapterEvents = cached.events;
    }
  } catch (error) {
    console.warn('새 캐시 시스템 로드 실패, manifest 폴백:', error);
  }
  
  const manifestChapter = getChapterData(bookId, targetChapterIdx);
  const manifestEvents = Array.isArray(manifestChapter?.events) ? manifestChapter.events : [];

  const eventsMap = new Map();
  const upsertEvent = (sourceEvent) => {
    if (!sourceEvent) return;
    const idx = toNumberOrNull(sourceEvent.idx ?? sourceEvent.eventIdx);
    if (idx == null || idx < 1) return;

    const existing = eventsMap.get(idx) ?? {};
    const normalized = { ...existing, ...sourceEvent };

    const startPos = toNumberOrNull(normalized.startTxtOffset) ?? toNumberOrNull(normalized.startPos) ?? 0;
    const endPosCandidate = toNumberOrNull(normalized.endTxtOffset) ?? toNumberOrNull(normalized.endPos) ?? startPos;
    const endPos = endPosCandidate >= startPos ? endPosCandidate : startPos;

    normalized.startPos = startPos;
    normalized.endPos = endPos;
    normalized.startTxtOffset = startPos;
    normalized.endTxtOffset = endPos;

    normalized.eventIdx = idx;
    normalized.idx = idx;

    if (!normalized.characters && Array.isArray(sourceEvent.characters)) {
      normalized.characters = sourceEvent.characters;
    }
    if (!normalized.relations && Array.isArray(sourceEvent.relations)) {
      normalized.relations = sourceEvent.relations;
    }
    if (!normalized.event && sourceEvent.event) {
      normalized.event = sourceEvent.event;
    }

    eventsMap.set(idx, normalized);
  };

  if (Array.isArray(chapterEvents)) {
    chapterEvents.forEach(upsertEvent);
  }

  manifestEvents.forEach(upsertEvent);

  if (eventsMap.size === 0) {
    console.warn('이벤트 정보 없음:', { bookId, chapterIdx: targetChapterIdx });
    return null;
  }
  
  const mergedEvents = Array.from(eventsMap.values()).sort((a, b) => {
    const idxA = toNumberOrNull(a.idx) ?? toNumberOrNull(a.eventIdx) ?? 0;
    const idxB = toNumberOrNull(b.idx) ?? toNumberOrNull(b.eventIdx) ?? 0;
    if (idxA !== idxB) {
      return idxA - idxB;
    }
    const startA = toNumberOrNull(a.startTxtOffset) ?? toNumberOrNull(a.startPos) ?? 0;
    const startB = toNumberOrNull(b.startTxtOffset) ?? toNumberOrNull(b.startPos) ?? 0;
    return startA - startB;
  });
  
  const base = typeof chapterStartPos === 'number' ? chapterStartPos : 0;
  const firstEvent = mergedEvents[0];

  let isRelativePositions = false;
  if (firstEvent) {
    const firstStart = toNumberOrNull(firstEvent.startTxtOffset) ?? toNumberOrNull(firstEvent.startPos) ?? 0;
    if (base > 0 && firstStart >= 0 && firstStart < base) {
      isRelativePositions = true;
    }
  }

  const position = isRelativePositions ? currentChars : base + currentChars;

  if (firstEvent) {
    const firstStart = toNumberOrNull(firstEvent.startTxtOffset) ?? toNumberOrNull(firstEvent.startPos) ?? 0;
    const firstEndRaw = toNumberOrNull(firstEvent.endTxtOffset) ?? toNumberOrNull(firstEvent.endPos) ?? firstStart;
    const _span = Math.max(firstEndRaw - firstStart, 1);
    if (position <= firstStart) {
      return {
        ...firstEvent,
        eventIdx: toNumberOrNull(firstEvent.idx) ?? toNumberOrNull(firstEvent.eventIdx),
        chapterIdx: targetChapterIdx,
        progress: 0,
        __useRelative: isRelativePositions
      };
    }
  }

  for (let i = 0; i < mergedEvents.length; i++) {
    const event = mergedEvents[i];
    const eventStartPos = toNumberOrNull(event.startTxtOffset) ?? toNumberOrNull(event.startPos) ?? 0;
    const eventEndPosRaw = toNumberOrNull(event.endTxtOffset) ?? toNumberOrNull(event.endPos) ?? eventStartPos;
    const eventEndPos = eventEndPosRaw > eventStartPos ? eventEndPosRaw : eventStartPos + 1;
    
    if (position >= eventStartPos && position < eventEndPos) {
      const span = Math.max(eventEndPos - eventStartPos, 1);
      const rawProgress = ((position - eventStartPos) / span) * 100;
      const clampedProgress = Math.min(Math.max(rawProgress, 0), 100);
      return {
        ...event,
        eventIdx: toNumberOrNull(event.idx) ?? toNumberOrNull(event.eventIdx),
        chapterIdx: targetChapterIdx,
        progress: clampedProgress,
        __useRelative: isRelativePositions
      };
    }
  }
  
  if (mergedEvents.length > 0) {
    const lastEvent = mergedEvents[mergedEvents.length - 1];
    return {
      ...lastEvent,
      eventIdx: toNumberOrNull(lastEvent.idx) ?? toNumberOrNull(lastEvent.eventIdx),
      chapterIdx: targetChapterIdx,
      progress: 100,
      __useRelative: isRelativePositions
    };
  }
  
  return null;
};
