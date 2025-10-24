/**
 * 인물 관계 그래프 관련 API 호출 유틸리티
 */

// API 기본 URL 설정
const getApiBaseUrl = () => {
  return 'http://localhost:8080';
};

const API_BASE_URL = getApiBaseUrl();

// 인증된 API 요청 헬퍼 함수
const authenticatedRequest = async (endpoint, options = {}) => {
  const token = localStorage.getItem('access_token');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
  
  // 토큰이 있으면 Authorization 헤더 추가
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${API_BASE_URL}/api${endpoint}`, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
  
  if (!response.ok) {
    if (response.status === 401) {
      // 토큰 만료 시 로그아웃 처리
      localStorage.removeItem('access_token');
      localStorage.removeItem('google_user');
      window.location.href = '/';
    }
    throw new Error(`API 요청 실패: ${response.status}`);
  }
  
  return response.json();
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
    
    const data = await authenticatedRequest(`/graph/macro?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('거시 그래프 조회 실패:', error);
    throw error;
  }
};

/**
 * 세밀(이벤트) 그래프 조회
 * 특정 이벤트에서의 인물 관계 그래프를 조회합니다.
 * @param {Object} params - 조회 파라미터
 * @param {number} params.bookId - 책 ID
 * @param {number} params.chapterIdx - 챕터 인덱스
 * @param {number} params.eventIdx - 이벤트 인덱스
 * @returns {Promise<Object>} 세밀 그래프 데이터
 */
export const getFineGraph = async (params) => {
  try {
    const { bookId, chapterIdx, eventIdx } = params;
    
    if (!bookId || chapterIdx === undefined || eventIdx === undefined) {
      throw new Error('bookId, chapterIdx, eventIdx는 필수 파라미터입니다.');
    }
    
    const queryParams = new URLSearchParams({
      bookId: bookId.toString(),
      chapterIdx: chapterIdx.toString(),
      eventIdx: eventIdx.toString(),
    });
    
    const data = await authenticatedRequest(`/graph/fine?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('세밀 그래프 조회 실패:', error);
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
  
  // 엣지 변환
  const edges = relations.map(relation => ({
    data: {
      id: `${relation.id1}-${relation.id2}`,
      source: relation.id1.toString(),
      target: relation.id2.toString(),
      positivity: relation.positivity,
      count: relation.count,
      relation: relation.relation,
      label: relation.relation.join(', '),
    },
    classes: relation.positivity > 0 ? 'positive' : relation.positivity < 0 ? 'negative' : 'neutral',
  }));
  
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
