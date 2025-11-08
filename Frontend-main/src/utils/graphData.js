import { createCharacterMaps } from './characterUtils';
import { getMaxChapter, getChapterData } from './common/manifestCache';
import { getCachedChapterEvents } from './common/chapterEventCache';

const API_PREFIX = 'api:';
const EVENTS_CACHE_LIMIT = 100;
const CHARACTER_CACHE_LIMIT = 50;

const eventsCache = new Map();
const characterMapsCache = new Map();

const cleanupCache = (cache, limit) => {
  if (cache.size <= limit) return;
  const entries = Array.from(cache.entries());
  const excess = cache.size - limit;
  entries.slice(0, excess).forEach(([key]) => cache.delete(key));
};

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

const normalizeManifestEvents = (bookId, chapterIdx, manifestChapter) => {
  if (!manifestChapter?.events?.length) {
    return [];
  }

  return manifestChapter.events
    .map((event, index) => {
      if (!event) return null;

      const eventIdx = Number(
        event.idx ?? event.eventIdx ?? event.index ?? event.id ?? index + 1
      );
      if (!Number.isFinite(eventIdx) || eventIdx <= 0) {
        return null;
      }

      const characters = Array.isArray(event.characters) ? event.characters : [];
      const relations = Array.isArray(event.relations) ? event.relations : [];

      return {
        bookId,
        chapterIdx,
        eventIdx,
        characters,
        relations,
        event: {
          ...event,
          idx: eventIdx,
          chapterIdx,
          event_id: event.event_id ?? event.eventId ?? eventIdx,
        },
      };
    })
    .filter(Boolean);
};

const getChapterEventsSnapshot = (bookId, chapterIdx) => {
  if (!bookId || !chapterIdx || chapterIdx < 1) {
    return null;
  }

  const cacheKey = `${bookId}:${chapterIdx}`;

  if (eventsCache.has(cacheKey)) {
    return eventsCache.get(cacheKey);
  }

  const cachedEvents = getCachedChapterEvents(bookId, chapterIdx);
  if (cachedEvents?.events?.length) {
    eventsCache.set(cacheKey, cachedEvents);
    cleanupCache(eventsCache, EVENTS_CACHE_LIMIT);
    return cachedEvents;
  }

  const manifestChapter = getChapterData(bookId, chapterIdx);
  const normalizedEvents = normalizeManifestEvents(bookId, chapterIdx, manifestChapter);

  if (normalizedEvents.length === 0) {
    return null;
  }

  const snapshot = {
    bookId,
    chapterIdx,
    events: normalizedEvents,
    maxEventIdx: normalizedEvents.reduce((max, ev) => Math.max(max, ev.eventIdx), 0),
  };

  eventsCache.set(cacheKey, snapshot);
  cleanupCache(eventsCache, EVENTS_CACHE_LIMIT);
  return snapshot;
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

export function getEventsForChapter(chapter, folderKey) {
  const bookId = extractBookId(folderKey);
  if (!bookId || !chapter || chapter < 1) {
    return [];
  }

  const snapshot = getChapterEventsSnapshot(bookId, chapter);
  if (!snapshot?.events) {
    return [];
  }

  return snapshot.events.map((event) => ({
    ...event,
    chapter,
    chapterIdx: chapter,
    eventNum: event.eventIdx ?? 0,
    event_id: event.event?.event_id ?? event.eventIdx ?? 0,
    relations: Array.isArray(event.relations) ? event.relations : [],
    characters: Array.isArray(event.characters) ? event.characters : [],
  }));
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
  if (!snapshot?.events?.length) {
    return null;
  }

  const event = snapshot.events.find((entry) => Number(entry.eventIdx) === Number(eventIndex));
  if (!event) {
    return null;
  }

  const nodeWeights = {};
  if (Array.isArray(event.characters)) {
    event.characters.forEach((character) => {
      if (!character || character.id === undefined || character.id === null) return;
      const id = String(Math.trunc(character.id));
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

  const characterMap = new Map();

  events.forEach((event) => {
    if (!Array.isArray(event.characters)) return;
    event.characters.forEach((character) => {
      if (!character || character.id === undefined || character.id === null) return;
      const id = String(Math.trunc(character.id));
      characterMap.set(id, character);
    });
  });

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
    if (characterMapsCache.has(cacheKey)) {
      return characterMapsCache.get(cacheKey);
    }

    const maps = createCharacterMaps(characters);
    characterMapsCache.set(cacheKey, maps);
    cleanupCache(characterMapsCache, CHARACTER_CACHE_LIMIT);
    return maps;
  } catch (error) {
    return { idToName: {}, idToDesc: {}, idToDescKo: {}, idToMain: {}, idToNames: {}, idToProfileImage: {} };
  }
}

export function getCharacterPerspectiveSummary() {
  return null;
}