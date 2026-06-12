import { describe, it, expect } from 'vitest';
import {
  filterEventsBefore,
  filterEventsUpTo,
  getFolderKeyFromFilename,
  getMaxEventIdx,
  sortEventsByIdx,
} from './graphData.js';

describe('graphData', () => {
  it('getFolderKeyFromFilename', () => {
    expect(getFolderKeyFromFilename('12')).toBe('api:12');
    expect(getFolderKeyFromFilename('api:9')).toBe('api:9');
    expect(getFolderKeyFromFilename(5)).toBe('api:5');
    expect(getFolderKeyFromFilename('')).toBeNull();
    expect(getFolderKeyFromFilename('0')).toBeNull();
  });

  it('sorts chapter events by eventIdx ascending and keeps missing indexes last', () => {
    const sorted = sortEventsByIdx([
      { eventIdx: 3, id: 'third' },
      { id: 'missing' },
      { eventIdx: 1, id: 'first' },
      { eventIdx: 2, id: 'second' },
    ]);

    expect(sorted.map((event) => event.id)).toEqual(['first', 'second', 'third', 'missing']);
  });

  it('uses idx and eventNum as fallback order keys', () => {
    const sorted = sortEventsByIdx([
      { eventNum: 4, id: 'fourth' },
      { idx: 2, id: 'second' },
      { eventIdx: 1, id: 'first' },
      { id: 'missing' },
    ]);

    expect(sorted.map((event) => event.id)).toEqual(['first', 'second', 'fourth', 'missing']);
  });

  it('filters chapter events by eventIdx without reordering the sorted input', () => {
    const events = sortEventsByIdx([
      { eventIdx: 3, id: 'third' },
      { eventIdx: 1, id: 'first' },
      { eventIdx: 2, id: 'second' },
    ]);

    expect(filterEventsUpTo(events, 2).map((event) => event.id)).toEqual(['first', 'second']);
    expect(filterEventsBefore(events, 3).map((event) => event.id)).toEqual(['first', 'second']);
  });

  it('resolves the max eventIdx in a chapter', () => {
    expect(getMaxEventIdx([{ eventIdx: 1 }, { eventNum: 8 }, { id: 'missing' }])).toBe(8);
  });
});
