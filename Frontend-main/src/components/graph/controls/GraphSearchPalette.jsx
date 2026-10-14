/** 인물 검색 팔레트 (⌘/Ctrl+K) */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, SearchX } from "lucide-react";
import { pickCharacterDisplayName } from "../../../utils/graph/graphCharacterNames.js";
import { findExactSuggestionMatch } from "../../../utils/graph/graphHighlight.js";
import "../styles/graph.css";

function getSuggestionDisplayName(suggestion) {
  return pickCharacterDisplayName(suggestion) || "Unknown";
}

export default function GraphSearchPalette({
  modKeyLabel,
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
          <kbd className="graph-search-palette-kbd">{modKeyLabel}+K</kbd>
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
