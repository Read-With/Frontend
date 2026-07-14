/** XhtmlViewer 설정 저장·로드·적용 */

import { storageUtils } from './cache/cacheManager';
import { errorUtils } from './errorUtils';

export const VIEWER_MODE_OPTIONS = [
  { showGraph: true, icon: 'view_sidebar', label: '단일 뷰어 & 그래프' },
  { showGraph: false, icon: 'article', label: '단일 뷰어' },
];

/** UI 미노출 필드 포함. XhtmlViewer 본문 기본값으로 사용·저장 */
export const defaultSettings = {
  fontSize: 100,
  lineHeight: 1.5,
  margin: 20,
  fontFamily: 'Noto Serif KR',
  showGraph: true,
};

export const SETTINGS_STORAGE_KEY = 'xhtml_viewer_settings';

const SETTINGS_KEYS = Object.keys(defaultSettings);

function toFiniteOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSettings(settings = {}) {
  const merged = { ...defaultSettings, ...settings };
  return {
    fontSize: toFiniteOr(merged.fontSize, defaultSettings.fontSize),
    lineHeight: toFiniteOr(merged.lineHeight, defaultSettings.lineHeight),
    margin: toFiniteOr(merged.margin, defaultSettings.margin),
    fontFamily:
      typeof merged.fontFamily === 'string' && merged.fontFamily.trim()
        ? merged.fontFamily
        : defaultSettings.fontFamily,
    showGraph: Boolean(merged.showGraph),
  };
}

function needsSettingsPersist(raw, normalized) {
  if (!raw || typeof raw !== 'object' || 'pageMode' in raw) return true;
  return SETTINGS_KEYS.some((key) => raw[key] !== normalized[key]);
}

export function findViewerModeOption(showGraph) {
  return (
    VIEWER_MODE_OPTIONS.find((opt) => opt.showGraph === Boolean(showGraph)) ??
    VIEWER_MODE_OPTIONS[1]
  );
}

export function loadSettings() {
  try {
    const raw = storageUtils.getJson(SETTINGS_STORAGE_KEY, defaultSettings);
    const loaded = normalizeSettings(raw);
    if (needsSettingsPersist(raw, loaded)) {
      storageUtils.setJson(SETTINGS_STORAGE_KEY, loaded);
    }
    return loaded;
  } catch (error) {
    return errorUtils.handleError('loadSettings', error, defaultSettings, {
      settings: storageUtils.get(SETTINGS_STORAGE_KEY),
    });
  }
}

export function saveSettings(settings) {
  try {
    storageUtils.setJson(SETTINGS_STORAGE_KEY, normalizeSettings(settings));
    return { success: true };
  } catch (error) {
    errorUtils.logError('saveSettings', error, { settings });
    return { success: false, message: '설정 저장 중 오류가 발생했습니다.' };
  }
}
