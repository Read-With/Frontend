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

  it('shows the previous chapter last event when moving back to a boundary viewport', () => {
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
      previousEvent: {
        chapter: 2,
        chapterIdx: 2,
        eventNum: 1,
      },
      book: { id: 10 },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 12,
        resolved: true,
      }),
    });

    expect(result.nextChapter).toBe(1);
    expect(result.nextEvent.chapter).toBe(1);
    expect(result.nextEvent.eventNum).toBe(12);
  });

  it('does not move to an earlier event inside the same chapter', () => {
    const receivedEvent = {
      chapter: 1,
      chapterIdx: 1,
      eventNum: 4,
      eventId: 'event-4',
      anchor: {
        startLocator: { chapterIndex: 1, blockIndex: 4, offset: 0 },
      },
    };

    const result = resolveViewerLineEvent({
      receivedEvent,
      previousEvent: {
        chapter: 1,
        chapterIdx: 1,
        eventNum: 5,
        eventId: 'event-5',
        name: 'Event 5',
      },
      book: { id: 10 },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 4,
        resolved: true,
      }),
    });

    expect(result.nextChapter).toBe(1);
    expect(result.nextEvent.eventNum).toBe(5);
    expect(result.nextEvent.eventIdx).toBe(5);
    expect(result.nextEvent.eventId).toBe('event-5');
    expect(result.nextEvent.name).toBe('Event 5');
    expect(result.nextEvent.anchor.startLocator.blockIndex).toBe(4);
  });

  it('keeps the previous event when the same chapter resolves to an earlier event', () => {
    const result = resolveViewerLineEvent({
      receivedEvent: {
        chapter: 1,
        chapterIdx: 1,
        eventNum: 4,
        anchor: {
          startLocator: { chapterIndex: 1, blockIndex: 4, offset: 0 },
        },
      },
      previousEvent: {
        chapter: 1,
        chapterIdx: 1,
        eventNum: 5,
      },
      book: { id: 10 },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 4,
        resolved: true,
      }),
    });

    expect(result.nextEvent.eventNum).toBe(5);
  });

  it('allows lower event numbers after the resolved chapter changes', () => {
    const result = resolveViewerLineEvent({
      receivedEvent: {
        chapter: 2,
        chapterIdx: 2,
        eventNum: 1,
        anchor: {
          startLocator: { chapterIndex: 2, blockIndex: 0, offset: 0 },
        },
      },
      previousEvent: {
        chapter: 1,
        chapterIdx: 1,
        eventNum: 5,
      },
      book: { id: 10 },
      eventUtils,
      resolveLocatorToEventParams: (_bookId, locator) => ({
        chapterIdx: locator.chapterIndex,
        eventIdx: 1,
        resolved: true,
      }),
    });

    expect(result.nextChapter).toBe(2);
    expect(result.nextEvent.eventNum).toBe(1);
  });
});
