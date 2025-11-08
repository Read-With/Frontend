export const errorUtils = {
  logError: (context, error, additionalData = {}) => {
    console.error(`❌ ${context} 실패:`, error, additionalData);
  },
  
  logWarning: (context, message, additionalData = {}) => {
    console.warn(`⚠️ ${context}: ${message}`, additionalData);
  },
  
  logInfo: (context, message, additionalData = {}) => {
    void context;
    void message;
    void additionalData;
  },
  
  logSuccess: (context, message, additionalData = {}) => {
    void context;
    void message;
    void additionalData;
  },
  
  handleError: (context, error, fallbackValue = null, additionalData = {}) => {
    errorUtils.logError(context, error, additionalData);
    return fallbackValue;
  }
};