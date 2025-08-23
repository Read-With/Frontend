const relationshipModules = import.meta.glob(
  "../data/gatsby/chapter*_relationships_event_*.json",
  { eager: true }
);

const charactersModules = import.meta.glob(
  "../data/gatsby/c_chapter*_0.json",
  { eager: true }
);

// Pre-index relationships by chapter and event index (1-based as in filenames)
const relationshipIndex = new Map(); // key: `${chapter}:${eventIndex}` -> json
const chapterMaxEventIndex = new Map(); // key: `${chapter}` -> max event index

for (const path of Object.keys(relationshipModules)) {
  // path example: ../data/gatsby/chapter3_relationships_event_12.json
  const match = path.match(/chapter(\d+)_relationships_event_(\d+)\.json$/);
  if (!match) continue;
  const chapter = Number(match[1]);
  const eventIndex = Number(match[2]); // 1-based index
  relationshipIndex.set(`${chapter}:${eventIndex}`, relationshipModules[path]?.default);
  const key = String(chapter);
  const currentMax = chapterMaxEventIndex.get(key) || 0;
  if (eventIndex > currentMax) chapterMaxEventIndex.set(key, eventIndex);
}

// Pre-index characters by chapter
const charactersIndex = new Map(); // key: `${chapter}` -> json
for (const path of Object.keys(charactersModules)) {
  // path example: ../data/gatsby/c_chapter3_0.json
  const match = path.match(/c_chapter(\d+)_0\.json$/);
  if (!match) continue;
  const chapter = Number(match[1]);
  charactersIndex.set(`${chapter}`, charactersModules[path]?.default);
}

export function getCharactersData(chapter) {
  return charactersIndex.get(String(chapter)) ?? null;
}

// Get event JSON by 1-based event index (as in filename)
export function getEventDataByIndex(chapter, eventIndex) {
  return relationshipIndex.get(`${chapter}:${eventIndex}`) ?? null;
}

// Get event JSON by zero-based eventId used in UI/state; adds +1 internally
export function getEventData(chapter, eventIdZeroBased) {
  const eventIndex = Number(eventIdZeroBased) + 1;
  return getEventDataByIndex(chapter, eventIndex);
}

// For a chapter, return last available event index by scanning the index
export function getLastEventIndexForChapter(chapter) {
  return chapterMaxEventIndex.get(String(chapter)) || 0;
}

// Array of last event indices for chapters 1..maxChapter
export function getChapterLastEventNums(maxChapter = 10) {
  const lastNums = [];
  for (let chapter = 1; chapter <= maxChapter; chapter++) {
    lastNums.push(getLastEventIndexForChapter(chapter));
  }
  return lastNums;
}

export function getMaxEventCount(maxChapter = 10) {
  const lastEventNums = getChapterLastEventNums(maxChapter);
  return Math.max(...lastEventNums, 1);
}

// Helper to get normalized relations array from an event file (raw JSON)
export function getEventRelations(chapter, eventIndex) {
  const json = getEventDataByIndex(chapter, eventIndex);
  if (!json) return [];
  return Array.isArray(json.relations) ? json.relations : [];
}


