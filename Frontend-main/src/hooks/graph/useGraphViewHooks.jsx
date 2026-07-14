/** 그래프 뷰: 검색·필터 파이프라인·사이드바 UI 상태 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { buildSuggestions, filterGraphElements } from '../../utils/graph/searchUtils.js';
import { filterMainCharacters } from '../../utils/graph/graphDataUtils';
import { sortElementsByDataId, isGraphNodeElement } from '../../utils/graph/graphUtils';

export function useGraphState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const [filterStage, setFilterStage] = useState(0);

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
    setIsSidebarClosing(false);
  }, []);

  return {
    isSidebarOpen,
    edgeLabelVisible,
    activeTooltip,
    isSidebarClosing,
    filterStage,
    setActiveTooltip,
    setIsSidebarClosing,
    setFilterStage,
    toggleSidebar,
    toggleEdgeLabel,
    startClosing,
    closeSidebar,
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

  const finalElements = useMemo(() => {
    if (isSearchActive) {
      return filteredElements ?? [];
    }
    if (filterStage > 0) {
      return filteredMainCharacters;
    }
    return sortedElements;
  }, [
    isSearchActive,
    filteredElements,
    sortedElements,
    filterStage,
    filteredMainCharacters,
  ]);

  return { filteredMainCharacters, finalElements };
}

export function useGraphSearch(elements, currentChapterData = null) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredElements, setFilteredElements] = useState([]);
  const [fitNodeIds, setFitNodeIds] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isResetFromSearch, setIsResetFromSearch] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const suppressSuggestionsRef = useRef(false);

  const elementsRef = useRef(elements);
  const currentChapterDataRef = useRef(currentChapterData);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    currentChapterDataRef.current = currentChapterData;
  }, [currentChapterData]);

  useEffect(() => {
    if (!isSearchActive) return;
    const trimmedTerm = searchTerm.trim();
    if (!trimmedTerm) return;

    const filtered = filterGraphElements(
      elements,
      trimmedTerm,
      currentChapterDataRef.current
    );
    setFilteredElements(filtered || []);
    setFitNodeIds(
      filtered
        ? filtered
            .filter((el) => isGraphNodeElement(el) && el.data.id != null)
            .map((el) => String(el.data.id))
        : []
    );
  }, [elements, isSearchActive, searchTerm]);

  const handleSearchSubmit = useCallback((term) => {
    const trimmedTerm = term.trim();
    suppressSuggestionsRef.current = true;
    setSearchTerm(term);
    setIsSearchActive(!!trimmedTerm);
    setIsResetFromSearch(false);
    setShowSuggestions(false);
    setSelectedIndex(-1);

    const currentElements = elementsRef.current;
    const chapterData = currentChapterDataRef.current;

    if (trimmedTerm && currentElements) {
      const filtered = filterGraphElements(currentElements, trimmedTerm, chapterData);
      setFilteredElements(filtered || []);
      setFitNodeIds(
        filtered
          ? filtered
              .filter((el) => isGraphNodeElement(el) && el.data.id != null)
              .map((el) => String(el.data.id))
          : []
      );
    } else {
      setFilteredElements(currentElements || []);
      setFitNodeIds([]);
      setIsSearchActive(false);
    }
  }, []);

  const clearSearch = useCallback(() => {
    suppressSuggestionsRef.current = false;
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
      elements,
      trimmedTerm,
      currentChapterDataRef.current
    );
    setSuggestions(matches);
    setSelectedIndex(-1);

    if (suppressSuggestionsRef.current) {
      suppressSuggestionsRef.current = false;
      setShowSuggestions(false);
      return;
    }

    setShowSuggestions(true);
  }, [searchTerm, elements]);

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

  const onGenerateSuggestions = useCallback((term) => {
    suppressSuggestionsRef.current = false;
    setSearchTerm(term);
    if (term.trim().length >= 2) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
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
      isResetFromSearch,
    }),
    [searchTerm, isSearchActive, filteredElements, fitNodeIds, suggestions, showSuggestions, selectedIndex, isResetFromSearch]
  );

  const searchActions = useMemo(
    () => ({
      onSearchSubmit: handleSearchSubmit,
      clearSearch,
      closeSuggestions,
      onGenerateSuggestions,
      handleKeyDown,
      onSelectedIndexChange: setSelectedIndex,
    }),
    [handleSearchSubmit, clearSearch, closeSuggestions, onGenerateSuggestions, handleKeyDown]
  );

  return {
    searchState: currentSearchState,
    searchActions,
  };
}
