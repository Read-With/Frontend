/**
 * 검색 유틸리티 (Search Utils)
 * 주요 기능:
 * 1. 검색 및 필터링
 *    - nodeMatchesQuery: 노드가 검색어와 매칭되는지 확인
 *    - buildSuggestions: 검색어 기반 인물 추천 리스트 생성 (최대 8개)
 *    - filterGraphElements: 검색어에 맞는 노드와 연결된 요소들 필터링
 * 
 * 2. 시각적 효과
 *    - highlightText: 검색어를 텍스트에서 하이라이트 렌더링
 *    - applySearchFadeEffect: 검색 결과 외 요소들을 페이드 아웃
 *    - applySearchHighlight: 클릭된 노드와 연결된 검색 결과 하이라이트
 * 
 * 3. 검색 결과 처리
 *    - createFilteredElementIds: 필터링된 요소들의 ID 집합 생성
 *    - shouldShowNoSearchResults: 검색 결과 없음 상태 확인
 *    - getNoSearchResultsMessage: 검색 결과 없음 메시지 생성
 * 
 * 4. 성능 최적화
 *    - regexCache: 정규식 캐싱으로 검색 성능 향상 (최대 500개, TTL 5분)
 *    - clearRegexCache: 정규식 캐시 정리
 *    - cleanupSearchResources: 모든 검색 관련 리소스 정리
 * 
 * 특징:
 * - 챕터별 필터링 지원 (currentChapterData)
 * - 완전 일치 및 부분 일치 검색
 * - label, common_name, names 배열 검색 지원
 * - 에러 처리 및 입력 검증 완비
 * - cleanup 함수 패턴으로 메모리 관리
 */

import React from 'react';
import { registerCache, recordCacheAccess, enforceCacheSizeLimit } from './common/cache/cacheManager';

const regexCache = new Map();
registerCache('regexCache', regexCache, { maxSize: 500, ttl: 300000 });

/**
 * 텍스트를 검색어로 분할하여 하이라이트용 배열로 변환
 * @param {string} text - 원본 텍스트
 * @param {string} query - 검색어
 * @returns {Array} 분할된 텍스트 배열
 */
function highlightParts(text, query) {
  if (!query || !text) {
    return [text];
  }
  
  try {
    const cacheKey = query.toLowerCase();
    recordCacheAccess('regexCache');
    
    let regex = regexCache.get(cacheKey);
    
    if (!regex) {
      regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
      regexCache.set(cacheKey, regex);
      enforceCacheSizeLimit('regexCache');
    }
    
    return String(text).split(regex).filter(Boolean);
  } catch (error) {
    console.error('highlightParts 실패:', error, { text, query });
    return [text];
  }
}

/**
 * 정규식 특수 문자를 이스케이프하는 함수
 * @param {string} s - 이스케이프할 문자열
 * @returns {string} 이스케이프된 문자열
 */
function escapeRegExp(s) {
  if (!s || typeof s !== 'string') {
    console.warn('escapeRegExp: 유효하지 않은 입력입니다', { s, type: typeof s });
    return '';
  }
  
  try {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  } catch (error) {
    console.error('escapeRegExp 실패:', error, { s });
    return s;
  }
}

/**
 * 노드가 검색어와 매칭되는지 확인하는 함수
 * @param {Object} node - 검사할 노드 객체
 * @param {string} searchLower - 소문자로 변환된 검색어
 * @returns {boolean} 매칭 여부
 */
export function nodeMatchesQuery(node, searchLower) {
  if (!node?.data || typeof searchLower !== 'string') {
    console.warn('nodeMatchesQuery: 유효하지 않은 매개변수입니다', { 
      node: !!node, 
      hasData: !!node?.data, 
      searchLower, 
      type: typeof searchLower 
    });
    return false;
  }
  
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
    console.error('nodeMatchesQuery 실패:', error, { node, searchLower });
    return false;
  }
}

/**
 * 입력된 검색어와 관련된 노드(인물 등)를 찾아 최대 8개 추천 리스트 생성
 * @param {Array} elements - 그래프 요소 배열
 * @param {string} query - 검색어
 * @param {Object} [currentChapterData=null] - 현재 챕터 데이터
 * @returns {Array} 추천 리스트
 */
export function buildSuggestions(elements, query, currentChapterData = null) {
  if (!Array.isArray(elements)) {
    console.warn('buildSuggestions: 유효하지 않은 elements 배열입니다', { 
      elements, 
      type: typeof elements 
    });
    return [];
  }
  
  const trimmed = String(query || '').trim();
  if (trimmed.length < 2) {
    return [];
  }
  
  try {
    const searchLower = trimmed.toLowerCase();
    const characterNodes = elements.filter(el => !el.data.source);
    
    // 현재 챕터의 캐릭터 데이터가 있는 경우, 해당 챕터에 존재하는 인물만 필터링
    let filteredNodes = characterNodes;
    if (currentChapterData && currentChapterData.characters && currentChapterData.characters.length > 0) {
      const chapterCharacterIds = new Set(
        currentChapterData.characters.map(char => String(char.id))
      );
      filteredNodes = characterNodes.filter(node => {
        const nodeId = node?.data?.id;
        if (nodeId === undefined || nodeId === null) return false;
        return chapterCharacterIds.has(String(nodeId));
      });
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
      
      // names 배열에서 중복 제거 (대소문자 구분 없이)
      const uniqueNames = names.filter((name, index, arr) => 
        arr.findIndex(n => String(n).toLowerCase() === String(name).toLowerCase()) === index
      );
      
      return {
        id: node.data.id,
        label: node.data.label,
        names: uniqueNames,
        common_name: node.data.common_name,
        matchType
      };
    })
    // 중복 제거: id 기준으로 중복된 인물 제거
    .reduce((acc, current) => {
      const existingIndex = acc.findIndex(item => 
        item.id === current.id
      );
      if (existingIndex === -1) {
        acc.push(current);
      } else {
        // 이미 존재하는 인물의 경우, names 배열을 병합하고 중복 제거
        const existing = acc[existingIndex];
        const mergedNames = [...(existing.names || []), ...(current.names || [])];
        const uniqueMergedNames = mergedNames.filter((name, index, arr) => 
          arr.findIndex(n => String(n).toLowerCase() === String(name).toLowerCase()) === index
        );
        existing.names = uniqueMergedNames;
      }
      return acc;
    }, [])
    .slice(0, 8);
    return matches;
  } catch (error) {
    console.error('buildSuggestions 실패:', error, { 
      elementsLength: elements?.length, 
      query, 
      hasChapterData: !!currentChapterData 
    });
    return [];
  }
}

/**
 * 그래프 요소 필터링 및 연결 관계 처리
 * @param {Array} elements - 그래프 요소 배열
 * @param {string} searchTerm - 검색어
 * @param {Object} [currentChapterData=null] - 현재 챕터 데이터
 * @returns {Array} 필터링된 요소 배열
 */
export function filterGraphElements(elements, searchTerm, currentChapterData = null) {
  if (!Array.isArray(elements)) {
    console.warn('filterGraphElements: 유효하지 않은 elements 배열입니다', { 
      elements, 
      type: typeof elements 
    });
    return [];
  }
  
  if (!searchTerm || typeof searchTerm !== 'string' || searchTerm.trim().length < 2) {
    return elements;
  }
  
  try {
    const searchLower = searchTerm.toLowerCase();
    
    // 현재 챕터의 캐릭터 데이터가 있는 경우, 해당 챕터에 존재하는 인물만 필터링
    let candidateNodes;
    if (currentChapterData && currentChapterData.characters && currentChapterData.characters.length > 0) {
      const chapterCharacterIds = new Set(
        currentChapterData.characters.map(char => String(char.id))
      );
      candidateNodes = elements.filter(el => {
        if (el.data.source) return false;
        if (!nodeMatchesQuery(el, searchLower)) return false;
        const nodeId = el?.data?.id;
        if (nodeId === undefined || nodeId === null) return false;
        return chapterCharacterIds.has(String(nodeId));
      });
    } else {
      // 챕터 데이터가 없는 경우 기존 로직 사용
      candidateNodes = elements.filter(el => !el.data.source && nodeMatchesQuery(el, searchLower));
    }
    
    // 정확히 일치하는 인물을 우선적으로 찾기
    let matchingNode = candidateNodes.find(node => {
      const label = node.data.label?.toLowerCase() || '';
      const commonName = node.data.common_name?.toLowerCase() || '';
      const names = node.data.names || [];
      
      return label === searchLower || 
             commonName === searchLower || 
             names.some(name => String(name).toLowerCase() === searchLower);
    });
    
    // 완전 일치가 없으면 첫 번째 매칭 선택
    if (!matchingNode && candidateNodes.length > 0) {
      matchingNode = candidateNodes[0];
    }
  
  // 매칭된 인물이 없으면 빈 결과 반환
  if (!matchingNode) {
    return [];
  }
  
  const matchingNodeId = matchingNode.data.id;
  
  // 선택된 인물과 연결된 모든 간선 찾기
  const connectedEdges = elements.filter(el => 
    el.data.source && 
    (el.data.source === matchingNodeId || el.data.target === matchingNodeId)
  );
  
  // 연결된 간선의 source와 target 노드들도 포함
  const connectedNodeIds = new Set([matchingNodeId]);
  connectedEdges.forEach(edge => {
    connectedNodeIds.add(edge.data.source);
    connectedNodeIds.add(edge.data.target);
  });
  
  // 검색된 노드와 연결된 모든 노드들 추가
  const allConnectedNodes = elements.filter(el => 
    !el.data.source && 
    connectedNodeIds.has(el.data.id)
  );

  const uniqueNodes = new Map();
  allConnectedNodes.forEach(node => {
    if (node?.data?.id !== undefined) {
      uniqueNodes.set(String(node.data.id), node);
    }
  });
  if (matchingNode?.data?.id !== undefined) {
    uniqueNodes.set(String(matchingNode.data.id), matchingNode);
  }

  const uniqueEdges = new Map();
  connectedEdges.forEach(edge => {
    if (edge?.data?.id !== undefined) {
      uniqueEdges.set(String(edge.data.id), edge);
    } else {
      uniqueEdges.set(`${edge.data.source}-${edge.data.target}`, edge);
    }
  });
  
    return [...uniqueNodes.values(), ...uniqueEdges.values()];
  } catch (error) {
    console.error('filterGraphElements 실패:', error, { 
      elementsLength: elements?.length, 
      searchTerm, 
      hasChapterData: !!currentChapterData 
    });
    return [];
  }
}

/**
 * 텍스트 하이라이트 렌더링 함수
 * @param {string} text - 원본 텍스트
 * @param {string} term - 하이라이트할 검색어
 * @param {Object} [highlightStyle] - 하이라이트 스타일
 * @returns {Array} JSX 요소 배열
 */
export function highlightText(text, term, highlightStyle = { fontWeight: 'bold', color: '#5C6F5C' }) {
  if (!text || typeof text !== 'string') {
    console.warn('highlightText: 유효하지 않은 텍스트입니다', { text, type: typeof text });
    return [<span key="0">{text || ''}</span>];
  }
  
  if (!term || typeof term !== 'string') {
    return [<span key="0">{text}</span>];
  }
  
  try {
    const parts = highlightParts(text, term);
    return parts.map((part, index) =>
      part.toLowerCase && term && part.toLowerCase() === term.toLowerCase() ? (
        <span key={index} style={highlightStyle}>{part}</span>
      ) : (
        <span key={index}>{part}</span>
      )
    );
  } catch (error) {
    console.error('highlightText 실패:', error, { text, term });
    return [<span key="0">{text}</span>];
  }
}

/**
 * 검색된 요소들의 ID 집합을 생성
 * @param {Array} filteredElements - 검색 결과 요소들
 * @returns {Set} 검색된 요소들의 ID 집합
 */
export function createFilteredElementIds(filteredElements) {
  if (!Array.isArray(filteredElements) || filteredElements.length === 0) {
    return new Set();
  }
  
  try {
    const filteredElementIds = new Set();
    
    filteredElements.forEach(element => {
      if (!element?.data) {
        console.warn('createFilteredElementIds: 유효하지 않은 요소입니다', { element });
        return;
      }
      
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
  } catch (error) {
    console.error('createFilteredElementIds 실패:', error, { 
      filteredElementsLength: filteredElements?.length 
    });
    return new Set();
  }
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
  if (!cy || typeof cy.elements !== 'function') {
    console.warn('applySearchFadeEffect: 유효하지 않은 Cytoscape 인스턴스입니다', { cy });
    return {
      fadedNodes: 0,
      visibleNodes: 0,
      fadedEdges: 0,
      visibleEdges: 0,
      cleanup: () => {}
    };
  }
  
  try {
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
        cleanup: () => {}
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
        cleanup: () => {}
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
        cy.elements().forEach(element => {
          element.removeClass("faded highlighted");
          element.style('opacity', '');
          element.style('text-opacity', '');
        });
      }
    };
    return result;
  } catch (error) {
    console.error('applySearchFadeEffect 실패:', error, { 
      isSearchActive, 
      filteredElementsLength: filteredElements?.length 
    });
    return {
      fadedNodes: 0,
      visibleNodes: 0,
      fadedEdges: 0,
      visibleEdges: 0,
      cleanup: () => {}
    };
  }
}

/**
 * 검색 상태에서 노드 클릭 시 하이라이트 효과 적용
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Object} clickedNode - 클릭된 노드
 * @param {Array} filteredElements - 검색 결과 요소들
 * @param {Object} options - 하이라이트 옵션
 * @returns {Object} 하이라이트 적용 결과 및 cleanup 함수
 */
export function applySearchHighlight(cy, clickedNode, filteredElements) {
  if (!cy || typeof cy.elements !== 'function') {
    console.warn('applySearchHighlight: 유효하지 않은 Cytoscape 인스턴스입니다', { cy });
    return {
      success: false,
      cleanup: () => {}
    };
  }
  
  if (!clickedNode || typeof clickedNode.id !== 'function') {
    console.warn('applySearchHighlight: 유효하지 않은 클릭된 노드입니다', { clickedNode });
    return {
      success: false,
      cleanup: () => {}
    };
  }
  
  if (!Array.isArray(filteredElements) || filteredElements.length === 0) {
    return {
      success: false,
      cleanup: () => {}
    };
  }
  
  try {
    const filteredElementIds = createFilteredElementIds(filteredElements);
    if (!filteredElementIds || filteredElementIds.size === 0) {
      return {
        success: false,
        cleanup: () => {}
      };
    }

    const clickedNodeId = clickedNode.id();
    const highlightedNodeIds = new Set();
    const highlightedEdgeIds = new Set();

    if (filteredElementIds.has(clickedNodeId)) {
      const connectedEdges = clickedNode.connectedEdges();
      highlightedNodeIds.add(clickedNodeId);

      connectedEdges.forEach(edge => {
        const edgeData = edge.data();
        const sourceId = edgeData.source;
        const targetId = edgeData.target;
        
        if (filteredElementIds.has(sourceId) && filteredElementIds.has(targetId)) {
          highlightedEdgeIds.add(edge.id());
          highlightedNodeIds.add(sourceId);
          highlightedNodeIds.add(targetId);
        }
      });
    } else {
      filteredElementIds.forEach(elementId => {
        const element = cy.getElementById(elementId);
        if (element.length > 0 && !element.data().source) {
          highlightedNodeIds.add(elementId);
          
          const connectedEdges = element.connectedEdges();
          connectedEdges.forEach(edge => {
            const edgeData = edge.data();
            if (filteredElementIds.has(edgeData.source) && filteredElementIds.has(edgeData.target)) {
              highlightedEdgeIds.add(edge.id());
            }
          });
        }
      });
    }

    const toCollection = (idSet) => {
      if (!idSet || idSet.size === 0) {
        return cy.collection();
      }
      const elements = [];
      idSet.forEach((rawId) => {
        if (!rawId && rawId !== 0) return;
        const id = String(rawId);
        const element = cy.getElementById(id);
        if (element && element.length > 0) {
          elements.push(element);
        }
      });
      return elements.length ? cy.collection(elements) : cy.collection();
    };

    const highlightedNodes = highlightedNodeIds.size > 0 ? toCollection(highlightedNodeIds) : cy.collection();
    const highlightedEdges = highlightedEdgeIds.size > 0 ? toCollection(highlightedEdgeIds) : cy.collection();

    const cyNodes = cy.nodes();
    const cyEdges = cy.edges();

    cy.batch(() => {
      cyNodes.removeClass("highlighted faded");
      cyEdges.removeClass("highlighted faded");

      highlightedNodes.addClass("highlighted");
      highlightedEdges.addClass("highlighted");

      cyNodes.difference(highlightedNodes).addClass("faded");
      cyEdges.difference(highlightedEdges).addClass("faded");
    });

    try {
      cy.style().update();
    } catch {}

    return {
      success: true,
      highlightedCount: highlightedNodeIds.size + highlightedEdgeIds.size,
      cleanup: () => {
        cy.batch(() => {
          cyNodes.removeClass("highlighted faded");
          cyEdges.removeClass("highlighted faded");
        });
        try {
          cy.style().update();
        } catch {}
      }
    };
  } catch (error) {
    console.error('applySearchHighlight 실패:', error, { 
      filteredElementsLength: filteredElements?.length 
    });
    return {
      success: false,
      cleanup: () => {}
    };
  }
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
  if (typeof isSearchActive !== 'boolean') {
    console.warn('shouldShowNoSearchResults: isSearchActive이 boolean이 아닙니다', { isSearchActive });
    return false;
  }
  
  if (!searchTerm || typeof searchTerm !== 'string') {
    return false;
  }
  
  return isSearchActive && 
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
  if (!searchTerm || typeof searchTerm !== 'string') {
    console.warn('getNoSearchResultsMessage: 유효하지 않은 검색어입니다', { searchTerm, type: typeof searchTerm });
    return {
      title: "검색 결과가 없습니다",
      description: "검색어를 입력해주세요."
    };
  }
  
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
  try {
    regexCache.clear();
    console.info('regexCache 정리 완료');
  } catch (error) {
    console.error('clearRegexCache 실패:', error);
  }
}

/**
 * 모든 검색 관련 리소스 정리 함수
 * @param {Object} cy - Cytoscape 인스턴스 (선택사항)
 * @returns {void}
 */
export function cleanupSearchResources(cy = null) {
  try {
    clearRegexCache();
    
    // Cytoscape 인스턴스가 있는 경우 모든 효과 제거
    if (cy && typeof cy.elements === 'function') {
      cy.elements().forEach(element => {
        element.removeClass("faded highlighted");
        element.style('opacity', '');
        element.style('text-opacity', '');
      });
    }
    
    console.info('검색 관련 리소스 정리 완료');
  } catch (error) {
    console.error('cleanupSearchResources 실패:', error);
  }
}