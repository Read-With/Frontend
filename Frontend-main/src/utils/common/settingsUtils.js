/**
 * 설정 관리 유틸리티
 * viewerUtils.js와 ViewerSettings.jsx의 설정 로직을 통합
 */

import { storageUtils } from './cache/storageUtils';
import { errorUtils } from './errorUtils';

export const defaultSettings = {
  fontSize: 100,
  pageMode: "double",
  lineHeight: 1.5,
  margin: 20,
  fontFamily: "Noto Serif KR",
  showGraph: true,
};

export function loadSettings() {
  try {
    let settings = storageUtils.get("xhtml_viewer_settings");
    const loadedSettings = settings ? JSON.parse(settings) : defaultSettings;

    if (loadedSettings.pageMode === "leftOnly") {
      loadedSettings.pageMode = "double";
    }

    if (loadedSettings.showGraph === undefined) {
      loadedSettings.showGraph = defaultSettings.showGraph;
    }
    storageUtils.set("xhtml_viewer_settings", JSON.stringify(loadedSettings));

    return loadedSettings;
  } catch (error) {
    return errorUtils.handleError('loadSettings', error, defaultSettings, { 
      settings: storageUtils.get("xhtml_viewer_settings") 
    });
  }
}

export function saveSettings(settings) {
  try {
    storageUtils.set("xhtml_viewer_settings", JSON.stringify(settings));
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
  
  applySettings(newSettings, prevSettings, setSettings, setShowGraph, setReloadKey, viewerRef, cleanFilename) {
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

