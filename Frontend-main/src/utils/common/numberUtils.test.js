import { describe, it, expect } from 'vitest';
import {
  toNumberOrNull,
  toPositiveNumberOrNull,
  safeParseInt,
  clampNumber,
} from './numberUtils.js';

describe('numberUtils', () => {
  it('toNumberOrNull', () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull('12')).toBe(12);
    expect(toNumberOrNull('x')).toBeNull();
  });

  it('toPositiveNumberOrNull', () => {
    expect(toPositiveNumberOrNull(0)).toBeNull();
    expect(toPositiveNumberOrNull(3)).toBe(3);
  });

  it('safeParseInt', () => {
    expect(safeParseInt('7')).toBe(7);
    expect(safeParseInt('bad', 2)).toBe(2);
  });

  it('clampNumber', () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(99, 0, 10)).toBe(10);
  });
});
