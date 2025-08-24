import { useState, useEffect, useCallback } from 'react';
import { buildSuggestions } from '../utils/search.jsx';

/**
 * 검색 제안 관리 훅
 * @param {Array} elements - 그래프 요소들
 * @param {string} searchInput - 검색 입력값
 * @returns {Object} 검색 제안 관련 상태와 함수들
 */
export function useSearchSuggestions(elements, searchInput) {
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  // 검색 제안 생성 (2글자 이상일 때만)
  useEffect(() => {
    const matches = buildSuggestions(elements, searchInput);
    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
    setSelectedIndex(-1);
  }, [searchInput, elements]);

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
        if (showSuggestions) {
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        }
        break;
      case 'ArrowUp':
        if (showSuggestions) {
          e.preventDefault();
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (showSuggestions && selectedIndex >= 0 && suggestions[selectedIndex]) {
          selectSuggestion(suggestions[selectedIndex], onSelect);
        } else if (onSelect) {
          onSelect(searchInput);
        }
        break;
      case 'Escape':
        if (showSuggestions) {
          setShowSuggestions(false);
          setSelectedIndex(-1);
        }
        break;
    }
  }, [showSuggestions, suggestions, selectedIndex, searchInput, selectSuggestion]);

  // 드롭다운 닫기
  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, []);

  return {
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
