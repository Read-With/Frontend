import { useCallback, useState } from "react";
import PropTypes from "prop-types";
import { useClickOutside } from "../../hooks/ui/tooltipHooks";
import { graphControlsStyles, topBarStyles, COLORS, ANIMATION_VALUES } from "../../utils/styles/styles.js";
import { findExactSuggestionMatch } from "../../utils/graph/searchUtils.js";
import { GRAPH_CHARACTER_FILTER_STAGE_OPTIONS, resolveChapterSidebarWidth } from "../../utils/graph/graphUtils.js";

export function EdgeLabelToggle({ visible, onToggle }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '4px 8px',
      borderRadius: '6px',
      background: COLORS.backgroundLighter,
      border: '1px solid #e7eaf7',
    }}>
      <span style={{
        fontSize: '15px',
        fontWeight: '500',
        color: COLORS.primary,
        whiteSpace: 'nowrap',
      }}>
        간선 라벨
      </span>
      <button
        onClick={onToggle}
        style={{
          width: '32px',
          height: '18px',
          borderRadius: '9px',
          border: 'none',
          background: visible ? COLORS.primary : '#e2e8f0',
          position: 'relative',
          cursor: 'pointer',
          transition: 'background-color 0.2s ease',
          outline: 'none',
        }}
        title={visible ? '간선 라벨 숨기기' : '간선 라벨 보이기'}
      >
        <div style={{
          width: '14px',
          height: '14px',
          borderRadius: '50%',
          background: '#fff',
          position: 'absolute',
          top: '2px',
          left: visible ? '16px' : '2px',
          transition: 'left 0.2s ease',
          boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
        }} />
      </button>
    </div>
  );
}

/** 인물 필터: 주요 | 주변 | 전체 */
export function CharacterFilterSegmented({ value, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="인물 필터"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 32,
        padding: 2,
        borderRadius: 8,
        background: COLORS.backgroundLighter,
        border: `1px solid ${COLORS.border}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
      }}
    >
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
            style={{
              height: 28,
              minWidth: 44,
              padding: '0 10px',
              border: 'none',
              borderRadius: 6,
              background: selected ? COLORS.primary : 'transparent',
              color: selected ? '#fff' : COLORS.textPrimary,
              fontSize: 13,
              fontWeight: selected ? 700 : 500,
              cursor: 'pointer',
              transition: 'background-color 0.15s ease, color 0.15s ease',
              outline: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

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
  isSearchActive = false
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

  const handleInputChange = useCallback((e) => {
    onGenerateSuggestions(e.target.value);
  }, [onGenerateSuggestions]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      trySubmitSearch();
    } else if (onKeyDown) {
      onKeyDown(e, (selectedTerm) => {
        if (selectedTerm) {
          onSearchSubmit(selectedTerm);
        }
      });
    }
  }, [trySubmitSearch, onSearchSubmit, onKeyDown]);

  const dropdownRef = useClickOutside(() => {
    onCloseSuggestions();
  }, canShowDropdown);

  const handleSelectSuggestion = useCallback((suggestion) => {
    if (suggestion) {
      const displayName = suggestion.label || suggestion.common_name || 'Unknown';
      onSearchSubmit(displayName);
    }
  }, [onSearchSubmit]);

  const handleFormSubmit = useCallback((e) => {
    e.preventDefault();
    trySubmitSearch();
  }, [trySubmitSearch]);

  const handleSearchButtonClick = useCallback((e) => {
    e.preventDefault();
    trySubmitSearch();
  }, [trySubmitSearch]);

  const handleResetButtonClick = useCallback((e) => {
    e.preventDefault();
    onClearSearch();
  }, [onClearSearch]);

  return (
    <div ref={dropdownRef} style={graphControlsStyles.container}>
      {showToast && (
        <div style={{
          position: 'absolute',
          top: '0',
          left: '100%',
          marginLeft: '12px',
          background: COLORS.primary,
          color: '#fff',
          padding: '12px 24px',
          borderRadius: '8px',
          fontSize: '14px',
          fontWeight: '500',
          boxShadow: '0 4px 20px rgba(92, 111, 92, 0.3)',
          zIndex: 9999,
          whiteSpace: 'nowrap',
          animation: 'toastSlideInRight 0.3s ease-out',
          pointerEvents: 'none',
          minWidth: '280px',
          textAlign: 'center',
        }}>
          {toastMessage}
          <style>
            {`
              @keyframes toastSlideInRight {
                from {
                  opacity: 0;
                  transform: translateY(-20px);
                }
                to {
                  opacity: 1;
                  transform: translateY(0);
                }
              }
            `}
          </style>
        </div>
      )}

      <form
        style={graphControlsStyles.form}
        onSubmit={handleFormSubmit}
      >
        <input
          style={graphControlsStyles.input}
          type="text"
          placeholder="인물 검색"
          value={searchTerm || ""}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.style.borderColor = COLORS.primary;
            e.target.style.background = '#fff';
            e.target.style.boxShadow = '0 0 0 2px rgba(92, 111, 92, 0.1)';
            if (trimmedTerm.length >= 2) {
              onGenerateSuggestions(searchTerm);
            }
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#e5e7eb';
            e.target.style.background = '#f8f9fc';
            e.target.style.boxShadow = 'none';
          }}
        />
        <button
          type="submit"
          style={{
            ...graphControlsStyles.button,
            ...(isSearchActive ? graphControlsStyles.resetButton : graphControlsStyles.searchButton)
          }}
          onClick={isSearchActive ? handleResetButtonClick : handleSearchButtonClick}
        >
          {isSearchActive ? (
            <>
              <span className="material-symbols-outlined" style={{fontSize: '12px'}}>undo</span>
              초기화
            </>
          ) : (
            <>
              <span className="material-symbols-outlined" style={{fontSize: '12px'}}>search</span>
              검색
            </>
          )}
        </button>
      </form>

      {canShowDropdown && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '0',
          right: '0',
          background: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          boxShadow: '0 6px 24px rgba(0, 0, 0, 0.15)',
          zIndex: 1000,
          maxHeight: '480px',
          overflowY: 'auto',
          marginTop: '12px',
          minWidth: '400px',
          width: '100%',
          scrollbarWidth: 'thin',
          scrollbarColor: '#cbd5e1 #f1f5f9',
        }}>
          <style>
            {`
              ::-webkit-scrollbar {
                width: 6px;
              }
              ::-webkit-scrollbar-track {
                background: #f1f5f9;
                border-radius: 3px;
              }
              ::-webkit-scrollbar-thumb {
                background: #cbd5e1;
                border-radius: 3px;
              }
              ::-webkit-scrollbar-thumb:hover {
                background: #94a3b8;
              }
            `}
          </style>

          {suggestions && suggestions.length > 0 ? (
            <>
              <div style={{
                padding: '16px 24px',
                background: '#f8f9fc',
                borderBottom: '1px solid #e5e7eb',
                borderTopLeftRadius: '12px',
                borderTopRightRadius: '12px',
              }}>
                <div style={{
                  fontSize: '15px',
                  fontWeight: '600',
                  color: '#6c757d',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  검색 결과 ({suggestions.length})
                </div>
              </div>

              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id || index}
                  style={{
                    padding: '20px 28px',
                    cursor: 'pointer',
                    borderBottom: index < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
                    background: index === selectedIndex ? '#f8f9fc' : 'transparent',
                    transition: 'background 0.2s ease',
                    position: 'relative',
                  }}
                  onClick={() => handleSelectSuggestion(suggestion)}
                  onMouseEnter={() => onSelectedIndexChange?.(index)}
                  onMouseLeave={() => onSelectedIndexChange?.(-1)}
                >
                  <div>
                    <div style={{
                      fontWeight: '900',
                      fontSize: '20px',
                      color: COLORS.primary,
                      marginBottom: '8px',
                    }}>
                      {suggestion.label || suggestion.common_name || 'Unknown'}
                    </div>

                    {suggestion.description && (
                    <div style={{
                      fontSize: '16px',
                      color: '#6c757d',
                      lineHeight: '1.6',
                      marginBottom: '12px',
                      fontWeight: '500',
                      wordBreak: 'keep-all',
                    }}>
                        {suggestion.description}
                      </div>
                    )}

                    {suggestion.names && suggestion.names.length > 0 && (
                      <div style={{
                        marginTop: '8px',
                      }}>
                        <div style={{
                          height: '1px',
                          background: '#e5e7eb',
                          marginBottom: '8px',
                        }} />

                        <div style={{
                          fontSize: '14px',
                          color: '#8b9bb4',
                          fontWeight: '700',
                          marginBottom: '6px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          별칭
                        </div>

                        <div style={{
                          fontSize: '15px',
                          color: '#6c757d',
                          fontStyle: 'italic',
                          fontWeight: '500',
                          lineHeight: '1.5',
                        }}>
                          {suggestion.names.slice(0, 3).join(', ')}
                          {suggestion.names.length > 3 && '...'}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={{
              padding: '32px 24px',
              textAlign: 'center',
              color: '#6c757d',
              fontSize: '16px',
              background: '#fafbfc',
              borderBottomLeftRadius: '8px',
              borderBottomRightRadius: '8px',
            }}>
              <div style={{
                marginBottom: '12px',
                fontSize: '48px',
                opacity: 0.6,
              }}>
                🔍
              </div>
              <div style={{
                fontWeight: '700',
                marginBottom: '6px',
                color: COLORS.primary,
                fontSize: '16px',
              }}>
                검색 결과 없음
              </div>
              <div style={{
                fontSize: '14px',
                opacity: 0.7,
                color: '#6c757d',
                lineHeight: '1.4',
              }}>
                다른 검색어를 시도해보세요
              </div>
            </div>
          )}
        </div>
      )}
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
    onSearchSubmit, onClearSearch, onGenerateSuggestions,
    onKeyDown, onCloseSuggestions, onSelectedIndexChange,
  } = searchActions;

  const sidebarLeft = resolveChapterSidebarWidth(isSidebarOpen);

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
          onSelectedIndexChange={onSelectedIndexChange}
          onKeyDown={onKeyDown}
          onCloseSuggestions={onCloseSuggestions}
          isSearchActive={isSearchActive}
        />

        <EdgeLabelToggle visible={edgeLabelVisible} onToggle={onToggleEdgeLabel} />

        <CharacterFilterSegmented value={filterStage} onChange={onFilterChange} />
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
