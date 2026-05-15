import React from 'react';
import PropTypes from 'prop-types';
import GraphControls from './GraphControls';
import EdgeLabelToggle from './tooltip/EdgeLabelToggle';
import { topBarStyles, COLORS, ANIMATION_VALUES } from '../../utils/styles/styles.js';
import { GRAPH_LAYOUT_CONSTANTS, GRAPH_CHARACTER_FILTER_STAGE_OPTIONS } from './graphConstants.js';

// 변하지 않는 select 기본 스타일
const selectBaseStyle = {
  height: 32,
  padding: '0 12px',
  borderRadius: 8,
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer',
  transition: 'all 0.2s ease',
  outline: 'none',
  minWidth: 120,
};

// ─── CharacterFilterSelect ─────────────────────────────────────────────────────
function CharacterFilterSelect({ value, onChange }) {
  const isActive = value > 0;
  const style = {
    ...selectBaseStyle,
    border: `1px solid ${isActive ? COLORS.primary : COLORS.border}`,
    background: isActive ? COLORS.primary : COLORS.background,
    color: isActive ? '#fff' : COLORS.textPrimary,
    boxShadow: isActive
      ? `0 2px 8px ${COLORS.primary}40`
      : '0 2px 8px rgba(0,0,0,0.1)',
  };

  return (
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      aria-label="인물 필터"
      style={style}
    >
      {GRAPH_CHARACTER_FILTER_STAGE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

CharacterFilterSelect.propTypes = {
  value: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

// ─── GraphTopBar ───────────────────────────────────────────────────────────────
/**
 * Props 구조
 *
 * 개별 props:
 *   isSidebarOpen, edgeLabelVisible, onToggleEdgeLabel, filterStage, onFilterChange
 *
 * 그룹 props:
 *   searchState   — 검색 상태값 (searchTerm, isSearchActive, suggestions, showSuggestions, selectedIndex)
 *   searchActions — 검색 핸들러 (onSearchSubmit, onClearSearch, onGenerateSuggestions,
 *                                 onKeyDown, onCloseSuggestions)
 */
function GraphTopBar({
  isSidebarOpen,
  searchState,
  searchActions,
  edgeLabelVisible,
  onToggleEdgeLabel,
  filterStage,
  onFilterChange,
}) {
  const { searchTerm, isSearchActive, suggestions, showSuggestions, selectedIndex } = searchState;
  const {
    onSearchSubmit, onClearSearch, onGenerateSuggestions,
    onKeyDown, onCloseSuggestions,
  } = searchActions;

  const { SIDEBAR } = GRAPH_LAYOUT_CONSTANTS;
  const sidebarLeft = isSidebarOpen ? SIDEBAR.OPEN_WIDTH : SIDEBAR.CLOSED_WIDTH;

  return (
    <div
      style={{
        ...topBarStyles.container,
        position: 'fixed',
        top: 0,
        left: `${sidebarLeft}px`,
        right: 0,
        zIndex: 10000,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${COLORS.border}`,
      }}
    >
      <div style={topBarStyles.leftSection}>
        <GraphControls
          searchTerm={searchTerm}
          onSearchSubmit={onSearchSubmit}
          onClearSearch={onClearSearch}
          onGenerateSuggestions={onGenerateSuggestions}
          suggestions={suggestions}
          showSuggestions={showSuggestions}
          selectedIndex={selectedIndex}
          onKeyDown={onKeyDown}
          onCloseSuggestions={onCloseSuggestions}
          isSearchActive={isSearchActive}
        />

        <EdgeLabelToggle visible={edgeLabelVisible} onToggle={onToggleEdgeLabel} />

        <CharacterFilterSelect value={filterStage} onChange={onFilterChange} />
      </div>
    </div>
  );
}

GraphTopBar.propTypes = {
  isSidebarOpen: PropTypes.bool.isRequired,
  searchState: PropTypes.shape({
    searchTerm: PropTypes.string.isRequired,
    isSearchActive: PropTypes.bool.isRequired,
    suggestions: PropTypes.arrayOf(PropTypes.any).isRequired,
    showSuggestions: PropTypes.bool.isRequired,
    selectedIndex: PropTypes.number.isRequired,
  }).isRequired,
  searchActions: PropTypes.shape({
    onSearchSubmit: PropTypes.func.isRequired,
    onClearSearch: PropTypes.func.isRequired,
    onGenerateSuggestions: PropTypes.func.isRequired,
    onKeyDown: PropTypes.func.isRequired,
    onCloseSuggestions: PropTypes.func.isRequired,
  }).isRequired,
  edgeLabelVisible: PropTypes.bool.isRequired,
  onToggleEdgeLabel: PropTypes.func.isRequired,
  filterStage: PropTypes.number.isRequired,
  onFilterChange: PropTypes.func.isRequired,
};

export default GraphTopBar;
