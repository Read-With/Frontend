/** 그래프 상단 플로팅 도구: 검색 팔레트 열기 · 간선 라벨 · 인물 필터 */

import { useCallback, useEffect, useId, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { useClickOutside } from "../../../hooks/tooltipHooks";
import { GRAPH_CHARACTER_FILTER_STAGE_OPTIONS, getCharacterFilterStageLabel } from '../../../utils/graph/graphCore.js';
import GraphSearchPalette from "./GraphSearchPalette";
import "../styles/graph.css";

const MOD_KEY_LABEL =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl";

function EdgeLabelToggle({ visible, onToggle }) {
  const labelId = useId();
  return (
    <div className="edge-label-toggle">
      <span id={labelId} className="edge-label-toggle__text">
        간선 라벨
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={visible}
        aria-labelledby={labelId}
        onClick={onToggle}
        title={visible ? "간선 라벨 숨기기" : "간선 라벨 보이기"}
        className="edge-label-switch"
      >
        <span className="edge-label-switch__thumb" aria-hidden />
      </button>
    </div>
  );
}

/** 인물 필터: 주요 | 주변 | 전체 */
function CharacterFilterSegmented({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="인물 필터" className="character-filter">
      {GRAPH_CHARACTER_FILTER_STAGE_OPTIONS.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className="character-filter-option"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * 검색 팔레트 · 필터 · 간선 라벨
 */
export function GraphFloatingControls({
  searchState,
  searchActions,
  edgeLabelVisible,
  onToggleEdgeLabel,
  filterStage,
  onFilterChange,
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useClickOutside(() => setOptionsOpen(false), optionsOpen);

  const {
    searchTerm,
    appliedSearchTerm,
    isSearchActive,
    suggestions,
    showSuggestions,
    selectedIndex,
  } = searchState;

  // useGraphSearch().searchActions 형태 그대로 받음
  const {
    onSearchSubmit,
    clearSearch: onClearSearch,
    onGenerateSuggestions,
    handleKeyDown: onKeyDown,
    closeSuggestions: onCloseSuggestions,
    onSelectedIndexChange,
  } = searchActions;

  const openPalette = useCallback(() => {
    setOptionsOpen(false);
    setPaletteOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    onCloseSuggestions?.();
  }, [onCloseSuggestions]);

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "k") return;
      const tag = e.target?.tagName;
      const isTyping = tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable;
      if (isTyping && !paletteOpen) return;
      e.preventDefault();
      setPaletteOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen]);

  const filterLabel = getCharacterFilterStageLabel(filterStage) ?? "필터";

  return (
    <>
      <div
        className="graph-floating-dock"
        aria-label="그래프 도구"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`graph-floating-btn${isSearchActive ? " is-active" : ""}`}
          aria-label={isSearchActive ? `인물 검색 (활성: ${appliedSearchTerm})` : "인물 검색"}
          title={`인물 검색 (${MOD_KEY_LABEL}+K)`}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          onClick={openPalette}
        >
          <Search size={18} aria-hidden />
        </button>

        <div className="graph-floating-options" ref={optionsRef}>
          <button
            type="button"
            className={`graph-floating-btn${filterStage !== 0 || !edgeLabelVisible ? " is-active" : ""}`}
            aria-label="그래프 표시 옵션"
            title={`표시 옵션 · 필터 ${filterLabel}`}
            aria-haspopup="menu"
            aria-expanded={optionsOpen}
            onClick={() => setOptionsOpen((v) => !v)}
          >
            <SlidersHorizontal size={18} aria-hidden />
          </button>
          {optionsOpen ? (
            <div className="graph-floating-options-panel" role="menu" aria-label="표시 옵션">
              <div className="graph-topbar-more-section" role="none">
                <span className="graph-topbar-more-label">간선</span>
                <EdgeLabelToggle
                  visible={edgeLabelVisible}
                  onToggle={() => onToggleEdgeLabel()}
                />
              </div>
              <div className="graph-topbar-more-section" role="none">
                <span className="graph-topbar-more-label">인물 필터</span>
                <CharacterFilterSegmented value={filterStage} onChange={onFilterChange} />
              </div>
            </div>
          ) : null}
        </div>

      </div>

      <GraphSearchPalette
        modKeyLabel={MOD_KEY_LABEL}
        open={paletteOpen}
        onClose={closePalette}
        searchTerm={searchTerm}
        onSearchSubmit={onSearchSubmit}
        onClearSearch={onClearSearch}
        onGenerateSuggestions={onGenerateSuggestions}
        suggestions={suggestions}
        showSuggestions={showSuggestions}
        selectedIndex={selectedIndex}
        onSelectedIndexChange={onSelectedIndexChange}
        onKeyDown={onKeyDown}
        isSearchActive={isSearchActive}
      />
    </>
  );
}
