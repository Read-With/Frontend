import { useState, useEffect, useCallback } from 'react';
import { filterGraphElements } from '../utils/search.jsx';

/**
 * 그래프 검색 상태 관리 훅
 * @param {Array} elements - 그래프 요소들
 * @param {Function} onSearchStateChange - 검색 상태 변경 콜백 (선택사항)
 * @returns {Object} 검색 관련 상태와 함수들
 */
export function useGraphSearch(elements, onSearchStateChange = null) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filteredElements, setFilteredElements] = useState([]);
  const [fitNodeIds, setFitNodeIds] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);

  // 검색 처리 함수
  const handleSearchSubmit = useCallback((searchTerm) => {
    setSearchTerm(searchTerm);
    setIsSearchActive(!!searchTerm.trim());
    
    if (searchTerm.trim()) {
      const { filteredElements: filtered, fitNodeIds: fitIds } = filterGraphElements(elements, searchTerm, null);
      setFilteredElements(filtered);
      setFitNodeIds(fitIds);
    } else {
      setFilteredElements(elements);
      setFitNodeIds([]);
      setIsSearchActive(false);
    }
  }, [elements]);

  // 검색 초기화 함수
  const clearSearch = useCallback(() => {
    setSearchTerm("");
    setFilteredElements(elements);
    setFitNodeIds([]);
    setIsSearchActive(false);
  }, [elements]);

  // elements가 변경될 때 검색 결과도 업데이트
  useEffect(() => {
    if (isSearchActive && searchTerm.trim()) {
      const { filteredElements: filtered, fitNodeIds: fitIds } = filterGraphElements(elements, searchTerm, null);
      if (filtered.length > 0) {
        setFilteredElements(filtered);
        setFitNodeIds(fitIds);
      } else {
        setFilteredElements(elements);
        setFitNodeIds([]);
      }
    } else if (!isSearchActive) {
      setFilteredElements(elements);
    }
  }, [elements, isSearchActive, searchTerm]);

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

  const finalElements = isSearchActive && filteredElements.length > 0 ? filteredElements : elements;

  return {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    finalElements,
    handleSearchSubmit,
    clearSearch,
    setSearchTerm,
    setIsSearchActive
  };
}
