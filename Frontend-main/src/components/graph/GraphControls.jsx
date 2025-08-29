import React, { useRef, useEffect, useCallback } from "react";
import { FaSearch, FaUndo } from "react-icons/fa";
import { useClickOutside } from "../../hooks/useClickOutside";
import { useGraphSearch } from "../../hooks/useGraphSearch.jsx";
import { highlightText } from "../../utils/searchUtils.jsx";
import { graphControlsStyles } from "../../utils/styles.js";

const GraphControls = ({
  elements = [],
  currentChapterData = null,
  searchTerm = "",
  onSearchSubmit = () => {},
  onClearSearch = () => {},
}) => {
  const inputRef = useRef(null);
  
  // useGraphSearch 훅 사용으로 검색 로직 통합
  const {
    searchTerm: internalSearchTerm,
    suggestions,
    showSuggestions,
    selectedIndex,
    handleSearchSubmit: internalHandleSearchSubmit,
    clearSearch: internalClearSearch,
    setSearchTerm: setInternalSearchTerm,
    selectSuggestion,
    handleKeyDown: internalHandleKeyDown,
    closeSuggestions,
    setShowSuggestions,
    setSelectedIndex
  } = useGraphSearch(elements, null, currentChapterData);

  // 부모의 searchTerm과 동기화
  useEffect(() => {
    setInternalSearchTerm(searchTerm);
  }, [searchTerm, setInternalSearchTerm]);

  // 검색 실행 함수
  const executeSearch = useCallback(() => {
    if (internalSearchTerm.trim().length >= 2) {
      onSearchSubmit(internalSearchTerm);
    }
  }, [internalSearchTerm, onSearchSubmit]);
  
  // 검색 초기화 함수
  const handleClearSearch = useCallback(() => {
    internalClearSearch();
    onClearSearch();
  }, [internalClearSearch, onClearSearch]);

  const handleInputChange = useCallback((e) => {
    setInternalSearchTerm(e.target.value);
  }, [setInternalSearchTerm]);

  // 키보드 이벤트 처리
  const handleKeyDown = useCallback((e) => {
    internalHandleKeyDown(e, (selectedTerm) => {
      if (selectedTerm) {
        onSearchSubmit(selectedTerm);
      }
    });
  }, [internalHandleKeyDown, onSearchSubmit]);
  
  // 외부 클릭 감지
  const dropdownRef = useClickOutside(() => {
    closeSuggestions();
  });

  // 제안 선택 함수
  const handleSelectSuggestion = useCallback((suggestion) => {
    selectSuggestion(suggestion, (label) => {
      onSearchSubmit(label);
    });
  }, [selectSuggestion, onSearchSubmit]);

  return (
    <div ref={dropdownRef} style={graphControlsStyles.container}>
      <form
        style={graphControlsStyles.form}
        onSubmit={(e) => {
          e.preventDefault();
          executeSearch();
        }}
      >
        <input
          ref={inputRef}
          style={graphControlsStyles.input}
          type="text"
          placeholder="인물 검색 (이름/별칭)"
          value={internalSearchTerm}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.style.borderColor = '#6C8EFF';
            e.target.style.background = '#fff';
            e.target.style.boxShadow = '0 0 0 2px rgba(108, 142, 255, 0.1)';
            if (internalSearchTerm.trim().length >= 2) {
              setShowSuggestions(true);
            }
          }}
          onBlur={(e) => {
            e.target.style.borderColor = '#e3e6ef';
            e.target.style.background = '#f8f9fc';
            e.target.style.boxShadow = 'none';
          }}
        />
        <button
          type="submit"
          style={{ ...graphControlsStyles.button, ...graphControlsStyles.searchButton }}
          onMouseEnter={(e) => {
            e.target.style.background = '#5a7cff';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = '#6C8EFF';
          }}
        >
          <FaSearch size={10} />
          검색
        </button>
        <button
          type="button"
          style={{ ...graphControlsStyles.button, ...graphControlsStyles.resetButton }}
          onClick={handleClearSearch}
          onMouseEnter={(e) => {
            e.target.style.background = '#e9ecef';
          }}
          onMouseLeave={(e) => {
            e.target.style.background = '#f8f9fc';
          }}
        >
          <FaUndo size={10} />
          초기화
        </button>
      </form>

      {showSuggestions && (
        <div style={graphControlsStyles.dropdown}>
          {suggestions.length > 0 ? (
            <>
              <div style={graphControlsStyles.header}>
                검색 결과 ({suggestions.length}개)
              </div>
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  style={graphControlsStyles.suggestionItem(index === selectedIndex)}
                  onClick={() => handleSelectSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div style={{ fontWeight: '600', fontSize: '14px' }}>
                    {highlightText(suggestion.label, internalSearchTerm)}
                  </div>
                  {suggestion.common_name && (
                    <div style={{ fontSize: '12px', color: '#6c757d' }}>
                      별칭: {suggestion.common_name}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: '#999' }}>
                    {suggestion.matchType === 'label' ? '이름 일치' : 
                     suggestion.matchType === 'names' ? '별칭 일치' : 
                     suggestion.matchType === 'common_name' ? '공통명 일치' : '일치'}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={graphControlsStyles.noResults}>
              <div style={{ marginBottom: '4px', fontWeight: '500' }}>
                검색 결과가 없습니다
              </div>
              <div style={{ fontSize: '11px', color: '#999' }}>
                다른 검색어를 입력해보세요
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GraphControls;