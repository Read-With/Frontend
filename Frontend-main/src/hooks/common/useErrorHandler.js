/** 훅 내부 API 에러 로깅·errorInfo 생성 */

import { useCallback } from 'react';
import { errorUtils } from '../../utils/common/errorUtils';

export function useErrorHandler(context = '알 수 없는 컨텍스트') {
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

    return errorInfo;
  }, [context]);

  return { handleError };
}
