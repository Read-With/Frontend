import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import PropTypes from "prop-types";
import { List, Search, SearchX, SlidersHorizontal } from "lucide-react";
import { useClickOutside } from "../../hooks/ui/tooltipHooks";
import { findExactSuggestionMatch } from "../../utils/graph/graphCy.js";
import {
  GRAPH_CHARACTER_FILTER_STAGE_OPTIONS,
  formatGraphEventMetaLabel,
} from "../../utils/graph/graphCore.js";
import { resolveEventOrdinalForDisplay } from "../../utils/viewer/viewerSession";
import { GRAPH_COLORS } from "../../utils/styles/graphStyles.js";
import "./RelationGraph.css";

/** 인물 이미지 없을 때 공통 실루엣 */
export function PersonSilhouette({
  size = 48,
  circleFill = GRAPH_COLORS.border,
  bodyFill = '#bdbdbd',
}) {
  const cx = size / 2;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} fill="none" aria-hidden>
      <circle cx={cx} cy={cx} r={cx} fill={circleFill} />
      <ellipse cx={cx} cy={size * 0.375} rx={size * 0.21} ry={size * 0.21} fill={bodyFill} />
      <ellipse cx={cx} cy={size * 0.79} rx={size * 0.29} ry={size * 0.17} fill={bodyFill} />
    </svg>
  );
}

PersonSilhouette.propTypes = {
  size: PropTypes.number,
  circleFill: PropTypes.string,
  bodyFill: PropTypes.string,
};

/** 노드/간선 툴팁 공통 닫기 버튼 */
export function TooltipCloseButton({ onClose, ariaLabel, className }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={ariaLabel}
      className={['tooltip-close-btn', className].filter(Boolean).join(' ')}
    >
      &times;
    </button>
  );
}

TooltipCloseButton.propTypes = {
  onClose: PropTypes.func,
  ariaLabel: PropTypes.string,
  className: PropTypes.string,
};

export function ActionButton({ variant = 'secondary', onClick, children, ariaLabel, title }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={title}
      className={`tooltip-action-btn tooltip-action-btn--${variant === 'primary' ? 'primary' : 'secondary'}`}
    >
      {children}
    </button>
  );
}

ActionButton.propTypes = {
  variant: PropTypes.oneOf(['primary', 'secondary']),
  onClick: PropTypes.func,
  children: PropTypes.node,
  ariaLabel: PropTypes.string,
  title: PropTypes.string,
};

const Z_INDEX_TOOLTIP = 99999;

/** 플로팅 노드/간선 툴팁 셸 */
export function NodeTooltipShell({
  children,
  shellRef,
  className = 'graph-node-tooltip',
  position,
  zIndex = Z_INDEX_TOOLTIP,
  showContent,
  isDragging,
  handleMouseDown,
  transition,
  closeButton = null,
}) {
  return (
    <div
      ref={shellRef}
      className={className}
      style={{
        left: position.x,
        top: position.y,
        zIndex,
        ...(showContent !== undefined
          ? {
              opacity: showContent ? 1 : 0,
              transition,
              cursor: isDragging ? 'grabbing' : 'grab',
            }
          : null),
      }}
      onMouseDown={handleMouseDown}
    >
      {closeButton}
      {children}
    </div>
  );
}

NodeTooltipShell.propTypes = {
  children: PropTypes.node,
  shellRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  className: PropTypes.string,
  position: PropTypes.shape({
    x: PropTypes.number,
    y: PropTypes.number,
  }),
  zIndex: PropTypes.number,
  showContent: PropTypes.bool,
  isDragging: PropTypes.bool,
  handleMouseDown: PropTypes.func,
  transition: PropTypes.string,
  closeButton: PropTypes.node,
};

export function CenteredStatus({
  children,
  color = GRAPH_COLORS.textSecondary,
  fullHeight = true,
}) {
  return (
    <div
      className={`tooltip-centered-status${fullHeight ? '' : ' tooltip-centered-status--compact'}`}
      style={{ '--status-color': color }}
    >
      {children}
    </div>
  );
}

CenteredStatus.propTypes = {
  children: PropTypes.node,
  color: PropTypes.string,
  fullHeight: PropTypes.bool,
};

function handleProfileImageError(e) {
  e.target.style.display = 'none';
  if (e.target.nextSibling) e.target.nextSibling.style.display = 'block';
}

export function NodeProfileAvatar({ node }) {
  const hasImage = !!node?.hasImage;
  return (
    <div className="profile-image-placeholder">
      <div className="profile-img">
        {hasImage ? (
          <img
            src={node.image}
            alt={node?.displayName || 'character'}
            crossOrigin="anonymous"
            onError={handleProfileImageError}
          />
        ) : null}
        <div style={{ display: hasImage ? 'none' : 'block' }}>
          <PersonSilhouette size={48} />
        </div>
      </div>
    </div>
  );
}

NodeProfileAvatar.propTypes = {
  node: PropTypes.object,
};

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

GraphTopBarMeta.propTypes = {
  chapterLabel: PropTypes.string,
  chapterTitle: PropTypes.string,
  eventLabel: PropTypes.node,
};

/** 분할 상단바: 챕터 + 사건 메타 (계산중 포함) */
export function GraphChapterEventMeta({
  bookId,
  progressTopBar,
  currentEvent,
  prevValidEvent,
  resolvedServerChapter,
  chapterDisplayLabel,
}) {
  const eventNum = resolveEventOrdinalForDisplay({
    currentEvent,
    prevValidEvent,
    currentChapter: resolvedServerChapter,
    progressTopBar: progressTopBar ?? { eventNum: null },
    fallback: 0,
  });

  if (bookId && progressTopBar === undefined && !(eventNum > 0)) {
    return <span className="graph-topbar-meta-event">계산중…</span>;
  }

  return (
    <GraphTopBarMeta
      chapterLabel={chapterDisplayLabel}
      chapterTitle={chapterDisplayLabel}
      eventLabel={formatGraphEventMetaLabel(eventNum > 0 ? eventNum : null)}
    />
  );
}

GraphChapterEventMeta.propTypes = {
  bookId: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  progressTopBar: PropTypes.object,
  currentEvent: PropTypes.any,
  prevValidEvent: PropTypes.any,
  resolvedServerChapter: PropTypes.number,
  chapterDisplayLabel: PropTypes.string,
};

/** 빈/로딩/에러 패널 (분할·전체 그래프) */
export function GraphNoticePanel({ variant, title, description, icon, actions }) {
  const isLoading = variant === 'loading';
  const TitleTag = isLoading ? 'p' : 'h3';

  return (
    <div
      className={`graph-panel-status graph-panel-status--${variant}`}
      role={isLoading ? 'status' : variant === 'error' ? 'alert' : undefined}
      aria-live={isLoading ? 'polite' : undefined}
    >
      <div className={`graph-panel-status-icon graph-panel-status-icon--${variant}`} aria-hidden>
        {icon}
      </div>
      <div className="graph-panel-status-copy">
        <TitleTag className="graph-panel-status-title">{title}</TitleTag>
        {description ? <p className="graph-panel-status-desc">{description}</p> : null}
      </div>
      {actions ? <div className="graph-panel-status-actions">{actions}</div> : null}
    </div>
  );
}

GraphNoticePanel.propTypes = {
  variant: PropTypes.oneOf(['loading', 'empty', 'error']).isRequired,
  title: PropTypes.node,
  description: PropTypes.node,
  icon: PropTypes.node,
  actions: PropTypes.node,
};

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

function getSuggestionDisplayName(suggestion) {
  return suggestion?.label || suggestion?.common_name || "Unknown";
}

function GraphLegendPanel({ id }) {
  return (
    <aside id={id} className="graph-canvas-legend" aria-label="그래프 범례">
      <p className="graph-canvas-legend-title">범례</p>
      <div className="graph-canvas-legend-tone" aria-hidden>
        <span className="graph-canvas-legend-tone-end">부정 (−100%)</span>
        <span className="graph-canvas-legend-swatch" />
        <span className="graph-canvas-legend-tone-end">긍정 (+100%)</span>
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
        <span>굵은 테두리 = 주요 인물</span>
      </div>
    </aside>
  );
}

GraphLegendPanel.propTypes = {
  id: PropTypes.string,
};

/** 범례 토글 + 세션 1회 힌트(첫 진입 시 열림, 자동 닫힘 없음) */
function GraphCanvasLegend() {
  const [hintSeen, setHintSeen] = useState(readLegendHintSeen);
  const [open, setOpen] = useState(() => !readLegendHintSeen());
  const rootRef = useClickOutside(() => {
    setOpen(false);
    markLegendHintSeen();
    setHintSeen(true);
  }, open);
  const panelId = "graph-canvas-legend-panel";

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      markLegendHintSeen();
      setHintSeen(true);
      return next;
    });
  };

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
        <List size={18} aria-hidden />
        {!hintSeen ? <span className="graph-legend-hint-dot" aria-hidden /> : null}
      </button>
      {open ? <GraphLegendPanel id={panelId} /> : null}
    </div>
  );
}

function useModKeyLabel() {
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
    setMod(isMac ? "⌘" : "Ctrl");
  }, []);
  return mod;
}

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
  onCloseSuggestions,
  isSearchActive = false,
}) {
  const inputRef = useRef(null);
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
    window.setTimeout(() => setToastMessage(""), 3000);
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
        onClick={() => {
          onCloseSuggestions?.();
          onClose();
        }}
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
 * 검색 팔레트 · 필터 · 간선 라벨 · (선택) 범례
 */
export function GraphFloatingControls({
  searchState,
  searchActions,
  edgeLabelVisible,
  onToggleEdgeLabel,
  filterStage,
  onFilterChange,
  showLegend = true,
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useClickOutside(() => setOptionsOpen(false), optionsOpen);
  const modKey = useModKeyLabel();

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
        className="graph-floating-dock"
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

        {showLegend ? <GraphCanvasLegend /> : null}
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
};
