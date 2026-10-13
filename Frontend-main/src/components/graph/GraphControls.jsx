import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, SearchX, SlidersHorizontal } from "lucide-react";
import { useClickOutside } from "../../hooks/ui/tooltipHooks";
import { findExactSuggestionMatch } from "../../utils/graph/graphHighlight.js";
import {
  GRAPH_CHARACTER_FILTER_STAGE_OPTIONS,
  getCharacterFilterStageLabel,
} from "../../utils/graph/graphCore.js";
import "./RelationGraph.css";

/** 분할·전체 그래프 상단 챕터/사건 메타 (공통) */
export function GraphTopBarMeta({ chapterLabel, chapterTitle, eventLabel }) {
  return (
    <div className="graph-topbar-meta">
      <span
        className="graph-topbar-meta-chapter"
        title={chapterTitle || chapterLabel}
      >
        {chapterLabel}
      </span>
      {eventLabel != null ? (
        <span className="graph-topbar-meta-event">{eventLabel}</span>
      ) : null}
    </div>
  );
}

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


function getSuggestionDisplayName(suggestion) {
  return suggestion?.label || suggestion?.common_name || "Unknown";
}

const MOD_KEY_LABEL =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent)
    ? "⌘"
    : "Ctrl";

function GraphSearchPalette({
  open,
  onClose,
  searchTerm = "",
  onSearchSubmit,
  onClearSearch,
  onGenerateSuggestions,
  suggestions = [],
  showSuggestions = false,
  selectedIndex = -1,
  onSelectedIndexChange,
  onKeyDown,
  isSearchActive = false,
}) {
  const inputRef = useRef(null);
  const toastTimerRef = useRef(null);
  const [toastMessage, setToastMessage] = useState("");
  const trimmedTerm = (searchTerm || "").trim();
  const canShowResults = open && trimmedTerm.length >= 2;

  useEffect(() => {
    if (!open) return undefined;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  const showToastMessage = useCallback((message) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToastMessage(message);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToastMessage("");
    }, 3000);
  }, []);

  const trySubmitSearch = useCallback(() => {
    if (trimmedTerm.length < 2) return;

    const exactMatch = findExactSuggestionMatch(suggestions, trimmedTerm);
    if (exactMatch) {
      onSearchSubmit(trimmedTerm);
      onClose();
    } else if (suggestions.length > 0) {
      showToastMessage("여러 후보가 있습니다. 목록에서 선택해주세요.");
    }
  }, [trimmedTerm, onSearchSubmit, suggestions, showToastMessage, onClose]);

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
            onClose();
          }
        });
      }
    },
    [trySubmitSearch, onSearchSubmit, onKeyDown, onClose]
  );

  const handleSelectSuggestion = useCallback(
    (suggestion) => {
      if (!suggestion) return;
      onSearchSubmit(getSuggestionDisplayName(suggestion));
      onClose();
    },
    [onSearchSubmit, onClose]
  );

  const handleClear = useCallback(() => {
    onClearSearch();
    onClose();
  }, [onClearSearch, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className="graph-search-palette" role="dialog" aria-modal="true" aria-label="인물 검색">
      <button
        type="button"
        className="graph-search-palette-scrim"
        aria-label="검색 닫기"
        onClick={onClose}
      />
      <div className="graph-search-palette-panel">
        {toastMessage ? (
          <div className="graph-search-toast is-palette" role="status" aria-live="polite">
            {toastMessage}
          </div>
        ) : null}

        <form
          className="graph-search-palette-form"
          onSubmit={(e) => {
            e.preventDefault();
            trySubmitSearch();
          }}
        >
          <Search size={20} className="graph-search-palette-icon" aria-hidden />
          <input
            ref={inputRef}
            className="graph-search-palette-input"
            type="text"
            placeholder="인물 검색"
            aria-label="인물 검색"
            aria-autocomplete="list"
            aria-expanded={canShowResults && showSuggestions}
            value={searchTerm || ""}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
          />
          {isSearchActive ? (
            <button type="button" className="graph-search-palette-clear" onClick={handleClear}>
              초기화
            </button>
          ) : null}
          <kbd className="graph-search-palette-kbd">{MOD_KEY_LABEL}+K</kbd>
        </form>

        {canShowResults && showSuggestions ? (
          <div className="graph-search-palette-results" role="listbox" aria-label="인물 검색 결과">
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
                        {getSuggestionDisplayName(suggestion)}
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
                <SearchX size={32} className="graph-search-empty-icon" aria-hidden />
                <div className="graph-search-empty-title">검색 결과 없음</div>
                <div className="graph-search-empty-desc">다른 검색어를 시도해보세요</div>
              </div>
            )}
          </div>
        ) : (
          <div className="graph-search-palette-hint">
            이름 2글자 이상 입력 · Esc로 닫기
          </div>
        )}
      </div>
    </div>,
    document.body
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
    isSearchActive,
    suggestions = [],
    showSuggestions = false,
    selectedIndex = -1,
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
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target?.isContentEditable) {
        if (!paletteOpen) return;
      }
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
          aria-label={isSearchActive ? `인물 검색 (활성: ${searchTerm})` : "인물 검색"}
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
