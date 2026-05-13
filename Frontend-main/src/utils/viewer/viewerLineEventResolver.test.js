import { describe, expect, it } from 'vitest';
import { resolveViewerLineEvent } from './viewerLineEventResolver';

const eventUtils = {
  extractRawEventIdx: (event) => Number(event?.eventNum ?? event?.eventIdx ?? 0),
};

describe('resolveViewerLineEvent', () => {
  it('uses the current locator manifest event for the visible line', () => {
    const receivedEvent = {
      chapter: 1,
      chapterIdx: 1,
      eventNum: 8,
      anchor: {
        startLocator: { chapterIndex: 1, blockIndex: 3, offset: 20 },
      },
    };

    const result = resolveViewerLineEvent({
      receivedEvent,
      book: { id: 10 },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 3,
        resolved: true,
      }),
    });

    expect(result.nextChapter).toBe(1);
    expect(result.nextEvent.eventNum).toBe(3);
    expect(result.nextEvent.eventIdx).toBe(3);
    expect(result.nextEvent.resolvedEventIdx).toBe(3);
  });

  it('uses the visible start locator when the viewport spans into the next chapter', () => {
    const receivedEvent = {
      chapter: 2,
      chapterIdx: 2,
      eventNum: 1,
      anchor: {
        startLocator: { chapterIndex: 1, blockIndex: 9, offset: 100 },
        endLocator: { chapterIndex: 2, blockIndex: 0, offset: 5 },
      },
    };

    const result = resolveViewerLineEvent({
      receivedEvent,
      book: { id: 10 },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 12,
        resolved: true,
      }),
    });

    expect(result.atLocator.chapterIndex).toBe(1);
    expect(result.nextChapter).toBe(1);
    expect(result.nextEvent.chapter).toBe(1);
    expect(result.nextEvent.eventNum).toBe(12);
  });
});
