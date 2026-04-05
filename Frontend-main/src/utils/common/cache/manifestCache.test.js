import { describe, it, expect } from 'vitest';
import { getManifestCacheKey } from './manifestCache.js';

describe('manifestCache', () => {
  it('getManifestCacheKey', () => {
    expect(getManifestCacheKey(42)).toBe('manifest_cache_42');
    expect(getManifestCacheKey('7')).toBe('manifest_cache_7');
  });
});
