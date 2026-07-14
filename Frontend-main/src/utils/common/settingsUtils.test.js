import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  defaultSettings,
  normalizeSettings,
  SETTINGS_STORAGE_KEY,
  loadSettings,
  saveSettings,
} from './settingsUtils.js';

const getJson = vi.fn();
const setJson = vi.fn();

vi.mock('./cache/cacheManager', () => ({
  storageUtils: {
    getJson: (...args) => getJson(...args),
    setJson: (...args) => setJson(...args),
    get: vi.fn(),
  },
}));

vi.mock('./errorUtils', () => ({
  errorUtils: {
    handleError: (_name, _err, fallback) => fallback,
    logError: vi.fn(),
  },
}));

describe('settingsUtils', () => {
  beforeEach(() => {
    getJson.mockReset();
    setJson.mockReset();
  });

  it('normalizeSettings drops legacy pageMode', () => {
    const result = normalizeSettings({
      pageMode: 'double',
      showGraph: 1,
      fontSize: 110,
    });
    expect(result).toEqual({
      ...defaultSettings,
      showGraph: true,
      fontSize: 110,
    });
    expect(result).not.toHaveProperty('pageMode');
  });

  it('loadSettings writes only when legacy/dirty', () => {
    getJson.mockReturnValue({ ...defaultSettings, pageMode: 'double' });
    const loaded = loadSettings();
    expect(loaded).not.toHaveProperty('pageMode');
    expect(setJson).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, loaded);

    setJson.mockClear();
    getJson.mockReturnValue({ ...defaultSettings });
    loadSettings();
    expect(setJson).not.toHaveBeenCalled();
  });

  it('saveSettings normalizes before write', () => {
    const result = saveSettings({ fontSize: 120, pageMode: 'double', showGraph: true });
    expect(result.success).toBe(true);
    expect(setJson).toHaveBeenCalledWith(SETTINGS_STORAGE_KEY, {
      ...defaultSettings,
      fontSize: 120,
      showGraph: true,
    });
  });
});
