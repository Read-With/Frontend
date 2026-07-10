/** 그래프 뷰: 검색·필터 파이프라인·사이드바 UI 상태 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { buildSuggestions, filterGraphElements } from '../../utils/graph/searchUtils.jsx';
import { filterMainCharacters } from '../../utils/graph/graphDataUtils';
import { determineFinalElements, sortElementsByDataId } from '../../utils/graph/graphUtils';

export function useGraphState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const [forceClose, setForceClose] = useState(false);
  const [filterStage, setFilterStage] = useState(0);
  const [isDropdownSelection, setIsDropdownSelection] = useState(false);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
  }, []);

  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible((prev) => !prev);
  }, []);

  const startClosing = useCallback(() => {
    setIsSidebarClosing(true);
  }, []);

  const closeSidebar = useCallback(() => {
    setActiveTooltip(null);
    setForceClose(false);
    setIsSidebarClosing(false);
  }, []);

  const setDropdownSelection = useCallback((value) => {
    setIsDropdownSelection(value);
  }, []);

  return {
    isSidebarOpen,
    edgeLabelVisible,
    activeTooltip,
    isSidebarClosing,
    forceClose,
    filterStage,
    isDropdownSelection,
    setActiveTooltip,
    setIsSidebarClosing,
    setForceClose,
    setFilterStage,
    toggleSidebar,
    toggleEdgeLabel,
    startClosing,
    closeSidebar,
    setDropdownSelection,
  };
}

export function useGraphElementPipeline({
  elements,
  filterStage,
  isSearchActive,
  filteredElements,
}) {
  const sortedElements = useMemo(
    () => sortElementsByDataId(elements),
    [elements]
  );

  const filteredMainCharacters = useMemo(
    () => filterMainCharacters(sortedElements, filterStage),
    [sortedElements, filterStage]
  );

  const finalElements = useMemo(
    () =>
      determineFinalElements(
        isSearchActive,
        filteredElements,
        sortedElements,
        filterStage,
        filteredMainCharacters
      ),
    [
      isSearchActive,
      filteredElements,
      sortedElements,
      filterStage,
      filteredMainCharacters,
    ]
  );

  return { sortedElements, filteredMainCharacters, finalElements };
}

export function useGraphSearch(elements, onSearchStateChange = null, currentChapterData = null) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredElements, setFilteredElements] = useState([]);
  const [fitNodeIds, setFitNodeIds] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isResetFromSearch, setIsResetFromSearch] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const onSearchStateChangeRef = useRef(onSearchStateChange);
  useEffect(() => {
    onSearchStateChangeRef.current = onSearchStateChange;
  }, [onSearchStateChange]);

  const elementsRef = useRef(elements);
  const currentChapterDataRef = useRef(currentChapterData);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    currentChapterDataRef.current = currentChapterData;
  }, [currentChapterData]);

  const handleSearchSubmit = useCallback((term) => {
    const trimmedTerm = term.trim();
    setSearchTerm(term);
    setIsSearchActive(!!trimmedTerm);
    setIsResetFromSearch(false);
    setShowSuggestions(false);

    const currentElements = elementsRef.current;
    const chapterData = currentChapterDataRef.current;

    if (trimmedTerm && currentElements) {
      const filtered = filterGraphElements(currentElements, trimmedTerm, chapterData);
      setFilteredElements(filtered || []);
      setFitNodeIds(filtered ? filtered.filter((el) => !el.data.source).map((el) => el.data.id) : []);
    } else {
      setFilteredElements(currentElements || []);
      setFitNodeIds([]);
      setIsSearchActive(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setFilteredElements([]);
    setFitNodeIds([]);
    setIsSearchActive(false);
    setSuggestions([]);
    setShowSuggestions(false);
    setSelectedIndex(-1);
    setIsResetFromSearch(true);
  }, []);

  useEffect(() => {
    const trimmedTerm = searchTerm.trim();
    if (trimmedTerm.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      return;
    }

    const matches = buildSuggestions(
      elementsRef.current,
      trimmedTerm,
      currentChapterDataRef.current
    );
    setSuggestions(matches);
    setShowSuggestions(matches.length > 0);
    setSelectedIndex(-1);
  }, [searchTerm]);

  useEffect(() => {
    if (isResetFromSearch) {
      const timer = setTimeout(() => {
        setIsResetFromSearch(false);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isResetFromSearch]);

  const handleKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'ArrowDown':
        if (showSuggestions && suggestions?.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
        }
        break;
      case 'ArrowUp':
        if (showSuggestions && suggestions?.length > 0) {
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
        }
        break;
      case 'Escape':
        if (showSuggestions) {
          setShowSuggestions(false);
          setSelectedIndex(-1);
        }
        break;
      default:
        break;
    }
  }, [showSuggestions, suggestions]);

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, []);

  const currentSearchState = useMemo(
    () => ({
      searchTerm,
      isSearchActive,
      filteredElements,
      fitNodeIds,
      suggestions,
      showSuggestions,
      selectedIndex,
    }),
    [searchTerm, isSearchActive, filteredElements, fitNodeIds, suggestions, showSuggestions, selectedIndex]
  );

  useEffect(() => {
    onSearchStateChangeRef.current?.(currentSearchState);
  }, [currentSearchState]);

  const searchFinalElements = useMemo(() => {
    return isSearchActive && filteredElements?.length > 0 ? filteredElements : (elements || []);
  }, [isSearchActive, filteredElements, elements]);

  const searchPanelState = useMemo(
    () => ({
      ...currentSearchState,
      isResetFromSearch,
    }),
    [currentSearchState, isResetFromSearch]
  );

  const searchState = useMemo(
    () => ({
      ...searchPanelState,
      elements: elements || [],
    }),
    [searchPanelState, elements]
  );

  const searchActions = useMemo(
    () => ({
      onSearchSubmit: handleSearchSubmit,
      clearSearch,
      closeSuggestions,
      onGenerateSuggestions: setSearchTerm,
      handleKeyDown,
    }),
    [handleSearchSubmit, clearSearch, closeSuggestions, setSearchTerm, handleKeyDown]
  );

  return {
    searchTerm,
    isSearchActive,
    filteredElements,
    fitNodeIds,
    finalElements: searchFinalElements,
    isResetFromSearch,
    searchPanelState,
    searchState,
    searchActions,
    handleSearchSubmit,
    clearSearch,
    setSearchTerm,
    setIsSearchActive,
    suggestions,
    showSuggestions,
    selectedIndex,
    handleKeyDown,
    closeSuggestions,
    setShowSuggestions,
    setSelectedIndex,
  };
}
