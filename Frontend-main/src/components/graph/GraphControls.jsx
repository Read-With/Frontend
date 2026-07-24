import { useCallback, useEffect, useId, useState } from "react";
import PropTypes from "prop-types";
import { useClickOutside } from "../../hooks/ui/tooltipHooks";
import { ANIMATION_VALUES } from "../../utils/styles/styles.js";
import { findExactSuggestionMatch } from "../../utils/graph/graphCy.js";
import { GRAPH_CHARACTER_FILTER_STAGE_OPTIONS, resolveChapterSidebarWidth } from "../../utils/graph/graphCore.js";
import "./RelationGraph.css";

const GRAPH_TOPBAR_COMPACT_MQ = "(max-width: 56rem)";

function useMatchMedia(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

export function EdgeLabelToggle({ visible, onToggle }) {
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

EdgeLabelToggle.propTypes = {
  visible: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
};

/** 인물 필터: 주요 | 주변 | 전체 */
export function CharacterFilterSegmented({ value, onChange }) {
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

CharacterFilterSegmented.propTypes = {
  value: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

/** 2차 액션(라벨·필터) overflow 메뉴 */
export function GraphControlsMoreMenu({
  edgeLabelVisible,
  onToggleEdgeLabel,
  filterStage,
  onFilterChange,
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useClickOutside(() => setOpen(false), open);

  return (
    <div className="graph-topbar-more" ref={menuRef}>
      <button
        type="button"
        className="graph-topbar-more-btn"
        aria-label="그래프 표시 옵션"
        title="그래프 표시 옵션"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="material-symbols-outlined" aria-hidden>
          more_vert
        </span>
      </button>
      {open ? (
        <div className="graph-topbar-more-panel" role="menu" aria-label="그래프 표시 옵션">
          <div className="graph-topbar-more-section" role="none">
            <span className="graph-topbar-more-label">간선</span>
            <EdgeLabelToggle visible={edgeLabelVisible} onToggle={onToggleEdgeLabel} />
          </div>
          <div className="graph-topbar-more-section" role="none">
            <span className="graph-topbar-more-label">인물 필터</span>
            <CharacterFilterSegmented value={filterStage} onChange={onFilterChange} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

GraphControlsMoreMenu.propTypes = {
  edgeLabelVisible: PropTypes.bool.isRequired,
  onToggleEdgeLabel: PropTypes.func.isRequired,
  filterStage: PropTypes.number.isRequired,
  onFilterChange: PropTypes.func.isRequired,
};

function GraphControls({
  searchTerm = "",
  onSearchSubmit,
  onClearSearch,
  onGenerateSuggestions,
  suggestions = [],
  showSuggestions = false,
  selectedIndex = -1,
  onSelectedIndexChange,
  onKeyDown,
  onCloseSuggestions,
  isSearchActive = false,
}) {
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const trimmedTerm = (searchTerm || "").trim();
  const canShowDropdown = showSuggestions && trimmedTerm.length >= 2;

  const showToastMessage = useCallback((message) => {
    setToastMessage(message);
    setShowToast(true);
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  }, []);

  const trySubmitSearch = useCallback(() => {
    if (trimmedTerm.length < 2) return;

    const exactMatch = findExactSuggestionMatch(suggestions, trimmedTerm);
    if (exactMatch) {
      onSearchSubmit(trimmedTerm);
    } else if (suggestions.length > 0) {
      showToastMessage("여러 후보가 있습니다. 드롭다운에서 선택해주세요.");
    }
  }, [trimmedTerm, onSearchSubmit, suggestions, showToastMessage]);

  const handleInputChange = useCallback(
    (e) => {
      onGenerateSuggestions(e.target.value);
    },
    [onGenerateSuggestions]
  );

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        trySubmitSearch();
      } else if (onKeyDown) {
        onKeyDown(e, (selectedTerm) => {
          if (selectedTerm) {
            onSearchSubmit(selectedTerm);
          }
        });
      }
    },
    [trySubmitSearch, onSearchSubmit, onKeyDown]
  );

  const dropdownRef = useClickOutside(() => {
    onCloseSuggestions();
  }, canShowDropdown);

  const handleSelectSuggestion = useCallback(
    (suggestion) => {
      if (suggestion) {
        const displayName = suggestion.label || suggestion.common_name || "Unknown";
        onSearchSubmit(displayName);
      }
    },
    [onSearchSubmit]
  );

  const handleFormSubmit = useCallback(
    (e) => {
      e.preventDefault();
      trySubmitSearch();
    },
    [trySubmitSearch]
  );

  const handleSearchButtonClick = useCallback(
    (e) => {
      e.preventDefault();
      trySubmitSearch();
    },
    [trySubmitSearch]
  );

  const handleResetButtonClick = useCallback(
    (e) => {
      e.preventDefault();
      onClearSearch();
    },
    [onClearSearch]
  );

  return (
    <div ref={dropdownRef} className="graph-search-shell">
      {showToast ? <div className="graph-search-toast">{toastMessage}</div> : null}

      <form className="graph-search-form" onSubmit={handleFormSubmit}>
        <input
          className="graph-search-input"
          type="text"
          placeholder="인물 검색"
          aria-label="인물 검색"
          aria-autocomplete="list"
          aria-expanded={canShowDropdown}
          value={searchTerm || ""}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (trimmedTerm.length >= 2) {
              onGenerateSuggestions(searchTerm);
            }
          }}
        />
        <button
          type="submit"
          className="graph-search-submit"
          onClick={isSearchActive ? handleResetButtonClick : handleSearchButtonClick}
        >
          {isSearchActive ? (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                undo
              </span>
              초기화
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>
                search
              </span>
              검색
            </>
          )}
        </button>
      </form>

      {canShowDropdown ? (
        <div className="graph-search-dropdown" role="listbox" aria-label="인물 검색 결과">
          {suggestions && suggestions.length > 0 ? (
            <>
              <div className="graph-search-dropdown-header">
                <div className="graph-search-dropdown-header-title">
                  검색 결과 ({suggestions.length})
                </div>
              </div>

              {suggestions.map((suggestion, index) => {
                const hasDetail = Boolean(suggestion.description || suggestion.names?.length);
                return (
                  <div
                    key={suggestion.id || index}
                    role="option"
                    aria-selected={index === selectedIndex}
                    className={`graph-search-option${index === selectedIndex ? " is-active" : ""}`}
                    onClick={() => handleSelectSuggestion(suggestion)}
                    onMouseEnter={() => onSelectedIndexChange?.(index)}
                    onMouseLeave={() => onSelectedIndexChange?.(-1)}
                  >
                    <div
                      className={`graph-search-option-name${hasDetail ? " has-detail" : ""}`}
                    >
                      {suggestion.label || suggestion.common_name || "Unknown"}
                    </div>

                    {suggestion.description ? (
                      <div className="graph-search-option-desc">{suggestion.description}</div>
                    ) : null}

                    {suggestion.names && suggestion.names.length > 0 ? (
                      <div>
                        <div className="graph-search-option-alias-rule" />
                        <div className="graph-search-option-alias-label">별칭</div>
                        <div className="graph-search-option-alias-text">
                          {suggestion.names.slice(0, 3).join(", ")}
                          {suggestion.names.length > 3 ? "..." : ""}
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </>
          ) : (
            <div className="graph-search-empty">
              <span className="material-symbols-outlined graph-search-empty-icon" aria-hidden>
                search_off
              </span>
              <div className="graph-search-empty-title">검색 결과 없음</div>
              <div className="graph-search-empty-desc">다른 검색어를 시도해보세요</div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default GraphControls;

export function GraphTopBar({
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
    onSearchSubmit,
    onClearSearch,
    onGenerateSuggestions,
    onKeyDown,
    onCloseSuggestions,
    onSelectedIndexChange,
  } = searchActions;

  const sidebarLeft = resolveChapterSidebarWidth(isSidebarOpen);
  const isCompact = useMatchMedia(GRAPH_TOPBAR_COMPACT_MQ);

  return (
    <div
      className="graph-page-topbar"
      style={{
        position: "fixed",
        top: 0,
        left: `${sidebarLeft}px`,
        right: 0,
        transition: `left ${ANIMATION_VALUES.DURATION.SLOW} ${ANIMATION_VALUES.EASE_OUT}`,
      }}
    >
      <div className="graph-page-topbar-left">
        <GraphControls
          searchTerm={searchTerm}
          onSearchSubmit={onSearchSubmit}
          onClearSearch={onClearSearch}
          onGenerateSuggestions={onGenerateSuggestions}
          suggestions={suggestions}
          showSuggestions={showSuggestions}
          selectedIndex={selectedIndex}
          onSelectedIndexChange={onSelectedIndexChange}
          onKeyDown={onKeyDown}
          onCloseSuggestions={onCloseSuggestions}
          isSearchActive={isSearchActive}
        />

        {isCompact ? (
          <GraphControlsMoreMenu
            edgeLabelVisible={edgeLabelVisible}
            onToggleEdgeLabel={onToggleEdgeLabel}
            filterStage={filterStage}
            onFilterChange={onFilterChange}
          />
        ) : (
          <div className="graph-page-topbar-secondary">
            <EdgeLabelToggle visible={edgeLabelVisible} onToggle={onToggleEdgeLabel} />
            <CharacterFilterSegmented value={filterStage} onChange={onFilterChange} />
          </div>
        )}
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
    onSelectedIndexChange: PropTypes.func,
  }).isRequired,
  edgeLabelVisible: PropTypes.bool.isRequired,
  onToggleEdgeLabel: PropTypes.func.isRequired,
  filterStage: PropTypes.number.isRequired,
  onFilterChange: PropTypes.func.isRequired,
};
