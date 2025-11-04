/**
 * 인물 관계 그래프 관련 API 호출 유틸리티
 */

import { refreshToken } from './authApi';

// API 기본 URL 설정 (배포 서버 고정 사용)
const getApiBaseUrl = () => {
  // 로컬 개발 환경: 프록시 사용 (배포 서버로 전달)
  if (import.meta.env.DEV) {
    return ''; // 프록시를 통해 배포 서버로 요청
  }
  // 프로덕션 환경: 커스텀 도메인 사용
  return 'https://dev.readwith.store';
};

const API_BASE_URL = getApiBaseUrl();

// 전역 요청 캐시: 진행 중인 요청과 완료된 요청을 추적
const requestCache = new Map();
const CACHE_DURATION = 5 * 60 * 1000; // 5분

// 캐시 키 생성
function getCacheKey(endpoint) {
  return endpoint;
}

// 캐시에서 데이터 가져오기
function getCachedRequest(cacheKey) {
  const cached = requestCache.get(cacheKey);
  if (!cached) return null;
  
  const now = Date.now();
  if (now - cached.timestamp > CACHE_DURATION) {
    requestCache.delete(cacheKey);
    return null;
  }
  
  return cached;
}

// 캐시에 데이터 저장
function setCachedRequest(cacheKey, data) {
  requestCache.set(cacheKey, {
    data,
    timestamp: Date.now()
  });
  
  // 캐시 크기 관리 (최대 100개)
  if (requestCache.size > 100) {
    const oldestKey = Array.from(requestCache.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp)[0][0];
    requestCache.delete(oldestKey);
  }
}

// 진행 중인 요청 추적
const pendingRequests = new Map();

// 인증된 API 요청 헬퍼 함수 (토큰 갱신 자동 처리 포함, 중복 요청 방지)
const authenticatedRequest = async (endpoint, options = {}, retryCount = 0) => {
  const cacheKey = getCacheKey(endpoint);
  
  // 진행 중인 요청이 있으면 기다림
  if (pendingRequests.has(cacheKey)) {
    return pendingRequests.get(cacheKey);
  }
  
  // 캐시된 요청이 있으면 반환
  const cached = getCachedRequest(cacheKey);
  if (cached) {
    return Promise.resolve(JSON.parse(JSON.stringify(cached.data)));
  }
  
  // 요청 생성
  const requestPromise = (async () => {
    try {
      const token = localStorage.getItem('accessToken');
      
      const defaultHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
      
      if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers,
        },
      });
      
      if (!response.ok) {
        if (response.status === 401 && retryCount === 0) {
          try {
            await refreshToken();
            return authenticatedRequest(endpoint, options, retryCount + 1);
          } catch (refreshError) {
            localStorage.removeItem('accessToken');
            localStorage.removeItem('refreshToken');
            localStorage.removeItem('google_user');
            window.location.href = '/';
            throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
          }
        }
        
        if (response.status === 401) {
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          localStorage.removeItem('google_user');
          window.location.href = '/';
          throw new Error('인증이 만료되었습니다. 다시 로그인해주세요.');
        }
        
        // 404 에러는 조용히 처리 (빈 데이터로 캐시하여 재요청 방지)
        if (response.status === 404 && endpoint.includes('/api/graph/fine')) {
          // 404 에러도 빈 데이터로 캐시하여 불필요한 재요청 방지
          const emptyData = {
            isSuccess: true,
            code: 'SUCCESS',
            message: '해당 이벤트에 대한 데이터가 없습니다.',
            result: {
              characters: [],
              relations: [],
              event: null,
              userCurrentChapter: 0
            }
          };
          setCachedRequest(cacheKey, emptyData);
          return emptyData;
        }
        
        throw new Error(`API 요청 실패: ${response.status}`);
      }
      
      const data = await response.json();
      
      // 성공한 요청 캐시
      if (response.ok) {
        setCachedRequest(cacheKey, data);
      }
      
      return data;
    } finally {
      pendingRequests.delete(cacheKey);
    }
  })();
  
  pendingRequests.set(cacheKey, requestPromise);
  return requestPromise;
};

/**
 * 거시(챕터 누적) 그래프 조회
 * 특정 챕터까지의 누적 인물 관계 그래프를 조회합니다.
 * @param {Object} params - 조회 파라미터
 * @param {number} params.bookId - 책 ID
 * @param {number} params.uptoChapter - 조회할 마지막 챕터 인덱스
 * @returns {Promise<Object>} 거시 그래프 데이터
 */
export const getMacroGraph = async (params) => {
  try {
    const { bookId, uptoChapter } = params;
    
    if (!bookId || uptoChapter === undefined) {
      throw new Error('bookId와 uptoChapter는 필수 파라미터입니다.');
    }
    
    const queryParams = new URLSearchParams({
      bookId: bookId.toString(),
      uptoChapter: uptoChapter.toString(),
    });
    
    const data = await authenticatedRequest(`/api/graph/macro?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('거시 그래프 조회 실패:', error);
    throw error;
  }
};

/**
 * 세밀(이벤트) 그래프 조회
 * 특정 이벤트에서의 인물 관계 그래프를 조회합니다.
 * @param {number} bookId - 책 ID
 * @param {number} chapterIdx - 챕터 인덱스
 * @param {number} eventIdx - 이벤트 인덱스
 * @returns {Promise<Object>} 세밀 그래프 데이터
 */
export const getFineGraph = async (bookId, chapterIdx, eventIdx) => {
  try {
    if (!bookId || chapterIdx === undefined || eventIdx === undefined) {
      throw new Error('bookId, chapterIdx, eventIdx는 필수 파라미터입니다.');
    }
    
    // eventIdx=0은 404 에러가 발생하므로 조용히 빈 데이터 반환
    if (eventIdx === 0 || eventIdx < 1) {
      const emptyData = {
        isSuccess: true,
        code: 'SUCCESS',
        message: '해당 이벤트에 대한 데이터가 없습니다.',
        result: {
          characters: [],
          relations: [],
          event: null,
          userCurrentChapter: 0
        }
      };
      // 빈 데이터도 캐시하여 불필요한 요청 방지
      const cacheKey = getCacheKey(`/api/graph/fine?bookId=${bookId}&chapterIdx=${chapterIdx}&eventIdx=${eventIdx}`);
      setCachedRequest(cacheKey, emptyData);
      return emptyData;
    }
    
    // manifest 캐시에서 이벤트 유효성 검사 (API 책인 경우)
    if (typeof bookId === 'number') {
      const { isValidEvent } = await import('../common/manifestCache');
      const isValid = isValidEvent(bookId, chapterIdx, eventIdx);
      if (!isValid) {
        // 유효하지 않은 이벤트는 API 호출 없이 빈 데이터 반환 및 캐시
        const emptyData = {
          isSuccess: true,
          code: 'SUCCESS',
          message: '해당 이벤트에 대한 데이터가 없습니다.',
          result: {
            characters: [],
            relations: [],
            event: null,
            userCurrentChapter: 0
          }
        };
        const cacheKey = getCacheKey(`/api/graph/fine?bookId=${bookId}&chapterIdx=${chapterIdx}&eventIdx=${eventIdx}`);
        setCachedRequest(cacheKey, emptyData);
        return emptyData;
      }
    }
    
    const queryParams = new URLSearchParams({
      bookId: bookId.toString(),
      chapterIdx: chapterIdx.toString(),
      eventIdx: eventIdx.toString(),
    });
    
    const data = await authenticatedRequest(`/api/graph/fine?${queryParams.toString()}`);
    return data;
  } catch (error) {
    // 404는 데이터 없음으로 정상 상황 - 빈 데이터 반환 및 캐시
    if (error.status === 404 || error.message?.includes('404') || error.message?.includes('찾을 수 없습니다') || error.message?.includes('API 요청 실패: 404')) {
      const emptyData = {
        isSuccess: true,
        code: 'SUCCESS',
        message: '해당 이벤트에 대한 데이터가 없습니다.',
        result: {
          characters: [],
          relations: [],
          event: null,
          userCurrentChapter: 0
        }
      };
      // 404 에러도 빈 데이터로 캐시하여 불필요한 재요청 방지
      const cacheKey = getCacheKey(`/api/graph/fine?bookId=${bookId}&chapterIdx=${chapterIdx}&eventIdx=${eventIdx}`);
      setCachedRequest(cacheKey, emptyData);
      return emptyData;
    }
    // 404가 아닌 다른 에러만 콘솔에 출력
    if (error.status !== 404) {
      console.error('세밀 그래프 조회 실패:', error);
    }
    throw error;
  }
};

/**
 * 챕터별 그래프 조회 (거시 그래프의 챕터별 버전)
 * 특정 챕터까지의 누적 인물 관계 그래프를 조회합니다.
 * @param {Object} params - 조회 파라미터
 * @param {number} params.bookId - 책 ID
 * @param {number} params.chapterIdx - 챕터 인덱스
 * @returns {Promise<Object>} 챕터별 그래프 데이터
 */
export const getChapterGraph = async (params) => {
  try {
    const { bookId, chapterIdx } = params;
    
    if (!bookId || chapterIdx === undefined) {
      throw new Error('bookId와 chapterIdx는 필수 파라미터입니다.');
    }
    
    const queryParams = new URLSearchParams({
      bookId: bookId.toString(),
      chapterIdx: chapterIdx.toString(),
    });
    
    const data = await authenticatedRequest(`/api/graph/chapter?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('챕터 그래프 조회 실패:', error);
    throw error;
  }
};

/**
 * 그래프 데이터를 Cytoscape.js 형식으로 변환
 * @param {Object} graphData - API에서 받은 그래프 데이터
 * @returns {Object} Cytoscape.js 형식의 노드와 엣지 데이터
 */
export const transformGraphData = (graphData) => {
  if (!graphData || !graphData.result) {
    return { nodes: [], edges: [] };
  }
  
  const { characters, relations } = graphData.result;
  
  // 노드 변환
  const nodes = characters.map(character => ({
    data: {
      id: character.id.toString(),
      label: character.common_name || character.names[0] || `Character ${character.id}`,
      names: character.names,
      description: character.description,
      profileImage: character.profileImage,
      weight: character.weight,
      count: character.count,
      mainCharacter: character.main_character,
      portraitPrompt: character.portrait_prompt,
    },
    classes: character.main_character ? 'main-character' : 'character',
  }));
  
  // 엣지 변환 및 통합
  const edgeMap = new Map();
  
  relations.forEach(relation => {
    const id1 = relation.id1.toString();
    const id2 = relation.id2.toString();
    
    // 노드 쌍을 정규화된 키로 변환 (작은 ID가 앞에 오도록)
    const edgeKey = id1 < id2 ? `${id1}-${id2}` : `${id2}-${id1}`;
    const source = id1 < id2 ? id1 : id2;
    const target = id1 < id2 ? id2 : id1;
    
    if (edgeMap.has(edgeKey)) {
      // 기존 간선에 관계 추가
      const existingEdge = edgeMap.get(edgeKey);
      existingEdge.data.relation = [...new Set([...existingEdge.data.relation, ...relation.relation])]; // 중복 제거
      existingEdge.data.count = (existingEdge.data.count || 0) + (relation.count || 0);
      existingEdge.data.label = existingEdge.data.relation.join(', ');
    } else {
      // 새로운 간선 생성
      edgeMap.set(edgeKey, {
        data: {
          id: edgeKey,
          source: source,
          target: target,
          positivity: relation.positivity,
          count: relation.count,
          relation: relation.relation,
          label: relation.relation.join(', '),
        },
        classes: relation.positivity > 0 ? 'positive' : relation.positivity < 0 ? 'negative' : 'neutral',
      });
    }
  });
  
  const edges = Array.from(edgeMap.values());
  
  return { nodes, edges };
};

/**
 * 거시 그래프 데이터를 Cytoscape.js 형식으로 변환
 * @param {Object} macroGraphData - 거시 그래프 API 응답 데이터
 * @returns {Object} 변환된 Cytoscape.js 데이터
 */
export const transformMacroGraphData = (macroGraphData) => {
  return transformGraphData(macroGraphData);
};

/**
 * 세밀 그래프 데이터를 Cytoscape.js 형식으로 변환
 * @param {Object} fineGraphData - 세밀 그래프 API 응답 데이터
 * @returns {Object} 변환된 Cytoscape.js 데이터
 */
export const transformFineGraphData = (fineGraphData) => {
  const transformed = transformGraphData(fineGraphData);
  
  // 세밀 그래프의 경우 이벤트 정보도 추가
  if (fineGraphData?.result?.event) {
    transformed.event = fineGraphData.result.event;
  }
  
  return transformed;
};

/**
 * 그래프 스타일 정의
 * @returns {Object} Cytoscape.js 스타일 정의
 */
export const getGraphStyles = () => {
  return [
    {
      selector: 'node',
      style: {
        'background-color': '#666',
        'label': 'data(label)',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-size': '12px',
        'font-weight': 'bold',
        'color': '#fff',
        'text-outline-width': 2,
        'text-outline-color': '#000',
        'width': 'mapData(weight, 0, 100, 20, 60)',
        'height': 'mapData(weight, 0, 100, 20, 60)',
      },
    },
    {
      selector: 'node.main-character',
      style: {
        'background-color': '#ff6b6b',
        'border-width': 3,
        'border-color': '#ff4757',
      },
    },
    {
      selector: 'edge',
      style: {
        'width': 'mapData(count, 0, 10, 1, 5)',
        'line-color': '#ccc',
        'target-arrow-color': '#ccc',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        'label': 'data(label)',
        'font-size': '10px',
        'text-rotation': 'autorotate',
        'text-margin-y': -10,
      },
    },
    {
      selector: 'edge.positive',
      style: {
        'line-color': '#2ed573',
        'target-arrow-color': '#2ed573',
      },
    },
    {
      selector: 'edge.negative',
      style: {
        'line-color': '#ff4757',
        'target-arrow-color': '#ff4757',
      },
    },
    {
      selector: 'edge.neutral',
      style: {
        'line-color': '#ffa502',
        'target-arrow-color': '#ffa502',
      },
    },
  ];
};
