import { describe, it, expect } from 'vitest';
import {
  safeNum,
  normalizeRelation,
  isValidRelation,
  isSamePair,
  processRelations,
  createRelationKey,
  getRelationKeyFromRelation,
  relationEventMetaPassthrough,
} from './relationUtils.js';

describe('relationUtils', () => {
  it('safeNum', () => {
    expect(Number.isNaN(safeNum(undefined))).toBe(true);
    expect(safeNum(3)).toBe(3);
    expect(safeNum('4')).toBe(4);
  });

  it('normalizeRelation', () => {
    expect(normalizeRelation(null)).toBeNull();
    const r = normalizeRelation({ id1: 1, id2: 2, relation: ['a'], weight: 2 });
    expect(r).toMatchObject({ id1: 1, id2: 2, weight: 2, label: 'a' });
  });

  it('isValidRelation', () => {
    expect(isValidRelation(normalizeRelation({ id1: 1, id2: 2 }))).toBe(true);
    expect(isValidRelation(normalizeRelation({ id1: 1, id2: 1 }))).toBe(false);
    expect(isValidRelation(normalizeRelation({ id1: 0, id2: 1 }))).toBe(false);
  });

  it('isSamePair', () => {
    expect(isSamePair({ id1: 1, id2: 2 }, 2, 1)).toBe(true);
    expect(isSamePair({ id1: 1, id2: 2 }, 1, 3)).toBe(false);
    expect(isSamePair({ source: '5', target: 6 }, 6, 5)).toBe(true);
  });

  it('processRelations', () => {
    const out = processRelations([
      { id1: 1, id2: 2 },
      { id1: 1, id2: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id1: 1, id2: 2 });
  });

  it('createRelationKey / getRelationKeyFromRelation', () => {
    expect(createRelationKey(2, 1)).toBe('1-2');
    expect(getRelationKeyFromRelation({ source: '3', target: 4 })).toBe('3-4');
  });

  it('relationEventMetaPassthrough / processRelations keeps event ids', () => {
    expect(relationEventMetaPassthrough({ id1: 1, id2: 2 })).toEqual({});
    expect(
      relationEventMetaPassthrough({ eventNum: 5, event: { eventIdx: 9 } })
    ).toMatchObject({ eventNum: 5, eventIdx: 9 });
    const out = processRelations([
      { id1: 1, id2: 2, relation: ['x'], positivity: 0.2, eventNum: 3 },
    ]);
    expect(out[0]).toMatchObject({ id1: 1, id2: 2, eventNum: 3 });
  });
});
