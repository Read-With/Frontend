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