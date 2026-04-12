import { toNumberOrNull } from '../numberUtils';
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

const normalizeEvent = (event, fallbackIdx) => {
  if (!event) return null;

  const resolvedIdx = toNumberOrNull(
    event.idx ?? event.eventIdx ?? event.index ?? event.id ?? fallbackIdx
  );

  const startPos = toNumberOrNull(event.startTxtOffset);
  const endPos = toNumberOrNull(event.endTxtOffset);

  return {
    ...event,
    idx: resolvedIdx ?? fallbackIdx ?? null,
    eventIdx: resolvedIdx ?? fallbackIdx ?? null,
    eventId: event.eventId ?? event.id ?? null,
    startPos: startPos ?? 0,
    endPos: endPos ?? 0,
    startTxtOffset: startPos ?? 0,
    endTxtOffset: endPos ?? 0,
  };
};

const normalizeChapter = (chapter, index) => {
  if (!chapter || typeof chapter !== 'object' || Array.isArray(chapter)) {
    return null;
  }

  const resolvedChapterIdx = toNumberOrNull(
    chapter.chapterIdx ?? chapter.chapterIndex ?? chapter.idx ?? chapter.chapter ?? chapter.number ?? index + 1
  );

  const resolvedTitle = chapter.title ?? 
                       chapter.chapterTitle ?? 
                       chapter.name ?? 
                       chapter.chapterName ?? 
                       null;

  const normalizedEvents = Array.isArray(chapter.events)
    ? chapter.events
        .map((event, eventIndex) => normalizeEvent(event, eventIndex + 1))
        .filter(Boolean)
    : [];

  const firstEvent = normalizedEvents[0] ?? null;
  const lastEvent = normalizedEvents.length > 0 ? normalizedEvents[normalizedEvents.length - 1] : null;

  const resolvedStartPos = toNumberOrNull(chapter.startPos ?? chapter.start);
  const resolvedEndPos = toNumberOrNull(chapter.endPos ?? chapter.end);

  const normalizedStartPos = resolvedStartPos ?? firstEvent?.startPos ?? 0;
  const normalizedEndPos = resolvedEndPos ?? lastEvent?.endPos ?? normalizedStartPos;

  return {
    ...chapter,
    idx: resolvedChapterIdx ?? index + 1,
    chapterIdx: resolvedChapterIdx ?? index + 1,
    title: resolvedTitle,
    chapterTitle: resolvedTitle,
    startPos: normalizedStartPos,
    endPos: normalizedEndPos,
    events: normalizedEvents,
  };
};

const normalizeCharacter = (character) => {
  if (!character || typeof character !== 'object' || Array.isArray(character)) {
    return null;
  }
  return {
    ...character,
    main_character: character.main_character ?? character.isMainCharacter ?? false,
    profile_text: character.profile_text ?? character.profileText ?? '',
    description: character.description ?? character.profileText ?? '',
    description_ko: character.description_ko ?? character.personalityText ?? '',
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

const normalizeChapterTitleKey = (value) => {
  if (typeof value !== 'string') return '';
  const t = value.trim();
  return t;
};

/**
 * progressMetadata.chapterLengths: 신규는 chapterTitle, 구버전은 chapterIdx 등 병행 지원.
 */
const normalizeProgressMetadata = (progressMetadata) => {
  if (!progressMetadata || typeof progressMetadata !== 'object') {
    return progressMetadata;
  }
  const rawLengths = progressMetadata.chapterLengths ?? progressMetadata.chapterCodePointLengths ?? [];
  const chapterLengths = Array.isArray(rawLengths)
    ? rawLengths.map((item) => {
        if (!item || typeof item !== 'object') return null;
        const titleRaw = item.chapterTitle ?? item.title ?? item.chapterName ?? null;
        const chapterTitle = normalizeChapterTitleKey(
          typeof titleRaw === 'string' ? titleRaw : titleRaw != null ? String(titleRaw) : ''
        );
        const chapterIdx = toNumberOrNull(item.chapterIdx ?? item.chapterIndex ?? item.idx ?? item.chapter);
        const length = toNumberOrNull(item.length ?? item.codePointLength ?? item.chapterLength);
        if (!chapterTitle && chapterIdx == null) return null;
        return {
          ...item,
          ...(chapterTitle ? { chapterTitle } : {}),
          ...(chapterIdx != null ? { chapterIdx } : {}),
          length: length ?? 0,
        };
      }).filter(Boolean)
    : [];
  const totalLength = toNumberOrNull(progressMetadata.totalLength ?? progressMetadata.totalCodePointLength)
    ?? chapterLengths.reduce((sum, e) => sum + (e?.length ?? 0), 0);
  return {
    ...progressMetadata,
    chapterLengths,
    totalLength: totalLength || progressMetadata.totalLength || 0,
  };
};

/** 챕터 본문에 붙은 길이(진도용 폴백) */
const lengthFromChapterBody = (chapter) => {
  if (!chapter || typeof chapter !== 'object') return 0;
  const tcp = toNumberOrNull(chapter.totalCodePoints);
  if (tcp != null && tcp > 0) return tcp;
  const sp = toNumberOrNull(chapter.startPos ?? chapter.start);
  const ep = toNumberOrNull(chapter.endPos ?? chapter.end);
  if (sp != null && ep != null && ep > sp) return ep - sp;
  return 0;
};

/**
 * progressMetadata.chapterLengths 항목 (제목 → idx → 배열 순서 동일 시 인덱스)
 */
const findChapterLengthEntryForChapter = (manifest, chapter) => {
  if (!chapter || typeof chapter !== 'object') return null;
  const lengths = manifest?.progressMetadata?.chapterLengths;
  if (!Array.isArray(lengths) || lengths.length === 0) return null;

  const titleKey = normalizeChapterTitleKey(chapter.title ?? chapter.chapterTitle ?? '');
  if (titleKey) {
    const byTitle = lengths.find(
      (e) => normalizeChapterTitleKey(e.chapterTitle ?? e.title ?? '') === titleKey
    );
    if (byTitle) return byTitle;
  }
  const idx = toNumberOrNull(chapter.idx ?? chapter.chapterIdx);
  if (idx != null) {
    const byIdx = lengths.find(
      (e) => toNumberOrNull(e.chapterIdx ?? e.chapterIndex ?? e.idx ?? e.chapter) === idx
    );
    if (byIdx) return byIdx;
  }
  const chs = manifest?.chapters;
  if (Array.isArray(chs) && idx != null) {
    const listIndex = chs.findIndex(
      (ch) => toNumberOrNull(ch?.idx ?? ch?.chapterIdx) === idx
    );
    if (listIndex >= 0 && lengths.length === chs.length && lengths[listIndex]) {
      return lengths[listIndex];
    }
  }
  return null;
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
        .map((chapter, index) => normalizeChapter(chapter, index))
        .filter(ch => ch != null && typeof ch === 'object')
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

export const getChapterData = (bookId, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.chapters) return null;
  
  const targetIdx = toNumberOrNull(chapterIdx);
  return manifest.chapters.find(ch => {
    if (!ch || typeof ch !== 'object') return false;
    const idx = toNumberOrNull(ch.idx);
    const chapterIdxValue = toNumberOrNull(ch.chapterIdx);
    return idx === targetIdx || chapterIdxValue === targetIdx;
  }) ?? null;
};

export const getEventData = (bookId, chapterIdx, eventIdx) => {
  const chapterData = getChapterData(bookId, chapterIdx);
  if (!chapterData || !chapterData.events) return null;
  
  const targetEventIdx = toNumberOrNull(eventIdx);
  if (targetEventIdx == null) return null;
  return chapterData.events.find(ev => toNumberOrNull(ev.idx) === targetEventIdx) ?? null;
};

export const isValidEvent = (bookId, chapterIdx, eventIdx) => {
  const chapterData = getChapterData(bookId, chapterIdx);
  if (!chapterData || !chapterData.events) return false;
  const targetEventIdx = toNumberOrNull(eventIdx);
  if (targetEventIdx == null) return false;
  return chapterData.events.some(ev => toNumberOrNull(ev.idx) === targetEventIdx);
};

export const getMaxChapter = (bookId) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.progressMetadata) return 0;
  
  return manifest.progressMetadata.maxChapter || 0;
};

export const calculateMaxChapterFromChapters = (chapters) => {
  if (!Array.isArray(chapters) || chapters.length === 0) {
    return 1;
  }
  let maxChapterIdx = 1;
  for (const chapterInfo of chapters) {
    const chapterIdx = chapterInfo?.idx || chapterInfo?.chapterIdx || chapterInfo?.chapter || chapterInfo?.index || chapterInfo?.number || chapterInfo?.id;
    if (typeof chapterIdx === 'number' && !isNaN(chapterIdx) && chapterIdx > 0 && chapterIdx > maxChapterIdx) {
      maxChapterIdx = chapterIdx;
    }
  }
  return maxChapterIdx;
};

export const getTotalLength = (bookId) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.progressMetadata) return 0;
  
  return manifest.progressMetadata.totalLength || 0;
};

export const getChapterLength = (bookId, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest?.chapters) return 0;
  const targetIdx = toNumberOrNull(chapterIdx);
  if (targetIdx == null) return 0;
  const chapterData = getChapterData(bookId, targetIdx);
  if (!chapterData) return 0;
  const fromEffective = getEffectiveChapterLengthForProgress(manifest, chapterData);
  if (fromEffective > 0) return fromEffective;
  const lengths = manifest.progressMetadata?.chapterLengths;
  if (!Array.isArray(lengths)) return 0;
  const row = lengths.find(
    (cl) => toNumberOrNull(cl.chapterIdx ?? cl.chapterIndex ?? cl.idx) === targetIdx
  );
  return toNumberOrNull(row?.length) ?? 0;
};

export const calculateApiChapterProgressFromLocator = (bookId, startLocator, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest?.chapters) {
    return { currentChars: 0, totalChars: 0, progress: 0, chapterStartPos: 0 };
  }
  const targetChapterIdx = toNumberOrNull(chapterIdx);
  if (targetChapterIdx == null) {
    return { currentChars: 0, totalChars: 0, progress: 0, chapterStartPos: 0 };
  }
  const chapterData = manifest.chapters.find((ch) => {
    const idx = toNumberOrNull(ch.idx);
    const chapterIdxValue = toNumberOrNull(ch.chapterIdx);
    return idx === targetChapterIdx || chapterIdxValue === targetChapterIdx;
  });
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
      const chIdx = toNumberOrNull(ch.idx ?? ch.chapterIdx);
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
  const targetChapterIdx = toNumberOrNull(chapterIdx);
  
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
    const idx = Number(sourceEvent.eventIdx ?? sourceEvent.idx ?? sourceEvent.eventNum ?? sourceEvent.id);
    if (!Number.isFinite(idx)) return;

    const existing = eventsMap.get(idx) ?? {};
    const normalized = { ...existing, ...sourceEvent };

    const startPos = Number(normalized.startTxtOffset ?? normalized.startPos ?? 0);
    const endPosCandidate = Number(normalized.endTxtOffset ?? normalized.endPos ?? startPos);
    const endPos = Number.isFinite(endPosCandidate) ? endPosCandidate : startPos;

    normalized.startPos = Number.isFinite(startPos) ? startPos : 0;
    normalized.endPos = endPos >= normalized.startPos ? endPos : normalized.startPos;
    normalized.startTxtOffset = normalized.startPos;
    normalized.endTxtOffset = normalized.endPos;

    normalized.eventIdx = idx;
    normalized.idx = normalized.idx ?? idx;

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
    const idxA = Number(a.eventIdx ?? a.idx ?? 0);
    const idxB = Number(b.eventIdx ?? b.idx ?? 0);
    if (idxA !== idxB) {
      return idxA - idxB;
    }
    const startA = Number(a.startTxtOffset ?? a.startPos ?? 0);
    const startB = Number(b.startTxtOffset ?? b.startPos ?? 0);
    return startA - startB;
  });
  
  const base = typeof chapterStartPos === 'number' ? chapterStartPos : 0;
  const firstEvent = mergedEvents[0];

  let isRelativePositions = false;
  if (firstEvent) {
    const firstStart = Number(firstEvent.startTxtOffset ?? firstEvent.startPos ?? 0);
    if (base > 0 && firstStart >= 0 && firstStart < base) {
      isRelativePositions = true;
    }
  }

  const position = isRelativePositions ? currentChars : base + currentChars;

  if (firstEvent) {
    const firstStart = Number(firstEvent.startTxtOffset ?? firstEvent.startPos ?? 0);
    const firstEndRaw = Number(firstEvent.endTxtOffset ?? firstEvent.endPos ?? firstStart);
    const _span = Math.max(firstEndRaw - firstStart, 1);
    if (position <= firstStart) {
      return {
        ...firstEvent,
        eventIdx: firstEvent.eventIdx ?? firstEvent.idx,
        chapterIdx: targetChapterIdx,
        progress: 0,
        __useRelative: isRelativePositions
      };
    }
  }

  for (let i = 0; i < mergedEvents.length; i++) {
    const event = mergedEvents[i];
    const eventStartPos = Number(event.startTxtOffset ?? event.startPos ?? 0);
    const eventEndPosRaw = Number(event.endTxtOffset ?? event.endPos ?? eventStartPos);
    const eventEndPos = eventEndPosRaw > eventStartPos ? eventEndPosRaw : eventStartPos + 1;
    
    if (position >= eventStartPos && position < eventEndPos) {
      const span = Math.max(eventEndPos - eventStartPos, 1);
      const rawProgress = ((position - eventStartPos) / span) * 100;
      const clampedProgress = Math.min(Math.max(rawProgress, 0), 100);
      return {
        ...event,
        eventIdx: event.eventIdx ?? event.idx,
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
      eventIdx: lastEvent.eventIdx ?? lastEvent.idx,
      chapterIdx: targetChapterIdx,
      progress: 100,
      __useRelative: isRelativePositions
    };
  }
  
  return null;
};
