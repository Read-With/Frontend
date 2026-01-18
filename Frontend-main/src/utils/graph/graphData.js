import { toNumberOrNull } from '../numberUtils';
import { sortEventsByIdx } from '../eventUtils';
import { createCharacterMaps, normalizeCharacterId, aggregateCharactersFromEvents } from '../characterUtils';
import { getMaxChapter, getChapterData } from '../common/cache/manifestCache';
import { getCachedChapterEvents, reconstructChapterGraphState, normalizeManifestEvents } from '../common/cache/chapterEventCache';
import { registerCache, getCacheItem, setCacheItem } from '../common/cache/cacheManager';
import { eventUtils } from '../viewerUtils';

const API_PREFIX = 'api:';
const CHARACTER_CACHE_LIMIT = 50;

const characterMapsCache = new Map();

registerCache('characterMapsCache', characterMapsCache, {
  maxSize: CHARACTER_CACHE_LIMIT,
  ttl: null,
  cleanupInterval: 600000
});

const extractBookId = (folderKeyOrFilename) => {
  if (!folderKeyOrFilename) return null;

  if (typeof folderKeyOrFilename === 'number') {
    return Number.isFinite(folderKeyOrFilename) && folderKeyOrFilename > 0
      ? folderKeyOrFilename
      : null;
  }

  const key = String(folderKeyOrFilename).trim();
  if (!key) return null;

  if (key.startsWith(API_PREFIX)) {
    const parsed = Number(key.slice(API_PREFIX.length));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  const parsed = Number(key);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const getChapterEventsSnapshot = (bookId, chapterIdx) => {
  if (!bookId || !chapterIdx || chapterIdx < 1) {
    return null;
  }

  const cachedEvents = getCachedChapterEvents(bookId, chapterIdx);
  if (cachedEvents?.events?.length) {
    return cachedEvents;
  }

  const manifestChapter = getChapterData(bookId, chapterIdx);
  const normalizedEvents = normalizeManifestEvents(bookId, chapterIdx, manifestChapter);

  if (normalizedEvents.length === 0) {
    return null;
  }

  return {
    bookId,
    chapterIdx,
    events: normalizedEvents,
    maxEventIdx: normalizedEvents.reduce((max, ev) => Math.max(max, ev.eventIdx), 0),
  };
};

export function getFolderKeyFromFilename(filename) {
  const bookId = extractBookId(filename);
  if (!bookId) return null;
  return `${API_PREFIX}${bookId}`;
}

export function getDetectedMaxChapter(folderKey) {
  const bookId = extractBookId(folderKey);
  if (!bookId) return 0;

  const manifestMax = getMaxChapter(bookId);
  return manifestMax && manifestMax > 0 ? manifestMax : 0;
}

export function getSafeMaxChapter(folderKey, fallback = 1) {
  const detected = getDetectedMaxChapter(folderKey);
  return detected > 0 ? detected : fallback;
}

export function getAllFolderKeys() {
  return [];
}

const convertElementsToRelations = (elements) => {
  return eventUtils.convertElementsToRelations(elements, {
    includeLabel: true,
    includeCount: false,
    positivityDefault: null
  });
};

export function getEventsForChapter(chapter, folderKey) {
  const bookId = extractBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) {
    return [];
  }

  const snapshot = getChapterEventsSnapshot(bookId, chapter);
  if (!snapshot) {
    return [];
  }

  const hasDiffCache =
    snapshot.baseSnapshot && Array.isArray(snapshot.diffs);

  const eventMetas = Array.isArray(snapshot.events)
    ? snapshot.events
    : [];

  if (!hasDiffCache) {
    return eventMetas.map((event) => ({
      ...event,
      chapter,
      chapterIdx: chapter,
      eventNum: event.eventIdx ?? event.idx ?? 0,
      event_id: event.event?.event_id ?? event.eventIdx ?? event.idx ?? 0,
      relations: Array.isArray(event.relations) ? event.relations : [],
      characters: Array.isArray(event.characters) ? event.characters : [],
    }));
  }

  return eventMetas.map((eventMeta) => {
    const targetEventIdx = Number(eventMeta?.eventIdx) || 0;
    const reconstructed = reconstructChapterGraphState(
      snapshot,
      targetEventIdx
    );

    const characters = reconstructed?.characters || [];
    const relations = convertElementsToRelations(
      reconstructed?.elements || []
    );

    return {
      ...eventMeta,
      chapter,
      chapterIdx: chapter,
      eventNum: targetEventIdx,
      event_id:
        reconstructed?.eventMeta?.event_id ??
        eventMeta.eventId ??
        targetEventIdx,
      event: reconstructed?.eventMeta ?? eventMeta?.event ?? null,
      relations,
      characters,
    };
  });
}

export function getLastEventIndexForChapter(folderKey, chapter) {
  const bookId = extractBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) {
    return 0;
  }

  const snapshot = getChapterEventsSnapshot(bookId, chapter);
  if (snapshot?.maxEventIdx) {
    return snapshot.maxEventIdx;
  }

  if (snapshot?.events?.length) {
    return snapshot.events.reduce((max, ev) => Math.max(max, ev.eventIdx || 0), 0);
  }

  return 0;
}

export function getChapterLastEventNums(folderKey) {
  const maxChapter = getDetectedMaxChapter(folderKey);
  if (!maxChapter || maxChapter < 1) {
    return [];
  }

  const result = [];
  for (let chapter = 1; chapter <= maxChapter; chapter += 1) {
    result.push(getLastEventIndexForChapter(folderKey, chapter));
  }
  return result;
}

export function getChapterEventCount(chapter, folderKey) {
  const events = getEventsForChapter(chapter, folderKey);
  return Array.isArray(events) ? events.length : 0;
}

export function getMaxEventCount(folderKey) {
  const lastEventNums = getChapterLastEventNums(folderKey);
  if (!lastEventNums.length) {
    return 1;
  }
  return Math.max(...lastEventNums, 1);
}

export function getEventDataByIndex(folderKey, chapter, eventIndex) {
  const bookId = extractBookId(folderKey);
  if (!bookId || !chapter || chapter < 1 || !eventIndex || eventIndex < 1) {
    return null;
  }

  const snapshot = getChapterEventsSnapshot(bookId, chapter);
  const events = getEventsForChapter(chapter, folderKey);
  if (!events.length) {
    return null;
  }

  const event = events.find(
    (entry) => toNumberOrNull(entry.eventIdx) === toNumberOrNull(eventIndex)
  );
  if (!event) {
    return null;
  }

  const nodeWeights = {};
  if (Array.isArray(event.characters)) {
    event.characters.forEach((character) => {
      const id = normalizeCharacterId(character?.id);
      if (!id) return;
      nodeWeights[id] = {
        weight: typeof character.weight === 'number' ? character.weight : null,
        count: typeof character.count === 'number' ? character.count : null,
      };
    });
  }

  return {
    chapter,
    chapterIdx: chapter,
    eventIdx: event.eventIdx ?? eventIndex,
    event_id: event.event?.event_id ?? event.eventIdx ?? eventIndex,
    relations: Array.isArray(event.relations) ? event.relations : [],
    characters: Array.isArray(event.characters) ? event.characters : [],
    event: event.event || null,
    node_weights_accum: Object.keys(nodeWeights).length ? nodeWeights : null,
  };
}

export function getCharactersData(folderKey, chapter) {
  const events = getEventsForChapter(chapter, folderKey);
  if (!events.length) {
    return { characters: [] };
  }

  const characterMap = aggregateCharactersFromEvents(events);

  return { characters: Array.from(characterMap.values()) };
}

export function getCharactersDataFromMaxChapter(folderKey) {
  const maxChapter = getDetectedMaxChapter(folderKey);
  if (!maxChapter || maxChapter < 1) {
    return null;
  }
  return getCharactersData(folderKey, maxChapter);
}

export function createCharacterMapsWithCache(characters) {
  try {
    const cacheKey = JSON.stringify(characters);
    const cached = getCacheItem('characterMapsCache', cacheKey);
    if (cached) {
      return cached;
    }

    const maps = createCharacterMaps(characters);
    setCacheItem('characterMapsCache', cacheKey, maps);
    return maps;
  } catch (error) {
    return { idToName: {}, idToDesc: {}, idToDescKo: {}, idToMain: {}, idToNames: {}, idToProfileImage: {} };
  }
}

export function getCharacterPerspectiveSummary() {
  return null;
}