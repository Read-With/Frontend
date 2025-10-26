/**
 * 통일된 에러 처리 유틸리티
 * viewerUtils.js에서 분리하여 공통 모듈로 사용
 */

export const errorUtils = {
  logError: (context, error, additionalData = {}) => {
    console.error(`❌ ${context} 실패:`, error, additionalData);
  },
  
  logWarning: (context, message, additionalData = {}) => {
    console.warn(`⚠️ ${context}: ${message}`, additionalData);
  },
  
  logInfo: (context, message, additionalData = {}) => {
    console.log(`ℹ️ ${context}: ${message}`, additionalData);
  },
  
  logSuccess: (context, message, additionalData = {}) => {
    console.log(`✅ ${context}: ${message}`, additionalData);
  },
  
  handleError: (context, error, fallbackValue = null, additionalData = {}) => {
    errorUtils.logError(context, error, additionalData);
    return fallbackValue;
  }
};

