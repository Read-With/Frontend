import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { useClickOutside } from "../../hooks/ui/tooltipHooks";
import { findExactSuggestionMatch } from "../../utils/graph/graphCy.js";
import { GRAPH_CHARACTER_FILTER_STAGE_OPTIONS } from "../../utils/graph/graphCore.js";
import "./RelationGraph.css";

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

EdgeLabelToggle.propTypes = {
  visible: PropTypes.bool.isRequired,
  onToggle: PropTypes.func.isRequired,
};

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

CharacterFilterSegmented.propTypes = {
  value: PropTypes.number.isRequired,
  onChange: PropTypes.func.isRequired,
};

const LEGEND_HINT_SESSION_KEY = "rw-graph-legend-hint-seen";

function readLegendHintSeen() {
  try {
    return sessionStorage.getItem(LEGEND_HINT_SESSION_KEY) === "1";
  } catch {
    return true;
  }
}

function markLegendHintSeen() {
  try {
    sessionStorage.setItem(LEGEND_HINT_SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

function GraphLegendPanel({ id, className = "" }) {
  return (
    <aside id={id} className={`graph-canvas-legend ${className}`.trim()} aria-label="그래프 범례">
      <p className="graph-canvas-legend-title">범례</p>
      <div className="graph-canvas-legend-row graph-canvas-legend-row--tone">
        <div className="graph-canvas-legend-tone" aria-hidden>
          <span className="graph-canvas-legend-tone-end">비호의</span>
          <span className="graph-canvas-legend-swatch" />
          <span className="graph-canvas-legend-tone-end">호의</span>
        </div>
        <span className="graph-canvas-legend-caption">관계 색</span>
      </div>
      <div className="graph-canvas-legend-row">
        <span className="graph-canvas-legend-size" aria-hidden>
          <span className="graph-canvas-legend-dot graph-canvas-legend-dot--lg" />
          <span className="graph-canvas-legend-dot graph-canvas-legend-dot--sm" />
        </span>
        <span>크기 = 중요도</span>
      </div>
      <div className="graph-canvas-legend-row">
        <span className="graph-canvas-legend-main" aria-hidden>
          <span className="graph-canvas-legend-main-ring" />
        </span>
        <span>주요 인물</span>
      </div>
    </aside>
  );
}

GraphLegendPanel.propTypes = {
  id: PropTypes.string,
  className: PropTypes.string,
};

/**
 * @param {"toolbar"|"dock"} variant
 * toolbar: 상단 토글 + 세션 1회 자동 오픈/힌트
 * dock: 단독 화면 좌하단 고정 미니 범례 (접기 가능)
 */
function GraphCanvasLegend({ variant = "toolbar" }) {
  const isDock = variant === "dock";
  const [hintSeen, setHintSeen] = useState(readLegendHintSeen);
  const [open, setOpen] = useState(() => (isDock ? true : !readLegendHintSeen()));
  const rootRef = useClickOutside(() => {
    if (!isDock) {
      setOpen(false);
      markLegendHintSeen();
      setHintSeen(true);
    }
  }, open && !isDock);
  const panelId = isDock ? "graph-canvas-legend-dock" : "graph-canvas-legend-panel";

  useEffect(() => {
    if (isDock || hintSeen || !open) return undefined;
    const timer = window.setTimeout(() => {
      markLegendHintSeen();
      setHintSeen(true);
      setOpen(false);
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [hintSeen, open, isDock]);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      markLegendHintSeen();
      setHintSeen(true);
      return next;
    });
  };

  if (isDock) {
    return (
      <div className={`graph-legend-dock ${open ? "is-open" : "is-collapsed"}`} ref={rootRef}>
        {open ? <GraphLegendPanel id={panelId} className="is-dock" /> : null}
        <button
          type="button"
          className={`graph-floating-btn graph-legend-dock-toggle ${!hintSeen ? "has-hint" : ""}`}
          aria-label={open ? "범례 접기" : "범례 보기"}
          title="범례"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={toggle}
        >
          <span className="material-symbols-outlined" aria-hidden>
            legend_toggle
          </span>
          {!hintSeen ? <span className="graph-legend-hint-dot" aria-hidden /> : null}
        </button>
      </div>
    );
  }

  return (
    <div className="graph-floating-legend" ref={rootRef}>
      <button
        type="button"
        className={`graph-floating-btn ${!hintSeen ? "has-hint" : ""}`}
        aria-label={open ? "범례 닫기" : "범례 보기"}
        title="범례"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={toggle}
      >
        <span className="material-symbols-outlined" aria-hidden>
          legend_toggle
        </span>
        {!hintSeen ? <span className="graph-legend-hint-dot" aria-hidden /> : null}
      </button>
      {open ? <GraphLegendPanel id={panelId} /> : null}
    </div>
  );
}

GraphCanvasLegend.propTypes = {
  variant: PropTypes.oneOf(["toolbar", "dock"]),
};

function useModKeyLabel() {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    setMod(isMac ? "⌘" : "Ctrl");
  }, []);
  return mod;
}

export function GraphSearchPalette({
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
  onCloseSuggestions,
  isSearchActive = false,
}) {
  const inputRef = useRef(null);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const trimmedTerm = (searchTerm || "").trim();
  const canShowResults = open && trimmedTerm.length >= 2;
  const modKey = useModKeyLabel();

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
        onCloseSuggestions?.();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose, onCloseSuggestions]);

  const showToastMessage = useCallback((message) => {
    setToastMessage(message);
    setShowToast(true);
    window.setTimeout(() => setShowToast(false), 3000);
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
      const displayName = suggestion.label || suggestion.common_name || "Unknown";
      onSearchSubmit(displayName);
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
        onClick={() => {
          onCloseSuggestions?.();
          onClose();
        }}
      />
      <div className="graph-search-palette-panel">
        {showToast ? <div className="graph-search-toast is-palette">{toastMessage}</div> : null}

        <form
          className="graph-search-palette-form"
          onSubmit={(e) => {
            e.preventDefault();
            trySubmitSearch();
          }}
        >
          <span className="material-symbols-outlined graph-search-palette-icon" aria-hidden>
            search
          </span>
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
          <kbd className="graph-search-palette-kbd">{modKey}+K</kbd>
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

GraphSearchPalette.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  searchTerm: PropTypes.string,
  onSearchSubmit: PropTypes.func.isRequired,
  onClearSearch: PropTypes.func.isRequired,
  onGenerateSuggestions: PropTypes.func.isRequired,
  suggestions: PropTypes.arrayOf(PropTypes.any),
  showSuggestions: PropTypes.bool,
  selectedIndex: PropTypes.number,
  onSelectedIndexChange: PropTypes.func,
  onKeyDown: PropTypes.func,
  onCloseSuggestions: PropTypes.func,
  isSearchActive: PropTypes.bool,
};

/**
 * 캔버스 코너 플로팅 도크: 검색 팔레트 · 필터 · 간선 라벨 · (선택) 범례
 */
export function GraphFloatingControls({
  searchState,
  searchActions,
  edgeLabelVisible,
  onToggleEdgeLabel,
  filterStage,
  onFilterChange,
  showLegend = true,
  placement = "dock",
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useClickOutside(() => setOptionsOpen(false), optionsOpen);
  const modKey = useModKeyLabel();
  const isToolbar = placement === "toolbar";

  const {
    searchTerm,
    isSearchActive,
    suggestions = [],
    showSuggestions = false,
    selectedIndex = -1,
  } = searchState;

  const {
    onSearchSubmit,
    onClearSearch,
    onGenerateSuggestions,
    onKeyDown,
    onCloseSuggestions,
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

  const filterLabel =
    GRAPH_CHARACTER_FILTER_STAGE_OPTIONS.find((o) => o.value === filterStage)?.label ?? "필터";

  return (
    <>
      <div
        className={`graph-floating-dock${isToolbar ? " is-toolbar" : ""}`}
        aria-label="그래프 도구"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`graph-floating-btn${isSearchActive ? " is-active" : ""}`}
          aria-label={isSearchActive ? `인물 검색 (활성: ${searchTerm})` : "인물 검색"}
          title={`인물 검색 (${modKey}+K)`}
          aria-haspopup="dialog"
          aria-expanded={paletteOpen}
          onClick={openPalette}
        >
          <span className="material-symbols-outlined" aria-hidden>
            search
          </span>
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
            <span className="material-symbols-outlined" aria-hidden>
              tune
            </span>
          </button>
          {optionsOpen ? (
            <div className="graph-floating-options-panel" role="menu" aria-label="표시 옵션">
              <div className="graph-topbar-more-section" role="none">
                <span className="graph-topbar-more-label">간선</span>
                <EdgeLabelToggle
                  visible={edgeLabelVisible}
                  onToggle={() => {
                    onToggleEdgeLabel();
                  }}
                />
              </div>
              <div className="graph-topbar-more-section" role="none">
                <span className="graph-topbar-more-label">인물 필터</span>
                <CharacterFilterSegmented value={filterStage} onChange={onFilterChange} />
              </div>
            </div>
          ) : null}
        </div>

        {showLegend && isToolbar ? <GraphCanvasLegend variant="toolbar" /> : null}
      </div>

      {showLegend && !isToolbar ? <GraphCanvasLegend variant="dock" /> : null}

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
        onCloseSuggestions={onCloseSuggestions}
        isSearchActive={isSearchActive}
      />
    </>
  );
}

GraphFloatingControls.propTypes = {
  searchState: PropTypes.shape({
    searchTerm: PropTypes.string,
    isSearchActive: PropTypes.bool,
    suggestions: PropTypes.arrayOf(PropTypes.any),
    showSuggestions: PropTypes.bool,
    selectedIndex: PropTypes.number,
  }).isRequired,
  searchActions: PropTypes.shape({
    onSearchSubmit: PropTypes.func.isRequired,
    onClearSearch: PropTypes.func.isRequired,
    onGenerateSuggestions: PropTypes.func.isRequired,
    onKeyDown: PropTypes.func,
    onCloseSuggestions: PropTypes.func,
    onSelectedIndexChange: PropTypes.func,
  }).isRequired,
  edgeLabelVisible: PropTypes.bool.isRequired,
  onToggleEdgeLabel: PropTypes.func.isRequired,
  filterStage: PropTypes.number.isRequired,
  onFilterChange: PropTypes.func.isRequired,
  showLegend: PropTypes.bool,
  placement: PropTypes.oneOf(["dock", "toolbar"]),
};
