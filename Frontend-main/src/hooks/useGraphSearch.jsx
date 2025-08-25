// [ 통합 검색/필터링 유틸리티 함수들 ]
import { useState, useEffect, useCallback, useRef } from 'react';

// 텍스트에서 검색어 부분만 분리해 하이라이트 가능하게 함
function highlightParts(text, query) {
  if (!query || !text) return [text];
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  return String(text).split(regex).filter(Boolean);
}

// 검색어에 특수문자가 있어도 정규식 안전 처리
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 노드가 검색어와 매칭되는지 확인
function nodeMatchesQuery(node, searchLower) {
  if (!node || !node.data) return false;
  const label = node.data.label?.toLowerCase() || '';
  const names = node.data.names || [];
  const commonName = node.data.common_name?.toLowerCase() || '';
  return (
    label.includes(searchLower) ||
    names.some(name => String(name).toLowerCase().includes(searchLower)) ||
    commonName.includes(searchLower)
  );
}

// 입력된 검색어와 관련된 노드(인물 등)를 찾아 최대 8개 추천 리스트 생성
function buildSuggestions(elements, query, currentChapterData = null) {
  const trimmed = (query ?? '').trim();
  if (trimmed.length < 2) return [];
  const searchLower = trimmed.toLowerCase();
  const characterNodes = Array.isArray(elements) ? elements.filter(el => !el.data.source) : [];

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
function filterGraphElements(elements, searchTerm, currentChapterData = null) {
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
 * 통합 그래프 검색 및 제안 관리 훅
 * @param {Array} elements - 그래프 요소들
 * @param {Function} onSearchStateChange - 검색 상태 변경 콜백 (선택사항)
 * @param {Object} currentChapterData - 현재 챕터의 캐릭터 데이터 (선택사항)
 * @returns {Object} 검색 관련 상태와 함수들
 */
export function useGraphSearch(elements, onSearchStateChange = null, currentChapterData = null) {
  // 검색 상태
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredElements, setFilteredElements] = useState([]);
  const [fitNodeIds, setFitNodeIds] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);

  // 검색 제안 상태
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // onSearchStateChange 콜백을 useRef로 안정화
  const onSearchStateChangeRef = useRef(onSearchStateChange);
  useEffect(() => {
    onSearchStateChangeRef.current = onSearchStateChange;
  }, [onSearchStateChange]);

  // 검색 처리 함수
  const handleSearchSubmit = useCallback((searchTerm) => {
    console.log('🔍 검색 요청:', searchTerm);
    setSearchTerm(searchTerm);
    setIsSearchActive(!!searchTerm.trim());
    
    if (searchTerm.trim() && elements) {
      const filtered = filterGraphElements(elements, searchTerm, currentChapterData);
      console.log('📊 검색 결과:', { 
        searchTerm, 
        totalElements: elements.length, 
        filteredElements: filtered?.length || 0,
        fitNodeIds: filtered ? filtered.filter(el => !el.data.source).length : 0
      });
      setFilteredElements(filtered || []);
      setFitNodeIds(filtered ? filtered.filter(el => !el.data.source).map(el => el.data.id) : []);
    } else {
      setFilteredElements(elements || []);
      setFitNodeIds([]);
      setIsSearchActive(false);
    }
  }, [elements, currentChapterData]);

  // 검색 초기화 함수
  const clearSearch = useCallback(() => {
    console.log('🔄 검색 초기화 요청');
    setSearchTerm("");
    setFilteredElements([]);
    setFitNodeIds([]);
    setIsSearchActive(false);
  }, []);

  // 검색 제안 생성 (2글자 이상일 때만)
  useEffect(() => {
    const matches = buildSuggestions(elements, searchTerm, currentChapterData);
    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
    setSelectedIndex(-1);
  }, [searchTerm, elements, currentChapterData]);

  // 제안 선택 함수
  const selectSuggestion = useCallback((suggestion, onSelect) => {
    if (onSelect) {
      onSelect(suggestion.label);
    }
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, []);

  // 키보드 네비게이션 처리
  const handleKeyDown = useCallback((e, onSelect) => {
    switch (e.key) {
      case 'ArrowDown':
        if (showSuggestions && suggestions && suggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        }
        break;
      case 'ArrowUp':
        if (showSuggestions && suggestions && suggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (showSuggestions && selectedIndex >= 0 && suggestions && suggestions[selectedIndex]) {
          selectSuggestion(suggestions[selectedIndex], onSelect);
        } else if (onSelect) {
          onSelect(searchTerm);
        }
        break;
      case 'Escape':
        if (showSuggestions) {
          setShowSuggestions(false);
          setSelectedIndex(-1);
        }
        break;
    }
  }, [showSuggestions, suggestions, selectedIndex, searchTerm, selectSuggestion]);

  // 드롭다운 닫기
  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, []);

  // 검색 상태가 변경될 때 상위로 전달
  useEffect(() => {
    if (onSearchStateChangeRef.current) {
      const currentState = {
        searchTerm,
        isSearchActive,
        filteredElements,
        fitNodeIds
      };
      
      // 이전 상태와 비교하여 실제로 변경되었을 때만 콜백 호출
      onSearchStateChangeRef.current(currentState);
    }
  }, [searchTerm, isSearchActive, filteredElements, fitNodeIds]);

  const finalElements = isSearchActive && filteredElements && filteredElements.length > 0 ? filteredElements : (elements || []);

  return {
    // 검색 상태
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    finalElements,
    handleSearchSubmit,
    clearSearch,
    setSearchTerm,
    setIsSearchActive,
    
    // 검색 제안 상태
    suggestions,
    showSuggestions,
    selectedIndex,
    selectSuggestion,
    handleKeyDown,
    closeSuggestions,
    setShowSuggestions,
    setSelectedIndex
  };
}
