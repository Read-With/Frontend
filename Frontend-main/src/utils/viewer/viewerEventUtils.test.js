import { afterEach, describe, expect, it } from 'vitest';
import {
  resolveServerEventMatch,
  resolveViewerDisplayEventNum,
  resolveViewerLineEvent,
  resolveViewerServerBookId,
} from './viewerEventUtils';
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

describe('resolveViewerDisplayEventNum', () => {
  it('displays only the current event number', () => {
    const eventNum = resolveViewerDisplayEventNum({
      currentEvent: { chapter: 2, eventNum: 2 },
      prevValidEvent: null,
      progressTopBar: { eventNum: 2 },
    });

    expect(String(eventNum)).toBe('2');
  });

  it('uses same-chapter progress after stale events from another chapter', () => {
    const eventNum = resolveViewerDisplayEventNum({
      currentEvent: { chapter: 1, eventNum: 5 },
      prevValidEvent: { chapter: 1, eventNum: 4 },
      currentChapter: 2,
      progressTopBar: { chapter: 2, eventNum: 1 },
    });

    expect(eventNum).toBe(1);
  });

  it('does not use stale progress from another chapter', () => {
    const eventNum = resolveViewerDisplayEventNum({
      currentEvent: { chapter: 1, eventNum: 5 },
      prevValidEvent: { chapter: 1, eventNum: 4 },
      currentChapter: 2,
      progressTopBar: { chapter: 1, eventNum: 5 },
      fallback: 0,
    });

    expect(eventNum).toBe(0);
  });
});

describe('resolveServerEventMatch', () => {
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
