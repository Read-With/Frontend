import React, { useState, useEffect, useRef } from "react";
import { FaSearch, FaUndo } from "react-icons/fa";
import { highlightText } from "../../utils/search.jsx";
import { useGraphSearch } from "../../hooks/useGraphSearch";
import { useClickOutside } from "../../hooks/useClickOutside";

const GraphControls = ({
  onSearchSubmit = () => {}, // 부모 컴포넌트에 검색 결과를 전달하는 콜백
  searchTerm = "", // 현재 검색어
  isSearchActive = false, // 검색 활성화 상태
  clearSearch = () => {}, // 검색 초기화 함수
  elements = [], // 그래프 요소들 (검색 제안용)
}) => {
  // 내부 상태 관리
  const [searchInput, setSearchInput] = useState(searchTerm);
  const [search, setSearch] = useState(searchTerm);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  
  const inputRef = useRef(null);
  
  // 외부 클릭 감지를 위한 훅 사용
  const dropdownRef = useClickOutside(() => {
    setShowSuggestions(false);
    setIsDropdownOpen(false);
  });

  // 검색 제안 관리를 useGraphSearch 훅으로 처리
  const {
    searchTerm: graphSearchTerm,
    suggestions,
    showSuggestions,
    selectedIndex,
    selectSuggestion,
    handleKeyDown,
    closeSuggestions,
    setShowSuggestions,
    setSelectedIndex,
    setSearchTerm: setGraphSearchTerm
  } = useGraphSearch(elements, null);

  // 외부 searchTerm이 변경되면 내부 상태도 업데이트
  useEffect(() => {
    setSearchInput(searchTerm);
    setSearch(searchTerm);
    setGraphSearchTerm(searchTerm);
  }, [searchTerm, setGraphSearchTerm]);



  // 내부 검색 처리 함수
  const handleSearch = () => {
    const trimmedSearch = searchInput.trim();
    if (trimmedSearch.length >= 2) {
      setSearch(trimmedSearch);
      onSearchSubmit(trimmedSearch);
    }
  };

  // 검색 초기화 함수
  const handleClearSearch = () => {
    setSearchInput("");
    setSearch("");
    clearSearch();
  };

  // 기본 스타일 정의
  const defaultInputStyle = {
    width: '180px',
    minWidth: '150px',
    maxWidth: '220px',
    border: '1px solid #e3e6ef',
    borderRadius: '6px',
    fontSize: '12px',
    color: '#42506b',
    background: '#f8f9fc',
    transition: 'all 0.2s',
    outline: 'none',
    height: '28px',
    padding: '0 8px',
  };

  const defaultButtonStyle = {
    background: '#6C8EFF',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    border: 'none',
    borderRadius: '6px',
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    width: '80px', // 고정된 너비 설정
    height: '28px',
    padding: '0 12px',
    flexShrink: 0, // 크기 고정
  };

  // 검색 버튼 스타일 (파란색)
  const searchButtonStyle = {
    ...defaultButtonStyle,
    background: '#6C8EFF',
    color: '#fff',
  };

  // 초기화 버튼 스타일 (회색)
  const resetButtonStyle = {
    ...defaultButtonStyle,
    background: '#f8f9fc',
    color: '#6c757d',
    border: '1px solid #e3e6ef',
    width: '80px', // 초기화 버튼만 80px로 변경
  };

  const formStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '0',
    background: 'transparent',
    borderRadius: '0',
    boxShadow: 'none',
    margin: '0',
    width: 'fit-content',
    maxWidth: '400px',
    position: 'relative'
  };

  const dropdownStyle = {
    position: 'absolute',
    top: '100%',
    left: '0',
    right: '0',
    background: '#fff',
    border: '1px solid #e3e6ef',
    borderRadius: '8px',
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)',
    zIndex: 1000,
    maxHeight: '240px',
    overflowY: 'auto',
    marginTop: '4px',
    minWidth: '280px'
  };

  const suggestionItemStyle = (isSelected) => ({
    padding: '10px 14px',
    cursor: 'pointer',
    fontSize: '13px',
    borderBottom: '1px solid #f5f5f5',
    background: isSelected ? '#f0f7ff' : 'transparent',
    color: isSelected ? '#6C8EFF' : '#42506b',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    transition: 'all 0.15s ease',
    '&:hover': {
      background: isSelected ? '#f0f7ff' : '#f8f9fc'
    }
  });

  const noResultsStyle = {
    padding: '12px 14px',
    fontSize: '13px',
    color: '#6c757d',
    textAlign: 'center',
    fontStyle: 'italic'
  };



  return (
    <div ref={dropdownRef} style={{ position: 'relative' }}>
      <form
        style={formStyle}
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch();
        }}
      >
        <input
          ref={inputRef}
          style={defaultInputStyle}
          type="text"
          placeholder="인물 검색 (이름/별칭)"
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.target.value);
            setGraphSearchTerm(e.target.value);
          }}
          onKeyDown={(e) => handleKeyDown(e, onSearchSubmit)}
          onFocus={(e) => {
            e.target.style.borderColor = '#6C8EFF';
            e.target.style.background = '#fff';
            e.target.style.boxShadow = '0 0 0 2px rgba(108, 142, 255, 0.1)';
            if (suggestions.length > 0) {
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
          style={isSearchActive ? resetButtonStyle : searchButtonStyle}
          onClick={isSearchActive ? handleClearSearch : handleSearch}
          onMouseEnter={(e) => {
            if (isSearchActive) {
              e.target.style.background = '#e9ecef';
              e.target.style.boxShadow = '0 2px 8px rgba(108, 142, 255, 0.1)';
            } else {
              e.target.style.background = '#5A7BFF';
              e.target.style.boxShadow = '0 2px 8px rgba(108, 142, 255, 0.2)';
            }
            e.target.style.transform = 'translateY(-1px)';
          }}
          onMouseLeave={(e) => {
            if (isSearchActive) {
              e.target.style.background = '#f8f9fc';
              e.target.style.boxShadow = 'none';
            } else {
              e.target.style.background = '#6C8EFF';
              e.target.style.boxShadow = 'none';
            }
            e.target.style.transform = 'translateY(0)';
          }}
          onMouseDown={(e) => {
            e.target.style.transform = 'translateY(0)';
          }}
        >
          {isSearchActive ? <FaUndo size={10} /> : <FaSearch size={10} />}
          <span style={{ fontSize: '12px' }}>
            {isSearchActive ? '초기화' : '검색'}
          </span>
        </button>
      </form>

      {/* 검색 제안 드롭다운 */}
      {showSuggestions && (
        <div style={dropdownStyle}>
          {suggestions.length > 0 ? (
            <>
              <div style={{ 
                padding: '8px 14px', 
                fontSize: '11px', 
                color: '#6c757d', 
                background: '#f8f9fc',
                borderBottom: '1px solid #e3e6ef',
                fontWeight: '500'
              }}>
                검색 결과 ({suggestions.length}개)
              </div>
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id}
                  style={suggestionItemStyle(index === selectedIndex)}
                  onClick={() => selectSuggestion(suggestion, onSearchSubmit)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div style={{ fontWeight: '600', fontSize: '14px' }}>
                    {highlightText(suggestion.label, searchInput)}
                  </div>
                  {suggestion.names.length > 0 && (
                    <div style={{ fontSize: '12px', color: '#6c757d' }}>
                      별칭: {suggestion.names.join(', ')}
                    </div>
                  )}
                  {suggestion.common_name && (
                    <div style={{ fontSize: '12px', color: '#6c757d' }}>
                      공통 이름: {suggestion.common_name}
                    </div>
                  )}
                  <div style={{ fontSize: '10px', color: '#999' }}>
                    {suggestion.matchType === 'label' ? '이름 일치' : 
                     suggestion.matchType === 'names' ? '별칭 일치' : '공통 이름 일치'}
                  </div>
                </div>
              ))}
            </>
          ) : (
            <div style={noResultsStyle}>
              <div style={{ marginBottom: '4px', fontWeight: '500' }}>
                검색 결과가 없습니다
              </div>
              <div style={{ fontSize: '11px', color: '#999' }}>
                "{searchInput}"와 일치하는 인물을 찾을 수 없습니다
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default GraphControls;