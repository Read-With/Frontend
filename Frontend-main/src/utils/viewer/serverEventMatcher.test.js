import { describe, expect, it } from 'vitest';
import { resolveServerEventMatch, resolveViewerServerBookId } from './serverEventMatcher';

const eventUtils = {
  extractRawEventIdx: (event) => Number(event?.eventNum ?? event?.eventIdx ?? 0),
};

describe('serverEventMatcher', () => {
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
});
