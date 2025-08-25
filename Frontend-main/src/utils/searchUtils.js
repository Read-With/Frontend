/**
 * 검색 관련 유틸리티 함수들
 */

/**
 * 검색된 요소들의 ID 집합을 생성
 * @param {Array} filteredElements - 검색 결과 요소들
 * @returns {Set} 검색된 요소들의 ID 집합
 */
export function createFilteredElementIds(filteredElements) {
  const filteredElementIds = new Set();
  
  if (!filteredElements || filteredElements.length === 0) {
    return filteredElementIds;
  }
  
  filteredElements.forEach(element => {
    if (element.data.source) {
      // 간선인 경우
      filteredElementIds.add(element.data.source);
      filteredElementIds.add(element.data.target);
    } else {
      // 노드인 경우
      filteredElementIds.add(element.data.id);
    }
  });
  
  return filteredElementIds;
}

/**
 * 검색 상태에 따라 그래프 요소들에 페이드 효과 적용
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Array} filteredElements - 검색 결과 요소들
 * @param {boolean} isSearchActive - 검색 활성 상태
 * @param {Object} options - 페이드 효과 옵션
 * @param {number} options.fadeOpacity - 페이드 아웃 투명도 (기본: 0.05)
 * @param {number} options.textFadeOpacity - 텍스트 페이드 아웃 투명도 (기본: 0.02)
 * @param {boolean} options.enableLogging - 로깅 활성화 (기본: true)
 * @returns {Object} 페이드 효과 적용 결과 통계
 */
export function applySearchFadeEffect(cy, filteredElements, isSearchActive, options = {}) {
  const {
    fadeOpacity = 0.05,
    textFadeOpacity = 0.02,
    enableLogging = true
  } = options;

  // 검색이 비활성화된 경우 모든 페이드 효과 제거
  if (!isSearchActive) {
    if (enableLogging) {
      console.log('🔄 검색 초기화: 모든 페이드 아웃 제거');
    }
    
    cy.elements().forEach(element => {
      element.removeClass("faded highlighted");
      element.style('opacity', '');
      element.style('text-opacity', '');
    });
    
    return {
      fadedNodes: 0,
      visibleNodes: cy.nodes().length,
      fadedEdges: 0,
      visibleEdges: cy.edges().length
    };
  }

  // 검색이 활성화되었지만 결과가 없는 경우
  if (!filteredElements || filteredElements.length === 0) {
    return {
      fadedNodes: 0,
      visibleNodes: 0,
      fadedEdges: 0,
      visibleEdges: 0
    };
  }

  if (enableLogging) {
    console.log('🔍 검색 상태 감지:', { isSearchActive, filteredElements: filteredElements.length });
  }

  // 검색 결과에 포함된 요소들의 ID 집합 생성
  const filteredElementIds = createFilteredElementIds(filteredElements);

  if (enableLogging) {
    console.log('📋 검색 결과 ID 목록:', Array.from(filteredElementIds));
  }

  let fadedNodeCount = 0;
  let visibleNodeCount = 0;
  let fadedEdgeCount = 0;
  let visibleEdgeCount = 0;

  // 검색 결과에 포함되지 않은 모든 노드들을 페이드 아웃
  cy.nodes().forEach(node => {
    if (!filteredElementIds.has(node.id())) {
      node.addClass("faded");
      node.style('opacity', fadeOpacity);
      node.style('text-opacity', textFadeOpacity);
      fadedNodeCount++;
    } else {
      node.removeClass("faded");
      node.style('opacity', '');
      node.style('text-opacity', '');
      visibleNodeCount++;
    }
  });

  // 검색 결과에 포함되지 않은 모든 간선들을 페이드 아웃
  cy.edges().forEach(edge => {
    const edgeData = edge.data();
    if (!filteredElementIds.has(edgeData.source) || !filteredElementIds.has(edgeData.target)) {
      edge.addClass("faded");
      edge.style('opacity', fadeOpacity);
      fadedEdgeCount++;
    } else {
      edge.removeClass("faded");
      edge.style('opacity', '');
      visibleEdgeCount++;
    }
  });

  const result = {
    fadedNodes: fadedNodeCount,
    visibleNodes: visibleNodeCount,
    fadedEdges: fadedEdgeCount,
    visibleEdges: visibleEdgeCount
  };

  if (enableLogging) {
    console.log('👻 페이드 아웃 결과:', result);
  }

  return result;
}

/**
 * 검색 상태에서 노드 클릭 시 하이라이트 효과 적용
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Object} clickedNode - 클릭된 노드
 * @param {Array} filteredElements - 검색 결과 요소들
 * @param {Object} options - 하이라이트 옵션
 * @returns {boolean} 하이라이트 적용 성공 여부
 */
export function applySearchHighlight(cy, clickedNode, filteredElements, options = {}) {
  if (!filteredElements || filteredElements.length === 0) {
    return false;
  }

  const filteredElementIds = createFilteredElementIds(filteredElements);
  const clickedNodeId = clickedNode.id();

  // 클릭한 노드가 검색 결과에 포함되어 있는지 확인
  if (filteredElementIds.has(clickedNodeId)) {
    // 클릭한 노드와 직접 연결된 검색 결과 요소들만 하이라이트
    const connectedElements = new Set();
    connectedElements.add(clickedNodeId);

    // 클릭한 노드와 직접 연결된 검색 결과 노드들 찾기
    const connectedNodes = clickedNode.neighborhood().nodes();
    connectedNodes.forEach(connectedNode => {
      const connectedNodeId = connectedNode.id();
      if (filteredElementIds.has(connectedNodeId)) {
        connectedElements.add(connectedNodeId);
      }
    });

    // 클릭한 노드와 직접 연결된 검색 결과 간선들 찾기
    const connectedEdges = clickedNode.connectedEdges();
    connectedEdges.forEach(edge => {
      const edgeData = edge.data();
      if (filteredElementIds.has(edgeData.source) && filteredElementIds.has(edgeData.target)) {
        connectedElements.add(edgeData.source);
        connectedElements.add(edgeData.target);
      }
    });

    // 연결된 검색 결과 요소들만 하이라이트
    connectedElements.forEach(elementId => {
      const element = cy.getElementById(elementId);
      if (element.length > 0) {
        element.removeClass("faded").addClass("highlighted");
        if (!element.data().source) {
          // 노드인 경우, 검색 결과에 포함된 연결 간선들만 하이라이트
          const nodeConnectedEdges = element.connectedEdges();
          nodeConnectedEdges.forEach(edge => {
            const edgeData = edge.data();
            if (filteredElementIds.has(edgeData.source) && filteredElementIds.has(edgeData.target)) {
              edge.removeClass("faded").addClass("highlighted");
            }
          });
        }
      }
    });
  } else {
    // 클릭한 노드가 검색 결과에 포함되지 않은 경우, 검색 결과에 포함된 모든 요소들 하이라이트
    filteredElementIds.forEach(elementId => {
      const element = cy.getElementById(elementId);
      if (element.length > 0) {
        element.removeClass("faded").addClass("highlighted");
        if (!element.data().source) {
          // 노드인 경우, 검색 결과에 포함된 연결 간선들만 하이라이트
          const connectedEdges = element.connectedEdges();
          connectedEdges.forEach(edge => {
            const edgeData = edge.data();
            if (filteredElementIds.has(edgeData.source) && filteredElementIds.has(edgeData.target)) {
              edge.removeClass("faded").addClass("highlighted");
            }
          });
        }
      }
    });
  }

  return true;
}

/**
 * 통일된 검색 결과 없음 조건 확인
 * @param {boolean} isSearchActive - 검색 활성 상태
 * @param {string} searchTerm - 검색어
 * @param {Array} fitNodeIds - 검색된 노드 ID 배열
 * @param {Array} suggestions - 검색 제안 배열
 * @returns {boolean} 검색 결과 없음 여부
 */
export function shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds = [], suggestions = []) {
  return isSearchActive && 
         searchTerm && 
         searchTerm.trim().length > 0 &&
         (!fitNodeIds || fitNodeIds.length === 0) &&
         (!suggestions || suggestions.length === 0);
}

/**
 * 검색 결과 없음 메시지 생성
 * @param {string} searchTerm - 검색어
 * @returns {Object} 메시지 객체
 */
export function getNoSearchResultsMessage(searchTerm) {
  return {
    title: "검색 결과가 없습니다",
    description: `"${searchTerm}"와 일치하는 인물을 찾을 수 없습니다.`
  };
}

/**
 * 검색 결과 없음 여부 확인 (기존 호환성을 위한 함수)
 * @param {boolean} isSearchActive - 검색 활성 상태
 * @param {string} searchTerm - 검색어
 * @param {Array} fitNodeIds - 검색된 노드 ID 배열
 * @param {Array} suggestions - 검색 제안 배열
 * @returns {boolean} 검색 결과 없음 여부
 * @deprecated shouldShowNoSearchResults 사용 권장
 */
export function hasNoSearchResults(isSearchActive, searchTerm, fitNodeIds = [], suggestions = []) {
  return shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds, suggestions);
}
