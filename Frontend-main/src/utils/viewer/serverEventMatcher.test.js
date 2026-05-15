import { afterEach, describe, expect, it } from 'vitest';
import { resolveServerEventMatch, resolveViewerServerBookId } from './serverEventMatcher';
import { invalidateManifest, setManifestData } from '../common/cache/manifestCache';

const eventUtils = {
  extractRawEventIdx: (event) => Number(event?.eventNum ?? event?.eventIdx ?? 0),
};

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

describe('serverEventMatcher', () => {
  afterEach(() => {
    invalidateManifest(10);
  });

  it('prefers the forced matched server book id', () => {
    expect(resolveViewerServerBookId({ id: 7, _bookId: 42 }, 7)).toBe(42);
  });

  it('resolves the event from the server locator mapping', () => {
    const match = resolveServerEventMatch({
      book: { id: 10 },
      currentChapter: 1,
      event: {
        eventNum: 8,
        anchor: {
          startLocator: { chapterIndex: 1, blockIndex: 3, offset: 20 },
        },
      },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 3,
        resolved: true,
      }),
    });

    expect(match).toMatchObject({
      bookId: 10,
      chapterIdx: 1,
      eventIdx: 3,
      source: 'locator',
    });
  });

  it.each([
    [
      'locator maps to event 1',
      2,
      { chapter: 2, chapterIdx: 2, eventNum: 1 },
      true,
    ],
    [
      'locator mapping is unavailable',
      2,
      { chapter: 2, chapterIdx: 2, eventNum: 1 },
      false,
    ],
    [
      'current chapter is already the start chapter',
      1,
      {},
      true,
    ],
  ])('uses the previous chapter last event at a boundary when %s', (_label, currentChapter, eventBase, resolved) => {
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
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
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

  it('keeps manifest event id precedence when the locator is in the same chapter', () => {
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
        anchor: {
          startLocator: { chapterIndex: 2, blockIndex: 0, offset: 0 },
        },
      },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 99,
        resolved: true,
      }),
    });

    expect(match).toMatchObject({
      bookId: 10,
      chapterIdx: 2,
      eventIdx: 1,
      source: 'manifest-event-id',
    });
  });
});
