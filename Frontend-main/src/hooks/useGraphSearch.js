import { useState, useEffect, useCallback } from 'react';
import { filterGraphElements, buildSuggestions } from '../utils/search.jsx';

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

  // 검색 처리 함수
  const handleSearchSubmit = useCallback((searchTerm) => {
    setSearchTerm(searchTerm);
    setIsSearchActive(!!searchTerm.trim());
    
    if (searchTerm.trim() && elements) {
      const filtered = filterGraphElements(elements, searchTerm, currentChapterData);
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
    setSearchTerm("");
    setFilteredElements(elements || []);
    setFitNodeIds([]);
    setIsSearchActive(false);
  }, [elements]);

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

  // elements가 변경될 때 검색 결과도 업데이트
  useEffect(() => {
    if (isSearchActive && searchTerm.trim() && elements) {
      const filtered = filterGraphElements(elements, searchTerm, currentChapterData);
      if (filtered && filtered.length > 0) {
        setFilteredElements(filtered);
        setFitNodeIds(filtered.filter(el => !el.data.source).map(el => el.data.id));
      } else {
        setFilteredElements(elements);
        setFitNodeIds([]);
      }
    } else if (!isSearchActive) {
      setFilteredElements(elements || []);
    }
  }, [elements, isSearchActive, searchTerm, currentChapterData]);

  // 검색 상태가 변경될 때 상위로 전달
  useEffect(() => {
    if (onSearchStateChange) {
      onSearchStateChange({
        searchTerm,
        isSearchActive,
        filteredElements,
        fitNodeIds
      });
    }
  }, [searchTerm, isSearchActive, filteredElements, fitNodeIds, onSearchStateChange]);

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
