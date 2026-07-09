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

  it('getManifestCacheKey', async () => {
    const { getManifestCacheKey } = await import('./manifestCache.js');
    expect(getManifestCacheKey(42)).toBe('manifest_cache_v2_42');
  });

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
