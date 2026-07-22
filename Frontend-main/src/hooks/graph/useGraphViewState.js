/** 그래프 뷰 상태: 검색·필터 파이프라인·사이드바 UI */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  buildSuggestions,
  extractFitNodeIds,
  normalizeGraphSearchTerm,
  resolveGraphSearchFilter,
  SEARCH_RESET_SUPPRESS_MS,
} from '../../utils/graph/graphCy.js';
import { filterMainCharacters } from '../../utils/graph/graphModel';
import { sortElementsByDataId } from '../../utils/graph/graphCore';
import { useLatestRef } from '../common/hooksShared';

/** edgeLabel / filterStage — graph 페이지·viewer 공유 */
export function useGraphDisplayToggles() {
  const [edgeLabelVisible, setEdgeLabelVisible] = useState(true);
  const [filterStage, setFilterStage] = useState(0);

  const toggleEdgeLabel = useCallback(() => {
    setEdgeLabelVisible((prev) => !prev);
  }, []);

  return {
    edgeLabelVisible,
    setEdgeLabelVisible,
    filterStage,
    setFilterStage,
    toggleEdgeLabel,
  };
}

export function useGraphState() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const {
    edgeLabelVisible,
    filterStage,
    setFilterStage,
    toggleEdgeLabel,
  } = useGraphDisplayToggles();

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
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
    [elements],
  );

  const filteredMainCharacters = useMemo(
    () => (filterStage > 0 ? filterMainCharacters(sortedElements, filterStage) : sortedElements),
    [sortedElements, filterStage],
  );

  const finalElements = useMemo(() => {
    if (isSearchActive) return filteredElements ?? [];
    return filteredMainCharacters;
  }, [isSearchActive, filteredElements, filteredMainCharacters]);

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

  const suppressSuggestionsRef = useRef(false);
  const skipFilterEffectRef = useRef(false);
  const elementsRef = useLatestRef(elements);
  const chapterDataRef = useLatestRef(currentChapterData);

  const fitNodeIds = useMemo(
    () => extractFitNodeIds(filteredElements, isSearchActive),
    [isSearchActive, filteredElements],
  );

  const runSearchFilter = useCallback((sourceElements, term) => {
    const { applied, filtered } = resolveGraphSearchFilter(
      sourceElements,
      term,
      chapterDataRef.current,
    );
    setFilteredElements(filtered);
    return applied;
  }, [chapterDataRef]);

  useEffect(() => {
    if (!isSearchActive) return;
    const { trimmed } = normalizeGraphSearchTerm(searchTerm);
    if (!trimmed) return;
    if (skipFilterEffectRef.current) {
      skipFilterEffectRef.current = false;
      return;
    }
    runSearchFilter(elements, trimmed);
  }, [elements, isSearchActive, searchTerm, runSearchFilter]);

  const handleSearchSubmit = useCallback((term) => {
    const { trimmed } = normalizeGraphSearchTerm(term);
    suppressSuggestionsRef.current = true;
    skipFilterEffectRef.current = true;
    setSearchTerm(term);
    setIsSearchActive(!!trimmed);
    setIsResetFromSearch(false);
    setShowSuggestions(false);
    setSelectedIndex(-1);

    const applied = runSearchFilter(elementsRef.current, trimmed);
    if (!applied) {
      skipFilterEffectRef.current = false;
      setIsSearchActive(false);
    }
  }, [runSearchFilter, elementsRef]);

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
    const { trimmed, hasMinLength } = normalizeGraphSearchTerm(searchTerm);
    if (!hasMinLength) {
      setSuggestions([]);
      setShowSuggestions(false);
      setSelectedIndex(-1);
      return;
    }

    setSuggestions(buildSuggestions(elements, trimmed, chapterDataRef.current));
    setSelectedIndex(-1);

    if (suppressSuggestionsRef.current) {
      suppressSuggestionsRef.current = false;
      setShowSuggestions(false);
      return;
    }

    setShowSuggestions(true);
  }, [searchTerm, elements, chapterDataRef]);

  useEffect(() => {
    if (!isResetFromSearch) return undefined;
    const timer = setTimeout(() => {
      setIsResetFromSearch(false);
    }, SEARCH_RESET_SUPPRESS_MS);
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

  const onGenerateSuggestions = useCallback((term) => {
    suppressSuggestionsRef.current = false;
    setSearchTerm(term);
    const { hasMinLength } = normalizeGraphSearchTerm(term);
    if (hasMinLength) {
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
      onGenerateSuggestions,
      handleKeyDown,
      onSelectedIndexChange: setSelectedIndex,
    }),
    [handleSearchSubmit, clearSearch, closeSuggestions, onGenerateSuggestions, handleKeyDown],
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
