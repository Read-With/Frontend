// 백엔드 서버 상태 확인 유틸리티

// API 기본 URL 설정 (배포 서버 고정 사용)
const getApiBaseUrl = () => {
  // 로컬 개발 환경: 프록시 사용 (배포 서버로 전달)
  if (import.meta.env.DEV) {
    return ''; // 프록시를 통해 배포 서버로 요청
  }
  // 프로덕션 환경: 커스텀 도메인 사용
  return 'https://dev.readwith.store';
};

const BACKEND_BASE_URL = getApiBaseUrl();

export const checkBackendHealth = async () => {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/health`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    return {
      isHealthy: response.ok,
      status: response.status,
      message: response.ok ? '백엔드 서버가 정상 작동 중입니다.' : '백엔드 서버에 문제가 있습니다.'
    };
  } catch (error) {
    return {
      isHealthy: false,
      status: 0,
      message: '백엔드 서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인해주세요.'
    };
  }
};

export const checkOAuthEndpoint = async () => {
  try {
    const response = await fetch(`${BACKEND_BASE_URL}/api/auth/google/url`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    return {
      isAvailable: response.ok,
      status: response.status,
      message: response.ok ? 'OAuth 엔드포인트가 정상 작동합니다.' : 'OAuth 엔드포인트에 문제가 있습니다.'
    };
  } catch (error) {
    return {
      isAvailable: false,
      status: 0,
      message: 'OAuth 엔드포인트에 연결할 수 없습니다.'
    };
  }
};
