import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { sanitizeXhtmlBodyHtml, sanitizeEpubStyleCss } from './sanitizeXhtml.js';
import {
  buildProgressPayload,
  resolveReadingLocators,
  resolveServerEventMatch,
  resolveViewerLineEvent,
  shouldApplyCacheSnapshot,
  toReadingLocatorKey,
} from './viewerEventProgressUtils.js';
import { invalidateManifest, setManifestData } from '../common/cache/manifestCache.js';

vi.mock('../common/cache/manifestCache.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveProgressMetricsFromLocator: vi.fn(),
    readingProgressPercentFromLocator: vi.fn(),
  };
});

import { resolveProgressMetricsFromLocator } from '../common/cache/manifestCache.js';

const eventUtils = {
  resolveEventNum: (event) => Number(event?.eventNum ?? event?.eventIdx ?? 0),
};

const locator = { chapterIndex: 1, blockIndex: 0, offset: 10 };

function setBoundaryManifest() {
  setManifestData(
    10,
    {
      chapters: [
        {
          idx: 1,
          events: [
            { idx: 1, eventNum: 1, eventId: 'c1-first', startTxtOffset: 0, endTxtOffset: 100 },
            { idx: 12, eventNum: 12, eventId: 'c1-last', startTxtOffset: 900, endTxtOffset: 1000 },
          ],
        },
        {
          idx: 2,
          events: [{ idx: 1, eventNum: 1, eventId: 'c2-first', startTxtOffset: 0, endTxtOffset: 100 }],
        },
      ],
    },
    { persist: false }
  );
}

describe('viewer utils', () => {
  beforeEach(() => {
    vi.mocked(resolveProgressMetricsFromLocator).mockReset();
  });

  describe('sanitizeXhtml', () => {
    it('removes scripts and keeps locator data attributes', () => {
      const out = sanitizeXhtmlBodyHtml(
        '<p>a</p><script>alert(1)</script><div data-chapter-index="3" data-block-index="7">x</div>'
      );
      expect(out.toLowerCase()).not.toContain('<script');
      expect(out).toContain('data-chapter-index="3"');
      expect(out).toContain('data-block-index="7"');
    });

    it('strips dangerous css imports', () => {
      const out = sanitizeEpubStyleCss('p{color:red} @import url("https://x.com/a.css");');
      expect(out.toLowerCase()).not.toContain('@import');
      expect(out).toContain('color:red');
    });
  });

  describe('viewerProgressUtils', () => {
    it('shouldApplyCacheSnapshot skips stale cache while reading ahead', () => {
      const cacheLoc = { chapterIndex: 1, blockIndex: 0, offset: 10 };
      const liveLoc = { chapterIndex: 1, blockIndex: 0, offset: 50 };
      const snapshot = { readingLocatorKey: toReadingLocatorKey(cacheLoc, cacheLoc) };
      const liveKey = toReadingLocatorKey(liveLoc, liveLoc);
      expect(shouldApplyCacheSnapshot(snapshot, liveKey, true)).toBe(false);
      expect(shouldApplyCacheSnapshot(snapshot, liveKey, false)).toBe(true);
    });

    it('buildProgressPayload includes resolved metrics', () => {
      vi.mocked(resolveProgressMetricsFromLocator).mockReturnValue({
        readingProgressPercent: 42,
        chapterProgress: 17,
      });
      const payload = buildProgressPayload('7', locator, locator, { eventNum: 3 }, null);
      expect(payload.readingProgressPercent).toBe(42);
      expect(payload.chapterProgress).toBe(17);
    });

    it('resolveReadingLocators prefers live viewer locator', () => {
      const fromViewer = {
        startLocator: { chapterIndex: 2, blockIndex: 1, offset: 0 },
        endLocator: { chapterIndex: 2, blockIndex: 1, offset: 5 },
      };
      const result = resolveReadingLocators(() => fromViewer, {
        anchor: { startLocator: { chapterIndex: 1, blockIndex: 0, offset: 0 } },
      });
      expect(result.startLocator.chapterIndex).toBe(2);
    });
  });

  describe('viewerEventResolveUtils', () => {
    afterEach(() => {
      invalidateManifest(10);
    });

    it.each([
      ['locator maps to event 1', 2, { chapter: 2, chapterIdx: 2, eventNum: 1 }, true],
      ['locator mapping is unavailable', 2, { chapter: 2, chapterIdx: 2, eventNum: 1 }, false],
      ['current chapter is already the start chapter', 1, {}, true],
    ])('uses previous chapter last event at boundary when %s', (_label, currentChapter, eventBase, resolved) => {
      setBoundaryManifest();
      const match = resolveServerEventMatch({
        book: { id: 10 },
        currentChapter,
        event: {
          ...eventBase,
          anchor: {
            startLocator: { chapterIndex: 1, blockIndex: 0, offset: 0 },
            endLocator: { chapterIndex: 2, blockIndex: 0, offset: 5 },
          },
        },
        eventUtils,
        resolveLocatorToEventParams: (_bookId, loc) => ({
          chapterIdx: loc.chapterIndex,
          eventIdx: 1,
          resolved,
        }),
      });
      expect(match).toMatchObject({
        bookId: 10,
        chapterIdx: 1,
        eventIdx: 12,
        source: 'locator-boundary-last-event',
      });
    });

    it('falls back to manifest event id when locator mapping fails', () => {
      setManifestData(
        10,
        {
          chapters: [
            {
              idx: 2,
              events: [{ idx: 1, eventNum: 1, eventId: 'c2-first', startTxtOffset: 0, endTxtOffset: 100 }],
            },
          ],
        },
        { persist: false }
      );
      const match = resolveServerEventMatch({
        book: { id: 10 },
        currentChapter: 2,
        event: {
          chapter: 2,
          chapterIdx: 2,
          eventNum: 1,
          eventId: 'c2-first',
          anchor: { startLocator: { chapterIndex: 2, blockIndex: 0, offset: 0 } },
        },
        eventUtils,
        resolveLocatorToEventParams: () => ({ chapterIdx: 2, eventIdx: 1, resolved: false }),
      });
      expect(match).toMatchObject({
        bookId: 10,
        chapterIdx: 2,
        eventIdx: 1,
        source: 'manifest-event-id',
      });
    });

    it('resolveViewerLineEvent uses start locator when viewport spans chapters', () => {
      const result = resolveViewerLineEvent({
        receivedEvent: {
          chapter: 2,
          chapterIdx: 2,
          eventNum: 1,
          anchor: {
            startLocator: { chapterIndex: 1, blockIndex: 9, offset: 100 },
            endLocator: { chapterIndex: 2, blockIndex: 0, offset: 5 },
          },
        },
        book: { id: 10 },
        eventUtils,
        resolveLocatorToEventParams: (_bookId, loc) => ({
          chapterIdx: loc.chapterIndex,
          eventIdx: 12,
          resolved: true,
        }),
      });
      expect(result.atLocator.chapterIndex).toBe(1);
      expect(result.nextChapter).toBe(1);
      expect(result.nextEvent.eventNum).toBe(12);
    });

    it('resolveViewerLineEvent clears stale metadata when locator maps to different event', () => {
      setManifestData(
        10,
        {
          chapters: [
            {
              idx: 1,
              events: [{ idx: 4, eventNum: 4, eventId: 'event-4', eventName: 'Event 4' }],
            },
          ],
        },
        { persist: false }
      );
      const result = resolveViewerLineEvent({
        receivedEvent: {
          chapter: 1,
          chapterIdx: 1,
          eventNum: 5,
          eventId: 'event-5',
          name: 'Event 5',
          anchor: { startLocator: { chapterIndex: 1, blockIndex: 4, offset: 0 } },
        },
        book: { id: 10 },
        eventUtils,
        resolveLocatorToEventParams: (_bookId, loc) => ({
          chapterIdx: loc.chapterIndex,
          eventIdx: 4,
          resolved: true,
        }),
      });
      expect(result.nextEvent.eventNum).toBe(4);
      expect(result.nextEvent.name).not.toBe('Event 5');
    });
  });
});
