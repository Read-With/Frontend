/**
 * 레이더 차트 데이터 처리 유틸리티
 */

/**
 * positivity 값을 0-100 스케일로 변환
 * @param {number} positivity -1 ~ 1 사이의 값
 * @returns {number} 0 ~ 100 사이의 값
 */
export const normalizePositivity = (positivity) => {
  if (positivity === undefined || positivity === null || isNaN(positivity)) {
    return 50; // 기본값: 중립 (0 -> 50%)
  }
  return ((positivity + 1) / 2) * 100;
};

/**
 * 노드의 관계 데이터에서 레이더 차트용 데이터 추출
 * @param {string|number} nodeId - 선택된 노드 ID
 * @param {Array} relations - 관계 데이터 배열
 * @param {Array} elements - 그래프 요소들 (노드 정보를 가져오기 위함)
 * @param {number} maxDisplay - 최대 표시할 인물 수
 * @returns {Array} 레이더 차트용 데이터 배열
 */
export const extractRadarChartData = (nodeId, relations, elements, maxDisplay = 8) => {
  if (!nodeId || !relations || !Array.isArray(relations)) {
    return [];
  }

  const targetNodeId = String(nodeId);
  const radarData = [];

  // 선택된 노드와 연결된 모든 관계 찾기
  relations.forEach((rel) => {
    // id1/id2 또는 source/target 모두 지원
    const id1 = String(rel.id1 ?? rel.source);
    const id2 = String(rel.id2 ?? rel.target);
    
    let connectedNodeId = null;
    
    if (id1 === targetNodeId) {
      connectedNodeId = id2;
    } else if (id2 === targetNodeId) {
      connectedNodeId = id1;
    }
    
    if (connectedNodeId) {
      // 연결된 노드의 이름 찾기
      const connectedNode = elements.find(el => 
        !el.data.source && String(el.data.id) === connectedNodeId
      );
      
      if (connectedNode && rel.positivity !== undefined) {
        // 이름 처리: 띄어쓰기 기준 첫 단어만 사용
        const fullName = connectedNode.data.label || connectedNode.data.common_name || `인물 ${connectedNodeId}`;
        const shortName = fullName.split(' ')[0];
        
        const radarItem = {
          name: shortName,
          fullName: fullName, // 툴팁에서 전체 이름 표시용
          positivity: rel.positivity,
          normalizedValue: normalizePositivity(rel.positivity),
          relationCount: rel.count || 0,
          relationTags: rel.relation || [],
          connectedNodeId: connectedNodeId
        };
        
        radarData.push(radarItem);
      }
    }
  });

  // positivity 절댓값 기준으로 정렬 (관계가 강한 순서)
  radarData.sort((a, b) => Math.abs(b.positivity) - Math.abs(a.positivity));
  
  // 최대 표시 개수로 제한
  return radarData.slice(0, maxDisplay);
};

/**
 * 연결된 인물이 적을 때의 처리 상태 확인
 * @param {Array} radarData - 레이더 차트 데이터
 * @returns {Object} 처리 상태 정보
 */
export const getConnectionStatus = (radarData) => {
  const connectionCount = radarData.length;
  
  if (connectionCount === 0) {
    return {
      status: 'no_connections',
      message: '연결된 인물이 없습니다.',
      suggestion: '다른 인물을 선택하거나 다른 챕터를 확인해보세요.'
    };
  }
  
  if (connectionCount <= 2) {
    return {
      status: 'few_connections',
      message: `연결된 인물이 ${connectionCount}명입니다.`,
      suggestion: '관계가 적은 인물입니다. 다른 인물을 선택하거나 다른 챕터를 확인해보세요.',
      connectionCount
    };
  }
  
  return {
    status: 'sufficient_connections',
    message: `연결된 인물이 ${connectionCount}명입니다.`,
    connectionCount
  };
};

/**
 * positivity 값에 따른 색상 반환
 * @param {number} positivity -1 ~ 1 사이의 값
 * @returns {string} 색상 코드
 */

export const getPositivityColor = (positivity) => {
  if (positivity === undefined || positivity === null || isNaN(positivity)) {
    return 'hsl(60, 70%, 45%)'; // 기본값: 중립 (노란색 계열)
  }
  const h = (120 * (positivity + 1)) / 2;
  return `hsl(${h}, 70%, 45%)`;
};

/**
 * positivity 값에 따른 라벨 반환
 * @param {number} positivity -1 ~ 1 사이의 값
 * @returns {string} 관계 상태 라벨
 */
export const getPositivityLabel = (positivity) => {
  if (positivity === undefined || positivity === null || isNaN(positivity)) {
    return '정보 없음';
  }
  if (positivity > 0.6) return '매우 긍정적';
  if (positivity > 0.3) return '긍정적';
  if (positivity > 0.1) return '약간 긍정적';
  if (positivity > -0.1) return '중립적';
  if (positivity > -0.3) return '약간 부정적';
  if (positivity > -0.6) return '부정적';
  return '매우 부정적';
};