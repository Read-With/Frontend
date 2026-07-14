/** 그래프 노드 검색·필터·페이드 */

import { isGraphEdgeElement, isGraphNodeElement, uniqueStrings, clearHighlightClassesOn } from './graphUtils';
import { expandConnectedSubgraph } from './graphDataUtils';

const buildChapterCharacterIdSet = (currentChapterData) => {
  if (!currentChapterData?.characters?.length) return null;
  return new Set(currentChapterData.characters.map(char => String(char.id)));
};

function filterNodesByChapter(nodes, currentChapterData) {
  const chapterCharacterIds = buildChapterCharacterIdSet(currentChapterData);
  if (!chapterCharacterIds) return nodes;
  return nodes.filter((node) => {
    const nodeId = node?.data?.id;
    if (nodeId === undefined || nodeId === null) return false;
    return chapterCharacterIds.has(String(nodeId));
  });
}

function getNodeMatchType(node, searchLower) {
  if (!node?.data || typeof searchLower !== 'string') return null;
  try {
    const label = String(node.data.label || '').toLowerCase();
    if (label.includes(searchLower)) return 'label';
    const names = Array.isArray(node.data.names) ? node.data.names : [];
    if (names.some((name) => String(name).toLowerCase().includes(searchLower))) return 'names';
    const commonName = String(node.data.common_name || '').toLowerCase();
    if (commonName.includes(searchLower)) return 'common_name';
    return null;
  } catch (error) {
    console.error('getNodeMatchType 실패:', error, { node, searchLower });
    return null;
  }
}

function nodeMatchesQuery(node, searchLower) {
  return getNodeMatchType(node, searchLower) !== null;
}

function nodeExactMatchesQuery(nodeOrSuggestion, searchLower) {
  const label = nodeOrSuggestion?.data?.label ?? nodeOrSuggestion?.label;
  const commonName = nodeOrSuggestion?.data?.common_name ?? nodeOrSuggestion?.common_name;
  const names = nodeOrSuggestion?.data?.names ?? nodeOrSuggestion?.names ?? [];
  return (
    String(label || '').toLowerCase() === searchLower ||
    String(commonName || '').toLowerCase() === searchLower ||
    (Array.isArray(names) && names.some((name) => String(name).toLowerCase() === searchLower))
  );
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
    const filteredNodes = filterNodesByChapter(
      elements.filter(isGraphNodeElement),
      currentChapterData
    );

    const matches = filteredNodes
    .map(node => {
      const matchType = getNodeMatchType(node, searchLower);
      if (!matchType) return null;

      const names = node.data.names || [];
      const uniqueNames = uniqueStrings(names, { caseInsensitive: true });
      
      return {
        id: node.data.id,
        label: node.data.label,
        names: uniqueNames,
        common_name: node.data.common_name,
        matchType
      };
    })
    .filter(Boolean)
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
        existing.names = uniqueStrings(
          [...(existing.names || []), ...(current.names || [])],
          { caseInsensitive: true }
        );
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
 * 제안 목록에서 검색어와 대소문자 무시 완전 일치 항목
 * @param {Array} suggestions
 * @param {string} trimmedTerm 공백 제거된 검색어
 */
export function findExactSuggestionMatch(suggestions, trimmedTerm) {
  if (!Array.isArray(suggestions) || !trimmedTerm) return undefined;
  const t = trimmedTerm.toLowerCase();
  return suggestions.find((suggestion) => nodeExactMatchesQuery(suggestion, t));
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
    const candidateNodes = filterNodesByChapter(
      elements.filter((el) => isGraphNodeElement(el) && nodeMatchesQuery(el, searchLower)),
      currentChapterData
    );
    
    // 정확히 일치하는 인물을 우선적으로 찾기
    let matchingNode = candidateNodes.find((node) => nodeExactMatchesQuery(node, searchLower));
    
    // 완전 일치가 없으면 첫 번째 매칭 선택
    if (!matchingNode && candidateNodes.length > 0) {
      matchingNode = candidateNodes[0];
    }
  
  // 매칭된 인물이 없으면 빈 결과 반환
  if (!matchingNode) {
    return [];
  }

  return expandConnectedSubgraph(elements, new Set([matchingNode.data.id]), {
    seedEdgeMode: 'any',
    includeIsolatedSeeds: true,
  });
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
 * 검색된 요소들의 ID 집합을 생성
 * @param {Array} filteredElements - 검색 결과 요소들
 * @returns {{ nodeIds: Set, edgeIds: Set }} 검색된 요소들의 ID 집합
 */
function createFilteredElementIds(filteredElements) {
  if (!Array.isArray(filteredElements) || filteredElements.length === 0) {
    return { nodeIds: new Set(), edgeIds: new Set() };
  }
  
  try {
    const nodeIds = new Set();
    const edgeIds = new Set();
    
    filteredElements.forEach(element => {
      if (!element?.data) {
        console.warn('createFilteredElementIds: 유효하지 않은 요소입니다', { element });
        return;
      }
      
      if (isGraphEdgeElement(element)) {
        // 간선인 경우
        if (element.data.source != null) nodeIds.add(String(element.data.source));
        if (element.data.target != null) nodeIds.add(String(element.data.target));
        if (element.data.id != null) edgeIds.add(String(element.data.id));
      } else {
        // 노드인 경우
        if (element.data.id != null) nodeIds.add(String(element.data.id));
      }
    });
    
    return { nodeIds, edgeIds };
  } catch (error) {
    console.error('createFilteredElementIds 실패:', error, { 
      filteredElementsLength: filteredElements?.length 
    });
    return { nodeIds: new Set(), edgeIds: new Set() };
  }
}

/**
 * 검색 결과에 따라 그래프 요소들에 페이드 효과 적용
 * @param {Object} cy - Cytoscape 인스턴스
 * @param {Array} filteredElements - 검색 결과 요소들
 */
export function applySearchFadeEffect(cy, filteredElements) {
  if (!cy || typeof cy.elements !== 'function') {
    console.warn('applySearchFadeEffect: 유효하지 않은 Cytoscape 인스턴스입니다', { cy });
    return;
  }
  
  try {
    clearHighlightClassesOn(cy);

    // 검색 활성 + 결과 없음 → 전체 페이드 (결과 없음 UI와 맞춤)
    if (!filteredElements || filteredElements.length === 0) {
      cy.batch(() => {
        cy.nodes().forEach((node) => {
          node.addClass('faded');
        });
        cy.edges().forEach((edge) => {
          edge.addClass('faded');
        });
      });
      return;
    }

    // 검색 결과에 포함된 요소들의 ID 집합 생성
    const { nodeIds: filteredNodeIds, edgeIds: filteredEdgeIds } = createFilteredElementIds(filteredElements);

    cy.batch(() => {
      cy.nodes().forEach(node => {
        if (!filteredNodeIds.has(String(node.id()))) {
          node.addClass("faded");
        }
      });

      cy.edges().forEach(edge => {
        if (!filteredEdgeIds.has(String(edge.id()))) {
          edge.addClass("faded");
        }
      });
    });
  } catch (error) {
    console.error('applySearchFadeEffect 실패:', error, { 
      filteredElementsLength: filteredElements?.length 
    });
  }
}

/**
 * 통일된 검색 결과 없음 조건 확인
 * @param {boolean} isSearchActive - 검색 활성 상태
 * @param {string} searchTerm - 검색어
 * @param {Array} fitNodeIds - 검색된 노드 ID 배열
 * @returns {boolean} 검색 결과 없음 여부
 */
export function shouldShowNoSearchResults(isSearchActive, searchTerm, fitNodeIds = []) {
  if (typeof isSearchActive !== 'boolean') {
    console.warn('shouldShowNoSearchResults: isSearchActive이 boolean이 아닙니다', { isSearchActive });
    return false;
  }
  
  if (!searchTerm || typeof searchTerm !== 'string') {
    return false;
  }
  
  return isSearchActive && 
         searchTerm.trim().length > 0 &&
         (!fitNodeIds || fitNodeIds.length === 0);
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
