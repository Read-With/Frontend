/** 그래프 뷰: 검색·필터 파이프라인·사이드바 UI 상태 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { buildSuggestions, filterGraphElements } from '../../utils/graph/searchUtils.js';
import { filterMainCharacters } from '../../utils/graph/graphDataUtils';
import { sortElementsByDataId, isGraphNodeElement } from '../../utils/graph/graphUtils';

/** CytoscapeGraphUnified: clear 직후 ripple 억제 구간과 맞춤 */
export const SEARCH_RESET_FLAG_MS = 500;

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

  const cancelClosing = useCallback(() => {
    setIsSidebarClosing(false);
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
    setFilterStage,
    toggleSidebar,
    toggleEdgeLabel,
    startClosing,
    cancelClosing,
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
    () => (filterStage > 0 ? filterMainCharacters(sortedElements, filterStage) : sortedElements),
    [sortedElements, filterStage]
  );

  const finalElements = useMemo(() => {
    if (isSearchActive) return filteredElements ?? [];
    if (filterStage > 0) return filteredMainCharacters;
    return sortedElements;
  }, [isSearchActive, filteredElements, sortedElements, filterStage, filteredMainCharacters]);

  return { filteredMainCharacters, finalElements };
}

export function useGraphSearch(elements, currentChapterData = null) {
  const [searchTerm, setSearchTerm] = useState('');
  const [filteredElements, setFilteredElements] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [isResetFromSearch, setIsResetFromSearch] = useState(false);

  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  /** submit 직후 suggestions effect가 드롭다운을 다시 열지 않음 */
  const suppressSuggestionsRef = useRef(false);

  const elementsRef = useRef(elements);
  const currentChapterDataRef = useRef(currentChapterData);
  const skipFilterEffectRef = useRef(false);

  const fitNodeIds = useMemo(() => {
    if (!isSearchActive || !filteredElements?.length) return [];
    return filteredElements
      .filter((el) => isGraphNodeElement(el) && el.data.id != null)
      .map((el) => String(el.data.id));
  }, [isSearchActive, filteredElements]);

  const applySearchFilter = useCallback((sourceElements, term, chapterData) => {
    const trimmedTerm = typeof term === 'string' ? term.trim() : '';
    if (!trimmedTerm || !sourceElements) {
      setFilteredElements([]);
      return false;
    }
    const filtered = filterGraphElements(sourceElements, trimmedTerm, chapterData);
    setFilteredElements(filtered || []);
    return true;
  }, []);

  useEffect(() => {
    elementsRef.current = elements;
    currentChapterDataRef.current = currentChapterData;
  }, [elements, currentChapterData]);

  useEffect(() => {
    if (!isSearchActive) return;
    const trimmedTerm = searchTerm.trim();
    if (!trimmedTerm) return;
    if (skipFilterEffectRef.current) {
      skipFilterEffectRef.current = false;
      return;
    }
    applySearchFilter(elements, trimmedTerm, currentChapterDataRef.current);
  }, [elements, isSearchActive, searchTerm, applySearchFilter]);

  const handleSearchSubmit = useCallback((term) => {
    const trimmedTerm = term.trim();
    suppressSuggestionsRef.current = true;
    skipFilterEffectRef.current = true;
    setSearchTerm(term);
    setIsSearchActive(!!trimmedTerm);
    setIsResetFromSearch(false);
    setShowSuggestions(false);
    setSelectedIndex(-1);

    const applied = applySearchFilter(
      elementsRef.current,
      trimmedTerm,
      currentChapterDataRef.current
    );
    if (!applied) {
      skipFilterEffectRef.current = false;
      setIsSearchActive(false);
    }
  }, [applySearchFilter]);

  const clearSearch = useCallback(() => {
    suppressSuggestionsRef.current = false;
    setSearchTerm('');
    setFilteredElements([]);
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
    if (!isResetFromSearch) return undefined;
    const timer = setTimeout(() => {
      setIsResetFromSearch(false);
    }, SEARCH_RESET_FLAG_MS);
    return () => clearTimeout(timer);
  }, [isResetFromSearch]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (showSuggestions) {
        setShowSuggestions(false);
        setSelectedIndex(-1);
      }
      return;
    }

    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || !showSuggestions || !(suggestions?.length > 0)) {
      return;
    }

    e.preventDefault();
    const len = suggestions.length;
    const dir = e.key === 'ArrowDown' ? 1 : -1;
    setSelectedIndex((prev) => {
      if (prev < 0) return dir > 0 ? 0 : len - 1;
      return (prev + dir + len) % len;
    });
  }, [showSuggestions, suggestions]);

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, []);

  /** 입력 중 검색어·제안 표시 (필터 submit은 onSearchSubmit) */
  const onSearchTermChange = useCallback((term) => {
    suppressSuggestionsRef.current = false;
    setSearchTerm(term);
    if (term.trim().length >= 2) {
      setShowSuggestions(true);
    } else {
      setShowSuggestions(false);
      setSelectedIndex(-1);
    }
  }, []);

  const searchActions = useMemo(
    () => ({
      onSearchSubmit: handleSearchSubmit,
      clearSearch,
      closeSuggestions,
      onSearchTermChange,
      onGenerateSuggestions: onSearchTermChange,
      handleKeyDown,
      onSelectedIndexChange: setSelectedIndex,
    }),
    [handleSearchSubmit, clearSearch, closeSuggestions, onSearchTermChange, handleKeyDown]
  );

  return {
    searchState: {
      searchTerm,
      isSearchActive,
      filteredElements,
      fitNodeIds,
      suggestions,
      showSuggestions,
      selectedIndex,
      isResetFromSearch,
    },
    searchActions,
  };
}
