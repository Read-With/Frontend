import React from 'react';
import PropTypes from 'prop-types';
import GraphControls from './GraphControls';
import EdgeLabelToggle from './tooltip/EdgeLabelToggle';
import { topBarStyles } from '../../utils/styles/styles.js';
import { ANIMATION_VALUES } from '../../utils/styles/animations';
import { COLORS } from '../../utils/styles/styles.js';

const GRAPH_CONSTANTS = {
  SIDEBAR: {
    OPEN_WIDTH: 240,
    CLOSED_WIDTH: 60,
  },
};

function GraphTopBar({
  isSidebarOpen,
  searchTerm,
  onSearchSubmit,
  onClearSearch,
  onGenerateSuggestions,
  suggestions,
  showSuggestions,
  selectedIndex,
  onSelectSuggestion,
  onKeyDown,
  onCloseSuggestions,
  isSearchActive,
  edgeLabelVisible,
  onToggleEdgeLabel,
  filterStage,
  onFilterChange,
}) {
  return (
    <div
      style={{
        ...topBarStyles.container,
        position: 'fixed',
        top: 0,
        left: isSidebarOpen ? `${GRAPH_CONSTANTS.SIDEBAR.OPEN_WIDTH}px` : `${GRAPH_CONSTANTS.SIDEBAR.CLOSED_WIDTH}px`,
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
          onSelectSuggestion={onSelectSuggestion}
          onKeyDown={onKeyDown}
          onCloseSuggestions={onCloseSuggestions}
          isSearchActive={isSearchActive}
        />

        <EdgeLabelToggle visible={edgeLabelVisible} onToggle={onToggleEdgeLabel} />

        <select
          value={filterStage}
          onChange={(e) => onFilterChange(Number(e.target.value))}
          aria-label="필터링 단계 선택"
          aria-describedby="filter-stage-description"
          style={{
            height: 32,
            padding: '0 12px',
            borderRadius: 8,
            border: `1px solid ${filterStage > 0 ? COLORS.primary : COLORS.border}`,
            background: filterStage > 0 ? COLORS.primary : COLORS.background,
            color: filterStage > 0 ? '#fff' : COLORS.textPrimary,
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
            transition: 'all 0.2s ease',
            outline: 'none',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            boxShadow: filterStage > 0 ? `0 2px 8px ${COLORS.primary}40` : '0 2px 8px rgba(0,0,0,0.1)',
            justifyContent: 'center',
            minWidth: 120,
          }}
          title="필터링 단계 선택"
        >
          <option value={0} style={{ color: COLORS.textPrimary, background: COLORS.background }}>
            모두 보기
          </option>
          <option value={1} style={{ color: COLORS.textPrimary, background: COLORS.background }}>
            주요 인물만 보기
          </option>
          <option value={2} style={{ color: COLORS.textPrimary, background: COLORS.background }}>
            주요 인물과 보기
          </option>
        </select>
      </div>

      <div style={topBarStyles.rightSection} role="region" aria-label="그래프 상단 바 오른쪽 영역"></div>
    </div>
  );
}

GraphTopBar.propTypes = {
  isSidebarOpen: PropTypes.bool.isRequired,
  searchTerm: PropTypes.string.isRequired,
  onSearchSubmit: PropTypes.func.isRequired,
  onClearSearch: PropTypes.func.isRequired,
  onGenerateSuggestions: PropTypes.func.isRequired,
  suggestions: PropTypes.arrayOf(PropTypes.string).isRequired,
  showSuggestions: PropTypes.bool.isRequired,
  selectedIndex: PropTypes.number.isRequired,
  onSelectSuggestion: PropTypes.func.isRequired,
  onKeyDown: PropTypes.func.isRequired,
  onCloseSuggestions: PropTypes.func.isRequired,
  isSearchActive: PropTypes.bool.isRequired,
  edgeLabelVisible: PropTypes.bool.isRequired,
  onToggleEdgeLabel: PropTypes.func.isRequired,
  filterStage: PropTypes.number.isRequired,
  onFilterChange: PropTypes.func.isRequired,
};

export default GraphTopBar;
