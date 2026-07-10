import { describe, expect, it } from 'vitest';
import {
  buildNodeWeights,
  buildNodeWeightsFromEvents,
  mergeCharacterRecord,
  extractNodeWeightsFromElements,
  isNodeWeightEntryVisible,
} from './characterUtils';

describe('buildNodeWeights', () => {
  it('inherits weight and count from previousNodeWeights when current character omits them', () => {
    const previousNodeWeights = { '1': { weight: 5, count: 2 } };
    const nodeWeights = buildNodeWeights([{ id: 1, common_name: 'A' }], previousNodeWeights);

    expect(nodeWeights['1']).toEqual({ weight: 5, count: 2 });
  });

  it('uses current weight when present and keeps inherited count', () => {
    const previousNodeWeights = { '1': { weight: 5, count: 2 } };
    const nodeWeights = buildNodeWeights([{ id: 1, weight: 7 }], previousNodeWeights);

    expect(nodeWeights['1']).toEqual({ weight: 7, count: 2 });
  });

  it('hides node when only count exists and no previous weight', () => {
    const nodeWeights = buildNodeWeights([{ id: 2, count: 4 }]);

    expect(nodeWeights['2']).toBeUndefined();
  });

  it('hides node when count is missing even if weight exists', () => {
    const nodeWeights = buildNodeWeights([{ id: 3, weight: 6 }]);

    expect(nodeWeights['3']).toBeUndefined();
  });

  it('hides node when both weight and count are missing', () => {
    const nodeWeights = buildNodeWeights([{ id: 4, common_name: 'Ghost' }]);

    expect(nodeWeights['4']).toBeUndefined();
  });

  it('removes previously visible node when current event drops count', () => {
    const previousNodeWeights = { '1': { weight: 5, count: 2 } };
    const nodeWeights = buildNodeWeights([{ id: 1, weight: 5, count: 0 }], previousNodeWeights);

    expect(nodeWeights['1']).toBeUndefined();
  });
});

describe('buildNodeWeightsFromEvents', () => {
  it('carries weight and count forward across events', () => {
    const events = [
      { characters: [{ id: 1, weight: 6, count: 3 }] },
      { characters: [{ id: 1, common_name: 'Hero' }] },
      { characters: [{ id: 2, weight: 4, count: 1 }] },
    ];

    const nodeWeights = buildNodeWeightsFromEvents(events);

    expect(nodeWeights['1']).toEqual({ weight: 6, count: 3 });
    expect(nodeWeights['2']).toEqual({ weight: 4, count: 1 });
  });

  it('does not expose characters that never had count', () => {
    const events = [
      { characters: [{ id: 1, weight: 6 }] },
      { characters: [{ id: 2, weight: 4, count: 1 }] },
    ];

    const nodeWeights = buildNodeWeightsFromEvents(events);

    expect(nodeWeights['1']).toBeUndefined();
    expect(nodeWeights['2']).toEqual({ weight: 4, count: 1 });
  });
});

describe('mergeCharacterRecord', () => {
  it('keeps previous weight when update omits weight', () => {
    const merged = mergeCharacterRecord(
      { id: 1, weight: 8, common_name: 'Old' },
      { id: 1, common_name: 'New' }
    );

    expect(merged).toMatchObject({ weight: 8, common_name: 'New' });
  });
});

describe('extractNodeWeightsFromElements', () => {
  it('reads visible node weights from cytoscape elements', () => {
    const elements = [
      { data: { id: '3', label: 'C', weight: 9, count: 2 } },
      { data: { id: '4', label: 'D', weight: 9 } },
      { data: { id: '1->2', source: '1', target: '2' } },
    ];

    expect(extractNodeWeightsFromElements(elements)).toEqual({
      '3': { weight: 9, count: 2 },
    });
  });
});

describe('isNodeWeightEntryVisible', () => {
  it('requires both weight and count', () => {
    expect(isNodeWeightEntryVisible({ weight: 5, count: 1 })).toBe(true);
    expect(isNodeWeightEntryVisible({ weight: 5, count: 0 })).toBe(false);
    expect(isNodeWeightEntryVisible({ weight: 5 })).toBe(false);
    expect(isNodeWeightEntryVisible({ count: 2 })).toBe(false);
  });
});
