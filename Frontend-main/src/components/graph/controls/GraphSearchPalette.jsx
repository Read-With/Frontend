/** 인물 검색 팔레트 (⌘/Ctrl+K) */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, SearchX } from "lucide-react";
import { pickCharacterDisplayName } from '../../../utils/graph/graphCore.js';
import { findExactSuggestionMatch } from '../../../utils/graph/graphCy.js';
import "../styles/graph.css";

function getSuggestionDisplayName(suggestion) {
  return pickCharacterDisplayName(suggestion) || "Unknown";
}

const TOAST_MS = 3000;

/** 잠깐 보였다 사라지는 안내 문구 */
function useTimedMessage() {
  const [message, setMessage] = useState("");
  const timerRef = useRef(null);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  const show = useCallback((text) => {
    window.clearTimeout(timerRef.current);
    setMessage(text);
    timerRef.current = window.setTimeout(() => setMessage(""), TOAST_MS);
  }, []);

  return [message, show];
}

/** 열리면 입력창 포커스·전체 선택, Escape(캡처 단계)로 닫기 */
function usePaletteFocusAndEscape(open, inputRef, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const id = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(id);
  }, [open, inputRef]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);
}

function SuggestionOption({ suggestion, active, onSelect, onHover, onLeave }) {
  const aliases = suggestion.names ?? [];
  const hasDetail = Boolean(suggestion.description || aliases.length);
  return (
    <div
      role="option"
      aria-selected={active}
      className={`graph-search-option${active ? " is-active" : ""}`}
      onClick={onSelect}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <div className={`graph-search-option-name${hasDetail ? " has-detail" : ""}`}>
        {getSuggestionDisplayName(suggestion)}
      </div>
      {suggestion.description ? (
        <div className="graph-search-option-desc">{suggestion.description}</div>
      ) : null}
      {aliases.length > 0 ? (
        <div>
          <div className="graph-search-option-alias-rule" />
          <div className="graph-search-option-alias-label">별칭</div>
          <div className="graph-search-option-alias-text">
            {aliases.slice(0, 3).join(", ")}
            {aliases.length > 3 ? "..." : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SuggestionResults({ suggestions, selectedIndex, onSelect, onSelectedIndexChange }) {
  if (suggestions.length === 0) {
    return (
      <div className="graph-search-palette-results" role="listbox" aria-label="인물 검색 결과">
        <div className="graph-search-empty">
          <SearchX size={32} className="graph-search-empty-icon" aria-hidden />
          <div className="graph-search-empty-title">검색 결과 없음</div>
          <div className="graph-search-empty-desc">다른 검색어를 시도해보세요</div>
        </div>
      </div>
    );
  }
  return (
    <div className="graph-search-palette-results" role="listbox" aria-label="인물 검색 결과">
      <div className="graph-search-dropdown-header">
        <div className="graph-search-dropdown-header-title">검색 결과 ({suggestions.length})</div>
      </div>
      {suggestions.map((suggestion, index) => (
        <SuggestionOption
          key={suggestion.id || index}
          suggestion={suggestion}
          active={index === selectedIndex}
          onSelect={() => onSelect(suggestion)}
          onHover={() => onSelectedIndexChange(index)}
          onLeave={() => onSelectedIndexChange(-1)}
        />
      ))}
    </div>
  );
}

export default function GraphSearchPalette({
  modKeyLabel,
  open,
  onClose,
  searchTerm,
  onSearchSubmit,
  onClearSearch,
  onGenerateSuggestions,
  suggestions,
  showSuggestions,
  selectedIndex,
  onSelectedIndexChange,
  onKeyDown,
  isSearchActive,
}) {
  const inputRef = useRef(null);
  const [toastMessage, showToastMessage] = useTimedMessage();
  const trimmedTerm = searchTerm.trim();
  const resultsVisible = open && trimmedTerm.length >= 2 && showSuggestions;

  usePaletteFocusAndEscape(open, inputRef, onClose);

  const submitAndClose = (term) => {
    onSearchSubmit(term);
    onClose();
  };

  // Enter: 후보 중 정확히 일치하는 인물이 있으면 적용, 아니면 목록에서 고르도록 안내
  const trySubmitSearch = () => {
    if (trimmedTerm.length < 2) return;
    if (findExactSuggestionMatch(suggestions, trimmedTerm)) {
      submitAndClose(trimmedTerm);
    } else if (suggestions.length > 0) {
      showToastMessage("여러 후보가 있습니다. 목록에서 선택해주세요.");
    }
  };

  const handleKeyDown = (e) => {
    if (e.key !== "Enter") {
      onKeyDown(e);
      return;
    }
    e.preventDefault();
    trySubmitSearch();
  };

  if (!open) return null;

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
            aria-expanded={resultsVisible}
            value={searchTerm}
            onChange={(e) => onGenerateSuggestions(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {isSearchActive ? (
            <button
              type="button"
              className="graph-search-palette-clear"
              onClick={() => {
                onClearSearch();
                onClose();
              }}
            >
              초기화
            </button>
          ) : null}
          <kbd className="graph-search-palette-kbd">{modKeyLabel}+K</kbd>
        </form>

        {resultsVisible ? (
          <SuggestionResults
            suggestions={suggestions}
            selectedIndex={selectedIndex}
            onSelect={(suggestion) => submitAndClose(getSuggestionDisplayName(suggestion))}
            onSelectedIndexChange={onSelectedIndexChange}
          />
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
