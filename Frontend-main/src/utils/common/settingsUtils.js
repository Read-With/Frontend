/** XhtmlViewer 설정 저장·로드·적용 */

import { storageUtils } from './cache/cacheManager';
import { errorUtils } from './errorUtils';

export const defaultSettings = {
  fontSize: 100,
  pageMode: "double",
  lineHeight: 1.5,
  margin: 20,
  fontFamily: "Noto Serif KR",
  showGraph: true,
};

const SETTINGS_STORAGE_KEY = "xhtml_viewer_settings";

const normalizeSettings = (settings = {}) => {
  const normalized = { ...defaultSettings, ...settings };
  if (normalized.pageMode === "leftOnly") {
    normalized.pageMode = "double";
  }
  return normalized;
};

export function loadSettings() {
  try {
    const loadedSettings = normalizeSettings(storageUtils.getJson(SETTINGS_STORAGE_KEY, defaultSettings));
    storageUtils.setJson(SETTINGS_STORAGE_KEY, loadedSettings);

    return loadedSettings;
  } catch (error) {
    return errorUtils.handleError('loadSettings', error, defaultSettings, { 
      settings: storageUtils.get("xhtml_viewer_settings") 
    });
  }
}

export function saveSettings(settings) {
  try {
    storageUtils.setJson(SETTINGS_STORAGE_KEY, normalizeSettings(settings));
    return { success: true };
  } catch (error) {
    errorUtils.logError('saveSettings', error, { settings });
    return { success: false, message: "설정 저장 중 오류가 발생했습니다." };
  }
}

export const settingsUtils = {
  defaultSettings,
  loadSettings,
  saveSettings,
  
  applySettings(newSettings, prevSettings, setSettings, setShowGraph, setReloadKey, viewerRef, _cleanFilename) {
    const currentSettings = { ...prevSettings };
    setSettings(newSettings);
    setShowGraph(newSettings.showGraph);

    const needsReload = 
      newSettings.pageMode !== currentSettings.pageMode ||
      newSettings.showGraph !== currentSettings.showGraph ||
      newSettings.fontSize !== currentSettings.fontSize ||
      newSettings.lineHeight !== currentSettings.lineHeight;

    if (needsReload) {
      setReloadKey((prev) => prev + 1);
    } else {
      if (viewerRef?.current?.applySettings) {
        viewerRef.current.applySettings();
      }
    }

    const result = saveSettings(newSettings);
    if (!result.success) {
      return result;
    }

    return { success: true, message: "✅ 설정이 적용되었습니다" };
  },
};

