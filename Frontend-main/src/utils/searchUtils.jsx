/**
 * 통합 검색 관련 유틸리티 함수들
 */

// 정규식 캐싱을 위한 Map
const regexCache = new Map();

// 텍스트에서 검색어 부분만 분리해 하이라이트 가능하게 함
function highlightParts(text, query) {
  if (!query || !text) return [text];
  
  const cacheKey = query.toLowerCase();
  let regex = regexCache.get(cacheKey);
  
  if (!regex) {
    regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
    regexCache.set(cacheKey, regex);
  }
  
  return String(text).split(regex).filter(Boolean);
}

// 검색어에 특수문자가 있어도 정규식 안전 처리
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 노드가 검색어와 매칭되는지 확인
export function nodeMatchesQuery(node, searchLower) {
  if (!node?.data || typeof searchLower !== 'string') return false;
  
  try {
    const label = String(node.data.label || '').toLowerCase();
    const names = Array.isArray(node.data.names) ? node.data.names : [];
    const commonName = String(node.data.common_name || '').toLowerCase();
    
    return (
      label.includes(searchLower) ||
      names.some(name => String(name).toLowerCase().includes(searchLower)) ||
      commonName.includes(searchLower)
    );
  } catch (error) {
    console.warn('nodeMatchesQuery 에러:', error);
    return false;
  }
}

// 입력된 검색어와 관련된 노드(인물 등)를 찾아 최대 8개 추천 리스트 생성
export function buildSuggestions(elements, query, currentChapterData = null) {
  if (!Array.isArray(elements)) {
    console.warn('buildSuggestions: elements는 배열이어야 합니다');
    return [];
  }
  
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) return [];
  const searchLower = trimmed.toLowerCase();
  const characterNodes = elements.filter(el => !el.data.source);



  // 현재 챕터의 캐릭터 데이터가 있는 경우, 해당 챕터에 존재하는 인물만 필터링
  let filteredNodes = characterNodes;
  if (currentChapterData && currentChapterData.characters) {
    const chapterCharacterIds = new Set(
      currentChapterData.characters.map(char => String(char.id))
    );
    filteredNodes = characterNodes.filter(node => 
      chapterCharacterIds.has(node.data.id)
    );
  }

  const matches = filteredNodes
    .filter(node => nodeMatchesQuery(node, searchLower))
    .map(node => {
      const label = node.data.label?.toLowerCase() || '';
      const names = node.data.names || [];
      const commonName = node.data.common_name?.toLowerCase() || '';
      let matchType = 'none';
      if (label.includes(searchLower)) matchType = 'label';
      else if (names.some(name => String(name).toLowerCase().includes(searchLower))) matchType = 'names';
      else if (commonName.includes(searchLower)) matchType = 'common_name';
      return {
        id: node.data.id,
        label: node.data.label,
        names: node.data.names || [],
        common_name: node.data.common_name,
        matchType
      };
    })
    .slice(0, 8);
  return matches;
}

// 그래프 요소 필터링 및 연결 관계 처리
export function filterGraphElements(elements, searchTerm, currentChapterData = null) {
  if (!searchTerm || searchTerm.trim().length < 2) return elements;
  const searchLower = searchTerm.toLowerCase();
  
  // 현재 챕터의 캐릭터 데이터가 있는 경우, 해당 챕터에 존재하는 인물만 필터링
  let matchingNodes;
  if (currentChapterData && currentChapterData.characters) {
    const chapterCharacterIds = new Set(
      currentChapterData.characters.map(char => String(char.id))
    );
    matchingNodes = elements.filter(el => 
      !el.data.source && 
      nodeMatchesQuery(el, searchLower) && 
      chapterCharacterIds.has(el.data.id)
    );
  } else {
    // 챕터 데이터가 없는 경우 기존 로직 사용
    matchingNodes = elements.filter(el => !el.data.source && nodeMatchesQuery(el, searchLower));
  }
  
  const matchingNodeIds = new Set(matchingNodes.map(node => node.data.id));
  
  // 검색된 인물과 연결된 모든 간선 찾기
  const connectedEdges = elements.filter(el => 
    el.data.source && 
    (matchingNodeIds.has(el.data.source) || matchingNodeIds.has(el.data.target))
  );
  
  // 연결된 간선의 source와 target 노드들도 포함
  const connectedNodeIds = new Set();
  connectedEdges.forEach(edge => {
    connectedNodeIds.add(edge.data.source);
    connectedNodeIds.add(edge.data.target);
  });
  
  // 검색된 노드와 연결된 모든 노드들 추가
  const allConnectedNodes = elements.filter(el => 
    !el.data.source && 
    connectedNodeIds.has(el.data.id)
  );
  
  return [...allConnectedNodes, ...connectedEdges];
}

// 텍스트 하이라이트 렌더링 함수
export function highlightText(text, term, highlightStyle = { fontWeight: 'bold', color: '#6C8EFF' }) {
  const parts = highlightParts(text, term);
  return parts.map((part, index) =>
    part.toLowerCase && term && part.toLowerCase() === term.toLowerCase() ? (
      <span key={index} style={highlightStyle}>{part}</span>
    ) : (
      <span key={index}>{part}</span>
    )
  );
}

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
 * @returns {Object} 페이드 효과 적용 결과 통계 및 cleanup 함수
 */
export function applySearchFadeEffect(cy, filteredElements, isSearchActive, options = {}) {
  const {
    fadeOpacity = 0.05,
    textFadeOpacity = 0.02,
    enableLogging = true
  } = options;

  // 검색이 비활성화된 경우 모든 페이드 효과 제거
  if (!isSearchActive) {
    
    cy.elements().forEach(element => {
      element.removeClass("faded highlighted");
      element.style('opacity', '');
      element.style('text-opacity', '');
    });
    
    const result = {
      fadedNodes: 0,
      visibleNodes: cy.nodes().length,
      fadedEdges: 0,
      visibleEdges: cy.edges().length,
      cleanup: () => {} // 빈 cleanup 함수
    };
    
    return result;
  }

  // 검색이 활성화되었지만 결과가 없는 경우
  if (!filteredElements || filteredElements.length === 0) {
    const result = {
      fadedNodes: 0,
      visibleNodes: 0,
      fadedEdges: 0,
      visibleEdges: 0,
      cleanup: () => {} // 빈 cleanup 함수
    };
    
    return result;
  }



  // 검색 결과에 포함된 요소들의 ID 집합 생성
  const filteredElementIds = createFilteredElementIds(filteredElements);

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
    visibleEdges: visibleEdgeCount,
    cleanup: () => {
      // 모든 페이드 효과 제거
      cy.elements().forEach(element => {
        element.removeClass("faded highlighted");
        element.style('opacity', '');
        element.style('text-opacity', '');
      });
    }
  };
  return result;
}

/**
 * 검색 상태에서 노드 클릭 시 하이라이트 효과 적용
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Object} clickedNode - 클릭된 노드
 * @param {Array} filteredElements - 검색 결과 요소들
 * @param {Object} options - 하이라이트 옵션
 * @returns {Object} 하이라이트 적용 결과 및 cleanup 함수
 */
export function applySearchHighlight(cy, clickedNode, filteredElements, options = {}) {
  if (!filteredElements || filteredElements.length === 0) {
    return {
      success: false,
      cleanup: () => {}
    };
  }

  const filteredElementIds = createFilteredElementIds(filteredElements);
  const clickedNodeId = clickedNode.id();
  const highlightedElements = new Set();

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
        highlightedElements.add(elementId);
        
        if (!element.data().source) {
          // 노드인 경우, 검색 결과에 포함된 연결 간선들만 하이라이트
          const nodeConnectedEdges = element.connectedEdges();
          nodeConnectedEdges.forEach(edge => {
            const edgeData = edge.data();
            if (filteredElementIds.has(edgeData.source) && filteredElementIds.has(edgeData.target)) {
              edge.removeClass("faded").addClass("highlighted");
              highlightedElements.add(edge.id());
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
        highlightedElements.add(elementId);
        
        if (!element.data().source) {
          // 노드인 경우, 검색 결과에 포함된 연결 간선들만 하이라이트
          const connectedEdges = element.connectedEdges();
          connectedEdges.forEach(edge => {
            const edgeData = edge.data();
            if (filteredElementIds.has(edgeData.source) && filteredElementIds.has(edgeData.target)) {
              edge.removeClass("faded").addClass("highlighted");
              highlightedElements.add(edge.id());
            }
          });
        }
      }
    });
  }

  return {
    success: true,
    highlightedCount: highlightedElements.size,
    cleanup: () => {
      // 하이라이트된 요소들만 정리
      highlightedElements.forEach(elementId => {
        const element = cy.getElementById(elementId);
        if (element.length > 0) {
          element.removeClass("highlighted");
        }
      });
      

    }
  };
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
 * 정규식 캐시 정리 함수
 * @returns {void}
 */
export function clearRegexCache() {
  regexCache.clear();
}

/**
 * 모든 검색 관련 리소스 정리 함수
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupSearchResources(cy = null) {
  // 정규식 캐시 정리
  clearRegexCache();
  
  // Cytoscape 인스턴스가 있는 경우 모든 효과 제거
  if (cy && typeof cy.elements === 'function') {
    cy.elements().forEach(element => {
      element.removeClass("faded highlighted");
      element.style('opacity', '');
      element.style('text-opacity', '');
    });
  }
}


