import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { clearCache, getCacheItem } from './cacheManager.js';
import { setManifestData } from './manifestCache.js';
import {
  ensureProgressRowLocator,
  setProgressToCache,
  getProgressFromCache,
  removeProgressFromCache,
  PROGRESS_CACHE_UPDATED_EVENT,
} from './progressCache.js';

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

const sampleLocator = { chapterIndex: 1, blockIndex: 0, offset: 25 };

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
