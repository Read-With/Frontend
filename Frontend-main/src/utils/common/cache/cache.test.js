import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  canResolveProgressMetrics,
  invalidateManifest,
  locatorFromBookAbsoluteOffset,
  locatorFromChapterLocalOffset,
  locatorToBookAbsoluteOffset,
  readingProgressPercentFromLocator,
  resolveFineGraphLocatorToEventParams,
  resolveProgressMetricsFromLocator,
  absoluteOffsetFromReadingProgressPercent,
  setManifestData,
} from './manifestCache.js';
import { clearCache, getCacheItem } from './cacheManager.js';
import {
  ensureProgressRowLocator,
  setProgressToCache,
  getProgressFromCache,
  removeProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
} from './progressCache.js';

const sampleManifest = {
  chapters: [
    {
      idx: 1,
      totalCodePoints: 100,
      paragraphStarts: [0, 50],
      paragraphLengths: [50, 50],
    },
    {
      idx: 2,
      totalCodePoints: 50,
      paragraphStarts: [0],
      paragraphLengths: [50],
    },
  ],
  progressMetadata: {
    chapterLengths: [
      { chapterIdx: 1, length: 100 },
      { chapterIdx: 2, length: 50 },
    ],
    totalLength: 150,
  },
};

describe('manifestCache progress metrics', () => {
  const bookId = 99;

  it('canResolveProgressMetrics', () => {
    expect(canResolveProgressMetrics(bookId, sampleManifest)).toBe(true);
    expect(canResolveProgressMetrics(bookId, { chapters: [] })).toBe(false);
  });

  it('locator progress metrics round-trip', () => {
    const manifestOverride = sampleManifest;
    const start = { chapterIndex: 1, blockIndex: 0, offset: 0 };
    const mid = { chapterIndex: 1, blockIndex: 0, offset: 49 };
    const end = { chapterIndex: 2, blockIndex: 0, offset: 49 };

    expect(locatorToBookAbsoluteOffset(bookId, start, manifestOverride)).toBe(0);
    expect(locatorToBookAbsoluteOffset(bookId, mid, manifestOverride)).toBe(49);
    expect(locatorToBookAbsoluteOffset(bookId, end, manifestOverride)).toBe(149);

    expect(readingProgressPercentFromLocator(bookId, start, manifestOverride)).toBe(0);
    expect(readingProgressPercentFromLocator(bookId, end, manifestOverride)).toBe(100);

    const pageEncoded = { chapterIndex: 1, blockIndex: 0, offset: 49 };
    const pageEncodedMetrics = resolveProgressMetricsFromLocator(bookId, pageEncoded, manifestOverride);
    expect(pageEncodedMetrics?.chapterProgress).toBeGreaterThanOrEqual(48);
    expect(pageEncodedMetrics?.chapterProgress).toBeLessThanOrEqual(51);

    const midMetrics = resolveProgressMetricsFromLocator(bookId, mid, manifestOverride);
    expect(midMetrics?.readingProgressPercent).toBe(33);
    expect(midMetrics?.chapterProgress).toBeGreaterThanOrEqual(48);
    expect(midMetrics?.chapterProgress).toBeLessThanOrEqual(51);

    const abs = absoluteOffsetFromReadingProgressPercent(bookId, 33, manifestOverride);
    const restored = locatorFromBookAbsoluteOffset(bookId, abs, manifestOverride);
    expect(restored).toEqual({ chapterIndex: 1, blockIndex: 0, offset: 49 });
  });

  it('legacy page-encoded blockIndex uses offset as chapter-local', () => {
    const blobManifest = {
      chapters: [{ idx: 1, totalCodePoints: 100 }],
      progressMetadata: {
        chapterLengths: [{ chapterIdx: 1, length: 100 }],
        totalLength: 100,
      },
    };
    const legacy = { chapterIndex: 1, blockIndex: 12, offset: 40 };
    const metrics = resolveProgressMetricsFromLocator(bookId, legacy, blobManifest);
    expect(metrics?.chapterProgress).toBe(40);
    expect(metrics?.readingProgressPercent).toBe(40);
  });
});

describe('manifestCache event locator matching', () => {
  const bookId = 77;

  const eventManifest = {
    chapters: [
      {
        idx: 1,
        totalCodePoints: 1000,
        paragraphStarts: [0, 400, 800],
        paragraphLengths: [400, 400, 200],
        events: [
          { idx: 1, eventNum: 1, eventId: 'e1', startTxtOffset: 0, endTxtOffset: 200 },
          { idx: 2, eventNum: 2, eventId: 'e2', startTxtOffset: 200, endTxtOffset: 500 },
          { idx: 3, eventNum: 3, eventId: 'e3', startTxtOffset: 500, endTxtOffset: 1000 },
        ],
      },
    ],
  };

  beforeEach(() => {
    setManifestData(bookId, eventManifest, { persist: false });
  });

  afterEach(() => {
    invalidateManifest(bookId);
  });

  it('maps locator at event boundaries to the correct event', () => {
    const cases = [
      { local: 0, eventNum: 1 },
      { local: 199, eventNum: 1 },
      { local: 200, eventNum: 2 },
      { local: 499, eventNum: 2 },
      { local: 500, eventNum: 3 },
      { local: 999, eventNum: 3 },
    ];

    for (const { local, eventNum } of cases) {
      const chapter = eventManifest.chapters[0];
      const locator = locatorFromChapterLocalOffset(chapter, local);
      const resolved = resolveFineGraphLocatorToEventParams(bookId, locator, 1, eventManifest);
      expect(resolved, `local=${local}`).toMatchObject({
        chapterIdx: 1,
        eventIdx: eventNum,
        eventId: `e${eventNum}`,
        resolved: true,
      });
    }
  });

  it('picks the preceding event inside a gap between manifest ranges', () => {
    const gapManifest = {
      chapters: [
        {
          idx: 1,
          totalCodePoints: 500,
          events: [
            { idx: 1, eventNum: 1, eventId: 'a', startTxtOffset: 0, endTxtOffset: 100 },
            { idx: 2, eventNum: 2, eventId: 'b', startTxtOffset: 200, endTxtOffset: 300 },
          ],
        },
      ],
    };
    setManifestData(bookId, gapManifest, { persist: false });

    const locator = { chapterIndex: 1, blockIndex: 0, offset: 150 };
    const resolved = resolveFineGraphLocatorToEventParams(bookId, locator, 1, gapManifest);
    expect(resolved).toMatchObject({ eventIdx: 1, eventId: 'a', resolved: true });
  });

  it('round-trips chapter-local offset through locator without paragraphStarts', () => {
    const approxChapter = {
      idx: 2,
      totalCodePoints: 5000,
      events: [{ idx: 1, eventNum: 1, eventId: 'only', startTxtOffset: 0, endTxtOffset: 5000 }],
    };
    const locals = [0, 1200, 4999];
    for (const local of locals) {
      const locator = locatorFromChapterLocalOffset(approxChapter, local);
      const resolved = resolveFineGraphLocatorToEventParams(
        bookId,
        locator,
        1,
        { chapters: [approxChapter] }
      );
      expect(resolved.eventIdx).toBe(1);
      const reRead = resolveFineGraphLocatorToEventParams(
        bookId,
        locatorFromChapterLocalOffset(approxChapter, local),
        1,
        { chapters: [approxChapter] }
      );
      expect(reRead.eventIdx).toBe(resolved.eventIdx);
    }
  });
});

const localStorageMock = (() => {
  let store = new Map();
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store = new Map();
    },
    get length() {
      return store.size;
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
  };
})();

vi.stubGlobal('localStorage', localStorageMock);
vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
});

const BOOK_ID = 42;
const BOOK_ID_STR = '42';
const sampleLocator = { chapterIndex: 1, blockIndex: 0, offset: 25 };

describe('progressCache', () => {
  beforeEach(() => {
    localStorage.clear();
    clearCache('progressCache');
    clearCache('manifestCache');
    setManifestData(BOOK_ID, sampleManifest, { persist: false });
    window.dispatchEvent.mockClear();
  });

  afterEach(() => {
    localStorage.clear();
    clearCache('progressCache');
    clearCache('manifestCache');
  });

  describe('ensureProgressRowLocator', () => {
    it('returns row unchanged when locator already exists', () => {
      const row = { bookId: BOOK_ID, startLocator: sampleLocator };
      expect(ensureProgressRowLocator(BOOK_ID_STR, row)).toBe(row);
    });

    it('hydrates locator from startTxtOffset via manifest', () => {
      const row = { bookId: BOOK_ID, startTxtOffset: 100 };
      const hydrated = ensureProgressRowLocator(BOOK_ID_STR, row);
      expect(hydrated.locator).toEqual({ chapterIndex: 2, blockIndex: 0, offset: 0 });
      expect(hydrated.startLocator).toEqual(hydrated.locator);
      expect(hydrated.endLocator).toEqual(hydrated.locator);
    });

    it('returns row unchanged when offset hydration fails', () => {
      const row = { bookId: 999, startTxtOffset: 50 };
      expect(ensureProgressRowLocator('999', row)).toBe(row);
    });
  });

  describe('setProgressToCache / getProgressFromCache', () => {
    it('round-trips locator-based progress', () => {
      setProgressToCache({
        bookId: BOOK_ID,
        startLocator: sampleLocator,
        eventNum: 3,
        eventName: 'Scene A',
        updatedAt: '2026-01-01T00:00:00Z',
      });

      const raw = getCacheItem('progressCache', BOOK_ID_STR);
      expect(raw?.readingProgressPercent).toBe(17);
      expect(raw?.chapterProgress).toBe(25);

      const cached = getProgressFromCache(BOOK_ID);
      expect(cached?.bookId).toBe(BOOK_ID);
      expect(cached?.startLocator).toEqual(sampleLocator);
      expect(cached?.readingProgressPercent).toBe(17);
      expect(cached?.chapterProgress).toBe(25);
      expect(cached?.eventNum).toBe(3);
      expect(cached?.eventName).toBe('Scene A');
      expect(cached?.anchor).toEqual({ startLocator: sampleLocator, endLocator: sampleLocator });
    });

    it('falls back to startTxtOffset when locator is unavailable', () => {
      setProgressToCache({
        bookId: 999,
        startTxtOffset: 120,
        endTxtOffset: 130,
        locatorVersion: 1,
      });

      const cached = getProgressFromCache(999);
      expect(cached?.startTxtOffset).toBe(120);
      expect(cached?.endTxtOffset).toBe(130);
      expect(cached?.locatorVersion).toBe(1);
      expect(cached?.readingProgressPercent).toBeUndefined();
    });

    it('dispatches cache updated event on set', () => {
      setProgressToCache({ bookId: BOOK_ID, startLocator: sampleLocator });

      expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
      const event = window.dispatchEvent.mock.calls[0][0];
      expect(event.type).toBe(PROGRESS_CACHE_UPDATED_EVENT);
      expect(event.detail).toEqual({ bookId: BOOK_ID_STR });
    });
  });

  describe('removeProgressFromCache', () => {
    it('removes cached progress and does not restore from legacy all aggregate', () => {
      setProgressToCache({ bookId: BOOK_ID, startLocator: sampleLocator });
      expect(getProgressFromCache(BOOK_ID)).not.toBeNull();

      removeProgressFromCache(BOOK_ID);
      expect(getProgressFromCache(BOOK_ID)).toBeNull();
    });
  });

  describe('legacy all aggregate migration', () => {
    it('migrates all key to per-book entries on module load', async () => {
      const legacyRow = {
        bookId: BOOK_ID,
        locator: sampleLocator,
        readingProgressPercent: 22,
        timestamp: Date.now(),
      };
      localStorage.setItem(
        'readwith_progress_cache',
        JSON.stringify({
          data: {
            all: {
              data: { [BOOK_ID_STR]: legacyRow },
              timestamp: Date.now(),
            },
          },
          timestamp: Date.now(),
        })
      );

      vi.resetModules();
      const { setManifestData: setManifest } = await import('./manifestCache.js');
      setManifest(BOOK_ID, sampleManifest, { persist: false });
      const { getProgressFromCache: getAfterMigration } = await import('./progressCache.js');

      const cached = getAfterMigration(BOOK_ID);
      expect(cached?.bookId).toBe(BOOK_ID);
      expect(cached?.startLocator).toEqual(sampleLocator);
      expect(cached?.readingProgressPercent).toBe(17);

      const stored = JSON.parse(localStorage.getItem('readwith_progress_cache'));
      expect(stored.data.all).toBeUndefined();
      expect(stored.data[BOOK_ID_STR]).toBeDefined();
    });
  });
});
