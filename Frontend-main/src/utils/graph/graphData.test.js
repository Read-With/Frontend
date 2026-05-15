import { describe, it, expect } from 'vitest';
import { getFolderKeyFromFilename } from './graphData.js';

describe('graphData', () => {
  it('getFolderKeyFromFilename', () => {
    expect(getFolderKeyFromFilename('12')).toBe('api:12');
    expect(getFolderKeyFromFilename('api:9')).toBe('api:9');
    expect(getFolderKeyFromFilename(5)).toBe('api:5');
    expect(getFolderKeyFromFilename('')).toBeNull();
    expect(getFolderKeyFromFilename('0')).toBeNull();
  });
});
