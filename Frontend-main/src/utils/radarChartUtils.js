/**
 * 레이더 차트 데이터 처리 유틸리티
 * 관계 색/라벨은 relationStyles 단일 소스에서 re-export.
 */
export { getPositivityColor, getPositivityLabel } from './styles/relationStyles';

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
  const radarDataMap = new Map(); // 중복 제거를 위한 Map

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
      // 이미 해당 인물에 대한 데이터가 있는지 확인
      const existingData = radarDataMap.get(connectedNodeId);
      
      // 새로운 관계의 절댓값이 더 크면 업데이트 (더 강한 관계 우선)
      if (!existingData || Math.abs(rel.positivity) > Math.abs(existingData.positivity)) {
        // 연결된 노드의 이름 찾기
        const connectedNode = elements.find(el => 
          !el.data.source && String(el.data.id) === connectedNodeId
        );
        
        if (connectedNode && rel.positivity !== undefined) {
          // 전체 이름 사용
          const fullName = connectedNode.data.label || connectedNode.data.common_name || `인물 ${connectedNodeId}`;
          
          const radarItem = {
            name: fullName,
            fullName: fullName,
            positivity: rel.positivity,
            normalizedValue: normalizePositivity(rel.positivity),
            relationCount: rel.count || 0,
            relationTags: rel.relation || [],
            connectedNodeId: connectedNodeId
          };
          
          radarDataMap.set(connectedNodeId, radarItem);
        }
      }
    }
  });

  // Map을 배열로 변환하고 positivity 절댓값 기준으로 정렬 (관계가 강한 순서)
  const radarData = Array.from(radarDataMap.values());
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
