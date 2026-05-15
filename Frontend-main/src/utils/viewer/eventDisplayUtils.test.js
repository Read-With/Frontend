import { describe, expect, it } from 'vitest';
import { resolveViewerDisplayEventNum } from './eventDisplayUtils';

describe('eventDisplayUtils', () => {
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
