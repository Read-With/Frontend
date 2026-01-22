import { getApiBaseUrl } from './common/authUtils';

const REQUEST_TIMEOUT = 10000;

const createTimeoutController = (timeoutMs) => {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, timeoutId };
};

const healthCheckRequest = async (endpoint, timeoutMs = REQUEST_TIMEOUT) => {
  const { controller, timeoutId } = createTimeoutController(timeoutMs);
  const apiBaseUrl = getApiBaseUrl();
  
  try {
    const response = await fetch(`${apiBaseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    
    let responseData = null;
    try {
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        responseData = await response.json();
      }
    } catch {
    }
    
    return {
      response,
      data: responseData,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error.name === 'AbortError') {
      const timeoutError = new Error('요청 시간이 초과되었습니다.');
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    
    if (error.message?.includes('Failed to fetch') || error.message?.includes('NetworkError')) {
      const networkError = new Error('네트워크 연결에 실패했습니다.');
      networkError.isNetworkError = true;
      throw networkError;
    }
    
    throw error;
  }
};

export const checkBackendHealth = async () => {
  try {
    const { response, data } = await healthCheckRequest('/api/health');
    
    const isHealthy = response.ok && response.status === 200;
    
    return {
      isHealthy,
      status: response.status,
      message: isHealthy 
        ? '백엔드 서버가 정상 작동 중입니다.' 
        : `백엔드 서버에 문제가 있습니다. (상태 코드: ${response.status})`,
      data: data || null,
    };
  } catch (error) {
    if (error.isTimeout) {
      return {
        isHealthy: false,
        status: 0,
        message: '백엔드 서버 응답 시간이 초과되었습니다. 서버 상태를 확인해주세요.',
        error: 'TIMEOUT',
      };
    }
    
    if (error.isNetworkError) {
      return {
        isHealthy: false,
        status: 0,
        message: '백엔드 서버에 연결할 수 없습니다. 네트워크 연결과 서버 상태를 확인해주세요.',
        error: 'NETWORK_ERROR',
      };
    }
    
    return {
      isHealthy: false,
      status: 0,
      message: `백엔드 서버 확인 중 오류가 발생했습니다: ${error.message}`,
      error: 'UNKNOWN_ERROR',
    };
  }
};

export const checkOAuthEndpoint = async () => {
  try {
    const { response, data } = await healthCheckRequest('/api/auth/google/url');
    
    const isAvailable = response.ok && response.status === 200;
    
    return {
      isAvailable,
      status: response.status,
      message: isAvailable 
        ? 'OAuth 엔드포인트가 정상 작동합니다.' 
        : `OAuth 엔드포인트에 문제가 있습니다. (상태 코드: ${response.status})`,
      data: data || null,
    };
  } catch (error) {
    if (error.isTimeout) {
      return {
        isAvailable: false,
        status: 0,
        message: 'OAuth 엔드포인트 응답 시간이 초과되었습니다.',
        error: 'TIMEOUT',
      };
    }
    
    if (error.isNetworkError) {
      return {
        isAvailable: false,
        status: 0,
        message: 'OAuth 엔드포인트에 연결할 수 없습니다. 네트워크 연결을 확인해주세요.',
        error: 'NETWORK_ERROR',
      };
    }
    
    return {
      isAvailable: false,
      status: 0,
      message: `OAuth 엔드포인트 확인 중 오류가 발생했습니다: ${error.message}`,
      error: 'UNKNOWN_ERROR',
    };
  }
};
