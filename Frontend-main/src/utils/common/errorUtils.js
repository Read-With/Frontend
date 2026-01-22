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
    if (process.env.NODE_ENV === 'development') {
      console.info(`ℹ️ [${context}] 정보:`, {
        message,
        ...additionalData,
        timestamp: new Date().toISOString(),
      });
    }
  },
  
  logSuccess: (context, message, additionalData = {}) => {
    if (process.env.NODE_ENV === 'development') {
      console.log(`✅ [${context}] 성공:`, {
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

  isServerError: (error) => {
    const status = error?.status || error?.statusCode;
    return status && status >= 500 && status < 600;
  },

  isClientError: (error) => {
    const status = error?.status || error?.statusCode;
    return status && status >= 400 && status < 500;
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