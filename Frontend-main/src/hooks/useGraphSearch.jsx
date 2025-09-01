// [ 통합 검색/필터링 유틸리티 함수들 ]
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { 
  buildSuggestions, 
  filterGraphElements
} from '../utils/searchUtils.jsx';

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
  const [isResetFromSearch, setIsResetFromSearch] = useState(false);

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
    const trimmedTerm = searchTerm.trim();
    setSearchTerm(searchTerm);
    setIsSearchActive(!!trimmedTerm);
    setIsResetFromSearch(false); // 검색 시 초기화 상태 해제
    
    if (trimmedTerm && elements) {
      const filtered = filterGraphElements(elements, trimmedTerm, currentChapterData);
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
    setFilteredElements([]);
    setFitNodeIds([]);
    setIsSearchActive(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    setIsResetFromSearch(true); // 초기화 상태 설정
  }, []);

  // 검색 제안 생성 (2글자 이상일 때만)
  useEffect(() => {
    const trimmedTerm = searchTerm.trim();
    if (trimmedTerm.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      return;
    }
    
    const matches = buildSuggestions(elements, trimmedTerm, currentChapterData);
    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
    setSelectedIndex(-1);
  }, [searchTerm, elements, currentChapterData]);

  // isResetFromSearch 상태 자동 초기화
  useEffect(() => {
    if (isResetFromSearch) {
      const timer = setTimeout(() => {
        setIsResetFromSearch(false);
      }, 500); // 500ms 후 초기화 상태 해제
      
      return () => clearTimeout(timer);
    }
  }, [isResetFromSearch]);

  // 제안 선택 함수
  const selectSuggestion = useCallback((suggestion, onSelect) => {
    if (onSelect && suggestion?.label) {
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

  // 현재 검색 상태 메모이제이션
  const currentSearchState = useMemo(() => ({
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds
  }), [searchTerm, isSearchActive, filteredElements, fitNodeIds]);

  // 검색 상태가 변경될 때 상위로 전달
  useEffect(() => {
    if (onSearchStateChangeRef.current) {
      onSearchStateChangeRef.current(currentSearchState);
    }
  }, [currentSearchState]);

  // 최종 요소 계산 메모이제이션
  const finalElements = useMemo(() => {
    return isSearchActive && filteredElements && filteredElements.length > 0 
      ? filteredElements 
      : (elements || []);
  }, [isSearchActive, filteredElements, elements]);

  return {
    // 검색 상태
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    finalElements,
    isResetFromSearch,
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


