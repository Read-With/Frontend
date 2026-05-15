import { describe, expect, it } from 'vitest';
import { resolveViewerGraphTarget } from './graphTargetUtils';

describe('resolveViewerGraphTarget', () => {
  it('uses the visible event chapter and event for the graph target', () => {
    expect(resolveViewerGraphTarget({
      currentChapter: 2,
      currentEvent: { chapter: 1, eventNum: 12 },
      lastGood: { chapter: 2, eventNum: 1 },
    })).toEqual({ chapter: 1, eventIdx: 12 });
  });

  it('uses the next chapter first event once the visible event moves there', () => {
    expect(resolveViewerGraphTarget({
      currentChapter: 1,
      currentEvent: { chapter: 2, eventNum: 1 },
      lastGood: { chapter: 1, eventNum: 12 },
    })).toEqual({ chapter: 2, eventIdx: 1 });
  });

  it('falls back to the last good event only for the same current chapter', () => {
    expect(resolveViewerGraphTarget({
      currentChapter: 2,
      currentEvent: null,
      lastGood: { chapter: 2, eventNum: 3 },
    })).toEqual({ chapter: 2, eventIdx: 3 });

    expect(resolveViewerGraphTarget({
      currentChapter: 2,
      currentEvent: null,
      lastGood: { chapter: 1, eventNum: 12 },
    })).toEqual({ chapter: 2, eventIdx: 1 });
  });
});
