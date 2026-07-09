import { describe, it, expect } from 'vitest';
import {
  toNumberOrNull,
  toFiniteNumber,
  toPositiveInt,
  toPositiveNumberOrNull,
  toPositiveNumberFromId,
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

  it('toFiniteNumber', () => {
    expect(Number.isNaN(toFiniteNumber(undefined))).toBe(true);
    expect(toFiniteNumber(3)).toBe(3);
    expect(toFiniteNumber('4')).toBe(4);
  });

  it('toPositiveInt', () => {
    expect(toPositiveInt(0)).toBeNull();
    expect(toPositiveInt(2.9)).toBe(2);
    expect(toPositiveInt('bad', 1)).toBe(1);
  });

  it('toPositiveNumberFromId', () => {
    expect(toPositiveNumberFromId('e12')).toBe(12);
    expect(toPositiveNumberFromId('chapter-3-event-7')).toBe(7);
    expect(toPositiveNumberFromId('none')).toBeNull();
  });

  it('clampNumber', () => {
    expect(clampNumber(5, 0, 10)).toBe(5);
    expect(clampNumber(-1, 0, 10)).toBe(0);
    expect(clampNumber(99, 0, 10)).toBe(10);
  });
});
