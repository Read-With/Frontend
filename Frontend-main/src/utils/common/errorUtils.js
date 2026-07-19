/** 공통 에러 로깅·handleError 래퍼 + 뷰어 설정 */

import { storageUtils } from './cache/cacheManager';

const getErrorDetails = (error) => {
  return {
    message: error?.message || error?.toString() || '알 수 없는 오류',
    status: error?.status || error?.statusCode || null,
    code: error?.code || null,
    stack: error?.stack || null,
    name: error?.name || 'Error',
  };
};

export const errorUtils = {
  logError: (context, error, additionalData = {}) => {
    const errorDetails = getErrorDetails(error);
    console.error(`❌ [${context}] 에러 발생:`, {
      ...errorDetails,
      ...additionalData,
      timestamp: new Date().toISOString(),
    });
  },
  
  logWarning: (context, message, additionalData = {}) => {
    console.warn(`⚠️ [${context}] 경고:`, {
      message,
      ...additionalData,
      timestamp: new Date().toISOString(),
    });
  },
  
  logInfo: (context, message, additionalData = {}) => {
    if (import.meta.env.DEV) {
      console.info(`ℹ️ [${context}] 정보:`, {
        message,
        ...additionalData,
        timestamp: new Date().toISOString(),
      });
    }
  },
  
  handleError: (context, error, fallbackValue = null, additionalData = {}) => {
    errorUtils.logError(context, error, additionalData);
    return fallbackValue;
  },

  isNetworkError: (error) => {
    return (
      error?.message?.includes('Failed to fetch') ||
      error?.message?.includes('NetworkError') ||
      error?.name === 'TypeError' ||
      error?.code === 'NETWORK_ERROR'
    );
  },

  getUserFriendlyMessage: (error) => {
    const status = error?.status || error?.statusCode;
    const statusMessages = {
      400: '잘못된 요청입니다',
      401: '인증이 필요합니다. 다시 로그인해주세요',
      403: '접근 권한이 없습니다',
      404: '요청한 데이터를 찾을 수 없습니다',
      500: '서버 오류가 발생했습니다',
      502: '서버 연결 오류가 발생했습니다',
      503: '서비스를 일시적으로 사용할 수 없습니다',
    };

    if (status && statusMessages[status]) {
      return statusMessages[status];
    }

    if (errorUtils.isNetworkError(error)) {
      return '네트워크 연결을 확인해주세요';
    }

    if (error?.message && !error.message.includes('Error:')) {
      return error.message;
    }

    return '오류가 발생했습니다. 잠시 후 다시 시도해주세요';
  },
};

// --- settings (merged from settingsUtils) ---

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
