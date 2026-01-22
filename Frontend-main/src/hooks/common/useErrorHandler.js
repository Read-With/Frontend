import { useState, useCallback, useRef } from 'react';
import { errorUtils } from '../../utils/common/errorUtils';

const ERROR_DISPLAY_DURATION = 5000;

export function useErrorHandler(context = '알 수 없는 컨텍스트') {
  const [error, setError] = useState(null);
  const [errorHistory, setErrorHistory] = useState([]);
  const timeoutRef = useRef(null);

  const handleError = useCallback((error, additionalContext = '', options = {}) => {
    const errorMessage = error?.message || error?.toString() || '알 수 없는 오류가 발생했습니다';
    const errorStatus = error?.status || error?.statusCode || null;
    const errorCode = error?.code || null;

    const errorInfo = {
      message: errorMessage,
      context: additionalContext || context,
      status: errorStatus,
      code: errorCode,
      timestamp: Date.now(),
      stack: error?.stack,
      originalError: error,
    };

    errorUtils.logError(context, error, {
      additionalContext,
      status: errorStatus,
      code: errorCode,
      ...options.metadata,
    });

    setError(errorInfo);
    setErrorHistory((prev) => [...prev.slice(-9), errorInfo]);

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    if (options.autoClear !== false) {
      timeoutRef.current = setTimeout(() => {
        setError(null);
      }, options.duration || ERROR_DISPLAY_DURATION);
    }

    return errorInfo;
  }, [context]);

  const clearError = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setError(null);
  }, []);

  const getErrorMessage = useCallback((userFriendly = true) => {
    if (!error) return null;

    if (userFriendly) {
      const statusMessages = {
        400: '잘못된 요청입니다',
        401: '인증이 필요합니다. 다시 로그인해주세요',
        403: '접근 권한이 없습니다',
        404: '요청한 데이터를 찾을 수 없습니다',
        500: '서버 오류가 발생했습니다',
        502: '서버 연결 오류가 발생했습니다',
        503: '서비스를 일시적으로 사용할 수 없습니다',
      };

      if (error.status && statusMessages[error.status]) {
        return statusMessages[error.status];
      }

      if (error.message && !error.message.includes('Error:')) {
        return error.message;
      }

      return '오류가 발생했습니다. 잠시 후 다시 시도해주세요';
    }

    return error.message;
  }, [error]);

  return {
    error,
    errorHistory,
    handleError,
    clearError,
    getErrorMessage,
    hasError: !!error,
  };
}
