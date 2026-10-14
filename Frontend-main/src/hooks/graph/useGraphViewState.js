/** 그래프 뷰 상태: 검색·필터 파이프라인·사이드바 UI */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  buildSuggestions,
  extractFitNodeIds,
  normalizeGraphSearchTerm,
  resolveGraphSearchFilter,
} from '../../utils/graph/graphHighlight.js';
import { filterMainCharacters } from '../../utils/graph/graphElements';
import { sortElementsByDataId } from '../../utils/graph/graphCore';
import { useLatestRef, NARROW_VIEWPORT_MQ } from '../common/hooksShared';
import { cycleIndex } from '../../utils/common/valueUtils';

const SIDEBAR_OPEN_STORAGE_KEY = 'graph-chapter-sidebar-open';

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
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    const narrow = window.matchMedia(NARROW_VIEWPORT_MQ).matches;
    try {
      const raw = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);
      if (raw === '0') return false;
      if (raw === '1') return true;
    } catch {
      /* ignore */
    }
    return !narrow;
  });
  const [activeTooltip, setActiveTooltip] = useState(null);
  const [isSidebarClosing, setIsSidebarClosing] = useState(false);
  const {
    edgeLabelVisible,
    filterStage,
    setFilterStage,
    toggleEdgeLabel,
  } = useGraphDisplayToggles();

  const persistSidebarOpen = useCallback((next) => {
    try {
      localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => {
      const next = !prev;
      persistSidebarOpen(next);
      return next;
    });
  }, [persistSidebarOpen]);

  const setSidebarOpen = useCallback((open) => {
    setIsSidebarOpen(Boolean(open));
    persistSidebarOpen(Boolean(open));
  }, [persistSidebarOpen]);

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
    setSidebarOpen,
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
  // searchTerm: 팔레트 입력값 / appliedSearchTerm: 제출(Enter·제안 선택)된 검색어.
  // 그래프 필터는 적용된 검색어만 따름 — 입력 중 키마다 필터·Cytoscape 재동기화·재배치가 일어나지 않도록
  const [searchTerm, setSearchTerm] = useState('');
  const [appliedSearchTerm, setAppliedSearchTerm] = useState('');
  const [filteredElements, setFilteredElements] = useState([]);
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);

  const suppressSuggestionsRef = useRef(false);
  // 마지막으로 필터한 (elements, 검색어) — 같은 조합이면 effect가 다시 필터하지 않음 (제출 직후 중복 방지)
  const lastFilterRef = useRef({ elements: null, term: '' });
  const elementsRef = useLatestRef(elements);
  const chapterDataRef = useLatestRef(currentChapterData);

  const fitNodeIds = useMemo(
    () => extractFitNodeIds(filteredElements, isSearchActive),
    [isSearchActive, filteredElements],
  );

  const closeSuggestions = useCallback(() => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
  }, []);

  const runSearchFilter = useCallback((sourceElements, term) => {
    lastFilterRef.current = { elements: sourceElements, term };
    const { applied, filtered } = resolveGraphSearchFilter(
      sourceElements,
      term,
      chapterDataRef.current,
    );
    setFilteredElements(filtered);
    return applied;
  }, [chapterDataRef]);

  // 검색 중 elements가 바뀌면(이벤트 전환 등) 적용된 검색어로 다시 필터
  useEffect(() => {
    if (!isSearchActive || !appliedSearchTerm) return;
    const last = lastFilterRef.current;
    if (last.elements === elements && last.term === appliedSearchTerm) return;
    runSearchFilter(elements, appliedSearchTerm);
  }, [elements, isSearchActive, appliedSearchTerm, runSearchFilter]);

  const handleSearchSubmit = useCallback((term) => {
    const { trimmed } = normalizeGraphSearchTerm(term);
    suppressSuggestionsRef.current = true;
    setSearchTerm(term);
    setIsSearchActive(!!trimmed);
    closeSuggestions();

    const applied = runSearchFilter(elementsRef.current, trimmed);
    if (applied) {
      setAppliedSearchTerm(trimmed);
    } else {
      setIsSearchActive(false);
      setAppliedSearchTerm('');
    }
  }, [runSearchFilter, elementsRef, closeSuggestions]);

  const clearSearch = useCallback(() => {
    suppressSuggestionsRef.current = false;
    setSearchTerm('');
    setAppliedSearchTerm('');
    setFilteredElements([]);
    setIsSearchActive(false);
    setSuggestions([]);
    closeSuggestions();
  }, [closeSuggestions]);

  useEffect(() => {
    const { trimmed, hasMinLength } = normalizeGraphSearchTerm(searchTerm);
    if (!hasMinLength) {
      setSuggestions([]);
      closeSuggestions();
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
  }, [searchTerm, elements, chapterDataRef, closeSuggestions]);

  // Escape는 검색 팔레트가 window 캡처 단계에서 처리(전파 중단)하므로 여기선 화살표만
  const handleKeyDown = useCallback((e) => {
    const dir = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!dir || !showSuggestions || !(suggestions?.length > 0)) return;
    e.preventDefault();
    setSelectedIndex((prev) => cycleIndex(prev, suggestions.length, dir));
  }, [showSuggestions, suggestions]);

  const onGenerateSuggestions = useCallback((term) => {
    suppressSuggestionsRef.current = false;
    setSearchTerm(term);
    const { hasMinLength } = normalizeGraphSearchTerm(term);
    if (hasMinLength) {
      setShowSuggestions(true);
    } else {
      closeSuggestions();
    }
  }, [closeSuggestions]);

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

  const searchState = useMemo(
    () => ({
      searchTerm,
      appliedSearchTerm,
      isSearchActive,
      filteredElements,
      fitNodeIds,
      suggestions,
      showSuggestions,
      selectedIndex,
    }),
    [searchTerm, appliedSearchTerm, isSearchActive, filteredElements, fitNodeIds, suggestions, showSuggestions, selectedIndex],
  );

  return { searchState, searchActions };
}
