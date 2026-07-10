import { describe, it, expect } from 'vitest';
import { eventUtils } from '../viewer/viewerCoreStateUtils.js';
import { toApiFolderKey } from './graphUtils.js';

describe('graphData', () => {
  it('toApiFolderKey', () => {
    expect(toApiFolderKey('12')).toBe('api:12');
    expect(toApiFolderKey('api:9')).toBe('api:9');
    expect(toApiFolderKey(5)).toBe('api:5');
    expect(toApiFolderKey('')).toBeNull();
    expect(toApiFolderKey('0')).toBeNull();
  });

  it('sorts chapter events by eventIdx ascending and keeps missing indexes last', () => {
    const sorted = eventUtils.sortEventsByIdx([
      { eventIdx: 3, id: 'third' },
      { id: 'missing' },
      { eventIdx: 1, id: 'first' },
      { eventIdx: 2, id: 'second' },
    ]);

    expect(sorted.map((event) => event.id)).toEqual(['first', 'second', 'third', 'missing']);
  });

  it('uses idx and eventNum as fallback order keys', () => {
    const sorted = eventUtils.sortEventsByIdx([
      { eventNum: 4, id: 'fourth' },
      { idx: 2, id: 'second' },
      { eventIdx: 1, id: 'first' },
      { id: 'missing' },
    ]);

    expect(sorted.map((event) => event.id)).toEqual(['first', 'second', 'fourth', 'missing']);
  });
});
