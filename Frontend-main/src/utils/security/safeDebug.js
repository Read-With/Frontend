/**
 * 안전한 디버깅 유틸리티
 * Self-XSS 공격을 방지하기 위한 안전한 로깅 시스템
 */

// 개발 환경에서만 디버깅 활성화
if (import.meta.env.DEV) {
  // 안전한 디버깅 함수
  window.DEBUG_OAUTH = (message, data = null) => {
    try {
      // 민감한 정보 마스킹
      const safeData = data ? maskSensitiveData(data) : null;
      
      // 안전한 로깅 (스택 트레이스 없이)
      const logEntry = {
        message,
        data: safeData,
        timestamp: new Date().toISOString(),
        source: 'OAuth'
      };
      
      // localStorage에 안전하게 저장 (선택사항)
      const existingLogs = JSON.parse(localStorage.getItem('oauth_debug_logs') || '[]');
      existingLogs.push(logEntry);
      
      // 최대 50개 로그만 유지
      if (existingLogs.length > 50) {
        existingLogs.splice(0, existingLogs.length - 50);
      }
      
      localStorage.setItem('oauth_debug_logs', JSON.stringify(existingLogs));
      
      // 콘솔에 안전하게 출력
      console.group(`🔒 ${message}`);
      if (safeData) {
        console.table(safeData);
      }
      console.groupEnd();
      
    } catch (error) {
      // 디버깅 실패 시 조용히 무시
    }
  };
  
  // 디버깅 로그 조회 함수
  window.GET_OAUTH_LOGS = () => {
    try {
      return JSON.parse(localStorage.getItem('oauth_debug_logs') || '[]');
    } catch (error) {
      console.error('로그 조회 실패:', error);
      return [];
    }
  };
  
  // 디버깅 로그 초기화 함수
  window.CLEAR_OAUTH_LOGS = () => {
    try {
      localStorage.removeItem('oauth_debug_logs');
    } catch (error) {
      console.error('로그 초기화 실패:', error);
    }
  };
}

// 민감한 데이터 마스킹 함수
function maskSensitiveData(data) {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  const masked = { ...data };
  
  // 민감한 필드들 마스킹
  const sensitiveFields = ['code', 'token', 'password', 'secret', 'key', 'id'];
  
  for (const [key, value] of Object.entries(masked)) {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      if (typeof value === 'string' && value.length > 10) {
        masked[key] = value.substring(0, 6) + '...' + value.substring(value.length - 4);
      } else if (typeof value === 'string') {
        masked[key] = '*'.repeat(value.length);
      }
    }
  }
  
  return masked;
}

// 프로덕션 환경에서는 디버깅 함수 비활성화
if (import.meta.env.PROD) {
  window.DEBUG_OAUTH = () => {};
  window.GET_OAUTH_LOGS = () => [];
  window.CLEAR_OAUTH_LOGS = () => {};
}
