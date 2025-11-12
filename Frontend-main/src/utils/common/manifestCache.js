const manifestCachePrefix = 'manifest_cache_';
const MANIFEST_TTL_MS = 1000 * 60 * 15; // 15분

const memoryCache = new Map();
const prefetchPromises = new Map();

export const getManifestCacheKey = (bookId) => {
  return `${manifestCachePrefix}${bookId}`;
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const normalizeEvent = (event, fallbackIdx) => {
  if (!event) return null;

  const resolvedIdx = toNumberOrNull(
    event.idx ?? event.eventIdx ?? event.index ?? event.id ?? fallbackIdx
  );

  const startPos = toNumberOrNull(event.startPos ?? event.start ?? event.begin);
  const endPos = toNumberOrNull(event.endPos ?? event.end ?? event.finish);

  return {
    ...event,
    idx: resolvedIdx ?? fallbackIdx ?? null,
    eventIdx: resolvedIdx ?? fallbackIdx ?? null,
    startPos: startPos ?? 0,
    endPos: endPos ?? 0,
    start: startPos ?? null,
    end: endPos ?? null,
  };
};

const normalizeChapter = (chapter, index) => {
  if (!chapter || typeof chapter !== 'object') {
    return chapter;
  }

  const resolvedChapterIdx = toNumberOrNull(
    chapter.chapterIdx ?? chapter.idx ?? chapter.chapter ?? chapter.number ?? index + 1
  );

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
    startPos: normalizedStartPos,
    endPos: normalizedEndPos,
    events: normalizedEvents,
  };
};

const normalizeManifestData = (manifestData) => {
  if (!manifestData || typeof manifestData !== 'object') {
    return manifestData;
  }

  const normalizedChapters = Array.isArray(manifestData.chapters)
    ? manifestData.chapters.map((chapter, index) => normalizeChapter(chapter, index))
    : manifestData.chapters;

  return {
    ...manifestData,
    chapters: normalizedChapters,
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

    memoryCache.set(String(bookId), payload);

    if (persist && typeof localStorage !== 'undefined') {
      localStorage.setItem(cacheKey, JSON.stringify(payload));
    }

    return normalizedData;
  } catch (error) {
    console.error('Manifest 캐시 저장 실패:', error);
    return null;
  }
};

const readFromLocalStorage = (bookId) => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const cacheKey = getManifestCacheKey(bookId);
    const cached = localStorage.getItem(cacheKey);
    if (!cached) {
      return null;
    }

    const parsed = JSON.parse(cached);
    if (!parsed || typeof parsed !== 'object') {
      localStorage.removeItem(cacheKey);
      return null;
    }

    if (isExpired(parsed.timestamp)) {
      localStorage.removeItem(cacheKey);
      return null;
    }

    memoryCache.set(String(bookId), parsed);
    return parsed;
  } catch (error) {
    console.error('Manifest 캐시 로드 실패:', error);
    return null;
  }
};

export const getManifestFromCache = (bookId) => {
  if (!bookId) return null;

  const key = String(bookId);
  const cachedInMemory = memoryCache.get(key);
  if (cachedInMemory && !isExpired(cachedInMemory.timestamp)) {
    return cachedInMemory.data;
  }

  const fromStorage = readFromLocalStorage(bookId);
  return fromStorage?.data ?? null;
};

export const hasManifestData = (bookId) => {
  const key = String(bookId);
  const cachedInMemory = memoryCache.get(key);
  if (cachedInMemory && !isExpired(cachedInMemory.timestamp)) {
    return true;
  }
  const fromStorage = readFromLocalStorage(bookId);
  return !!fromStorage?.data;
};

export const invalidateManifest = (bookId) => {
  if (!bookId) return;
  const key = String(bookId);
  memoryCache.delete(key);
  if (typeof localStorage !== 'undefined') {
    const cacheKey = getManifestCacheKey(bookId);
    localStorage.removeItem(cacheKey);
  }
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

const normalizeChapterIdxValue = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const getChapterData = (bookId, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.chapters) return null;
  
  const targetIdx = normalizeChapterIdxValue(chapterIdx);
  return manifest.chapters.find(ch => {
    const idx = normalizeChapterIdxValue(ch.idx);
    const chapterIdxValue = normalizeChapterIdxValue(ch.chapterIdx);
    return idx === targetIdx || chapterIdxValue === targetIdx;
  });
};

export const getEventData = (bookId, chapterIdx, eventIdx) => {
  const chapterData = getChapterData(bookId, chapterIdx);
  if (!chapterData || !chapterData.events) return null;
  
  return chapterData.events.find(ev => ev.idx === eventIdx);
};

export const isValidEvent = (bookId, chapterIdx, eventIdx) => {
  const chapterData = getChapterData(bookId, chapterIdx);
  if (!chapterData || !chapterData.events) return false;
  
  return chapterData.events.some(ev => ev.idx === eventIdx);
};

export const getMaxChapter = (bookId) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.progressMetadata) return 0;
  
  return manifest.progressMetadata.maxChapter || 0;
};

export const getTotalLength = (bookId) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.progressMetadata) return 0;
  
  return manifest.progressMetadata.totalLength || 0;
};

export const getChapterLength = (bookId, chapterIdx) => {
  const manifest = getManifestFromCache(bookId);
  if (!manifest || !manifest.progressMetadata || !manifest.progressMetadata.chapterLengths) {
    return 0;
  }
  
  const chapterLength = manifest.progressMetadata.chapterLengths.find(
    cl => cl.chapterIdx === chapterIdx
  );
  
  return chapterLength?.length || 0;
};

/**
 * 로컬 CFI 기반 챕터 진행도 계산
 * @param {number|string} bookId - 책 ID
 * @param {string} cfi - 로컬 CFI (현재 보고 있는 EPUB의 CFI)
 * @param {number} chapterIdx - 챕터 인덱스
 * @param {Object} bookInstance - EPUB.js book 인스턴스 (로컬 EPUB)
 * @returns {Object} 진행도 정보
 */
export const calculateApiChapterProgress = (bookId, cfi, chapterIdx, bookInstance = null) => {
  const manifest = getManifestFromCache(bookId);
  
  if (!manifest || !manifest.chapters) {
    console.warn('Manifest 없음:', { bookId, hasManifest: !!manifest, hasChapters: !!manifest?.chapters });
    return { currentChars: 0, totalChars: 0, progress: 0 };
  }
  
  const targetChapterIdx = normalizeChapterIdxValue(chapterIdx);
  if (targetChapterIdx === null) {
    console.warn('유효하지 않은 chapterIdx:', { chapterIdx });
    return { currentChars: 0, totalChars: 0, progress: 0 };
  }
  
  const chapterData = manifest.chapters.find(ch => {
    const idx = normalizeChapterIdxValue(ch.idx);
    const chapterIdxValue = normalizeChapterIdxValue(ch.chapterIdx);
    return idx === targetChapterIdx || chapterIdxValue === targetChapterIdx;
  });
  
  if (!chapterData) {
    console.warn('챕터 데이터 없음:', { bookId, chapterIdx: targetChapterIdx, availableChapters: manifest.chapters.map(ch => normalizeChapterIdxValue(ch.idx) ?? normalizeChapterIdxValue(ch.chapterIdx)) });
    return { currentChars: 0, totalChars: 0, progress: 0 };
  }
  
  const extractChapterIdx = (item) => {
    if (!item) return null;
    return normalizeChapterIdxValue(item.chapterIdx ?? item.idx ?? item.chapter ?? item.number ?? null);
  };

  const chapterLengths = Array.isArray(manifest.progressMetadata?.chapterLengths)
    ? manifest.progressMetadata.chapterLengths
    : [];

  const lengthEntry = chapterLengths.find((entry) => extractChapterIdx(entry) === targetChapterIdx);

  const fallbackLengthFromEvents = () => {
    if (!Array.isArray(chapterData.events) || chapterData.events.length === 0) {
      return 0;
    }
    const firstEvent = chapterData.events[0];
    const lastEvent = chapterData.events[chapterData.events.length - 1];
    const span = (lastEvent?.endPos ?? 0) - (firstEvent?.startPos ?? 0);
    return span > 0 ? span : 0;
  };

  let totalChars = 0;

  if (typeof chapterData.endPos === 'number' && typeof chapterData.startPos === 'number') {
    const span = chapterData.endPos - chapterData.startPos;
    if (span > 0) {
      totalChars = span;
    }
  }

  if (totalChars <= 0 && lengthEntry?.length) {
    totalChars = lengthEntry.length;
  }

  if (totalChars <= 0) {
    totalChars = fallbackLengthFromEvents();
  }

  let chapterStartPos = typeof chapterData.startPos === 'number' ? chapterData.startPos : null;

  if ((chapterStartPos === null || chapterStartPos <= 0) && targetChapterIdx > 1 && chapterLengths.length > 0) {
    const sortedLengths = [...chapterLengths].sort((a, b) => {
      const aIdx = extractChapterIdx(a) ?? 0;
      const bIdx = extractChapterIdx(b) ?? 0;
      return aIdx - bIdx;
    });

    let cumulative = 0;
    for (const entry of sortedLengths) {
      const entryIdx = extractChapterIdx(entry);
      if (!entryIdx || entryIdx >= targetChapterIdx) break;
      cumulative += entry.length || 0;
    }

    if (cumulative > 0) {
      chapterStartPos = cumulative;
    }
  }

  if (chapterStartPos === null || chapterStartPos < 0) {
    chapterStartPos = 0;
  }

  if (totalChars <= 0) {
    console.warn('totalChars 계산 실패, 기본값 0 유지', { chapterIdx, chapterData, lengthEntry });
  }
   
  // 로컬 EPUB의 locations를 사용하여 CFI 기반 진행도 계산
  if (!bookInstance?.locations?.percentageFromCfi) {
    console.warn('bookInstance.locations 없음');
    return { currentChars: 0, totalChars, progress: 0, chapterStartPos };
  }
   
  try {
    // 로컬 CFI를 사용하여 진행도 계산
    const bookProgress = bookInstance.locations.percentageFromCfi(cfi);
    const totalLength = manifest.progressMetadata?.totalLength || 0;
    
    if (totalLength === 0) {
      console.warn('totalLength가 0:', { totalLength, progressMetadata: manifest.progressMetadata });
      return { currentChars: 0, totalChars, progress: 0, chapterStartPos };
    }
    
    const globalCurrentChars = Math.round(bookProgress * totalLength);
    const chapterCurrentChars = Math.max(0, globalCurrentChars - chapterStartPos);
    const progress = totalChars > 0 ? (chapterCurrentChars / totalChars) * 100 : 0;
    
    return {
      currentChars: totalChars > 0 ? Math.min(chapterCurrentChars, totalChars) : chapterCurrentChars,
      totalChars,
      progress: Math.round(progress * 100) / 100,
      chapterStartPos,
      absoluteCurrent: chapterStartPos + Math.max(0, Math.min(chapterCurrentChars, totalChars)),
      lengthSource: totalChars > 0 ? 'chapter' : 'unknown'
    };
  } catch (error) {
    console.error('로컬 CFI 기반 챕터 진행도 계산 실패:', error);
    return { currentChars: 0, totalChars, progress: 0, chapterStartPos };
  }
};

export const findApiEventFromChars = async (bookId, chapterIdx, currentChars, chapterStartPos = 0) => {
  const targetChapterIdx = normalizeChapterIdxValue(chapterIdx);
  
  // 1. 먼저 새 캐시 시스템에서 이벤트 정보 가져오기
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

    const startPos = Number(normalized.startPos ?? normalized.start ?? 0);
    const endPosCandidate = Number(normalized.endPos ?? normalized.end ?? normalized.finish ?? startPos);
    const endPos = Number.isFinite(endPosCandidate) ? endPosCandidate : startPos;

    normalized.startPos = Number.isFinite(startPos) ? startPos : 0;
    normalized.endPos = endPos >= normalized.startPos ? endPos : normalized.startPos;

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
    const startA = Number(a.startPos ?? a.start ?? 0);
    const startB = Number(b.startPos ?? b.start ?? 0);
    return startA - startB;
  });
  
  const base = typeof chapterStartPos === 'number' ? chapterStartPos : 0;
  const firstEvent = mergedEvents[0];

  let isRelativePositions = false;
  if (firstEvent) {
    const firstStart = Number(firstEvent.startPos ?? firstEvent.start ?? 0);
    if (base > 0 && firstStart >= 0 && firstStart < base) {
      isRelativePositions = true;
    }
  }

  const position = isRelativePositions ? currentChars : base + currentChars;

  if (firstEvent) {
    const firstStart = Number(firstEvent.startPos ?? firstEvent.start ?? 0);
    const firstEndRaw = Number(firstEvent.endPos ?? firstEvent.end ?? firstStart);
    const span = Math.max(firstEndRaw - firstStart, 1);
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
    const eventStartPos = Number(event.startPos ?? event.start ?? 0);
    const eventEndPosRaw = Number(event.endPos ?? event.end ?? eventStartPos);
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
  
  // 마지막 이벤트 반환
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
