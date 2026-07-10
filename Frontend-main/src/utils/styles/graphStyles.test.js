import { describe, expect, it } from 'vitest';
import {
  NODE_SIZE_MAX,
  NODE_SIZE_MIN,
  calculateNodeSizeFromNormalized,
  calculateNodeSizeFromWeight,
  clampPositivity,
  computeWeightRange,
  normalizeWeightToUnit,
} from './graphStyles';

describe('graphStyles node size normalization', () => {
  it('maps weights to 0-1 using graph min/max', () => {
    expect(normalizeWeightToUnit(2, 2, 10)).toBe(0);
    expect(normalizeWeightToUnit(6, 2, 10)).toBe(0.5);
    expect(normalizeWeightToUnit(10, 2, 10)).toBe(1);
  });

  it('returns 1 when all weights are equal', () => {
    expect(normalizeWeightToUnit(5, 5, 5)).toBe(1);
  });

  it('computes weight range from positive values only', () => {
    expect(computeWeightRange([3, 0, 8, -1, 5])).toEqual({ min: 3, max: 8 });
  });

  it('maps normalized ratio to pixel size range', () => {
    expect(calculateNodeSizeFromNormalized(0)).toBe(NODE_SIZE_MIN);
    expect(calculateNodeSizeFromNormalized(1)).toBe(NODE_SIZE_MAX);
    expect(calculateNodeSizeFromNormalized(0.5)).toBe(
      Math.round(NODE_SIZE_MIN + 0.5 * (NODE_SIZE_MAX - NODE_SIZE_MIN))
    );
  });

  it('derives pixel size from raw weight and graph range', () => {
    const size = calculateNodeSizeFromWeight(10, 2, 10);
    expect(size).toBe(NODE_SIZE_MAX);
  });

  it('clamps positivity to [-1, 1]', () => {
    expect(clampPositivity(2)).toBe(1);
    expect(clampPositivity(-3)).toBe(-1);
    expect(clampPositivity('bad')).toBe(0);
  });
});
