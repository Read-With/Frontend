import React, { useRef, useState, useEffect } from "react";
import { FaSearch, FaUndo } from "react-icons/fa";
import { useClickOutside } from "../../hooks/useClickOutside";
import { highlightText, buildSuggestions } from "../../utils/searchUtils.jsx";

const GraphControls = ({
  elements = [], // 그래프 요소들 (검색 제안용)
  currentChapterData = null, // 현재 챕터의 캐릭터 데이터
  searchTerm = "", // 부모에서 전달받은 검색어
  isSearchActive = false, // 부모에서 전달받은 검색 상태
  onSearchSubmit = () => {}, // 부모의 검색 제출 함수
  onClearSearch = () => {}, // 부모의 검색 초기화 함수
}) => {
  const inputRef = useRef(null);
  
  // 로컬 검색어 상태
  const [inputValue, setInputValue] = useState(searchTerm);
  
  // 검색 제안 상태 직접 관리
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  
  // 부모의 searchTerm과 동기화
  useEffect(() => {
    setInputValue(searchTerm);
  }, [searchTerm]);

  // 검색 제안 생성 (2글자 이상일 때만)
  useEffect(() => {
    const matches = buildSuggestions(elements, inputValue, currentChapterData);
    setSuggestions(matches);
    const shouldShow = inputValue.trim().length >= 2;
    setShowSuggestions(shouldShow);
    setSelectedIndex(-1);
  }, [inputValue, elements, currentChapterData]);
  
  // 검색 처리 함수
  const handleSearch = () => {
    if (inputValue.trim().length >= 2) {
      onSearchSubmit(inputValue);
    }
  };
  
  // 검색 초기화 함수
  const handleClearSearch = () => {
    setInputValue("");
    setShowSuggestions(false);
    setSelectedIndex(-1);
    onClearSearch();
  };

  const handleInputChange = (e) => {
    const value = e.target.value;
    setInputValue(value);
  };

  // 검색 실행 함수 (엔터키나 검색 버튼 클릭 시)
  const executeSearch = () => {
    if (inputValue.trim().length >= 2) {
      onSearchSubmit(inputValue);
    }
  };
  
  // 키보드 이벤트 처리
  const handleKeyDown = (e) => {
    switch (e.key) {
      case 'ArrowDown':
        if (showSuggestions && suggestions && suggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < suggestions.length - 1 ? prev + 1 : 0
          );
        }
        break;
      case 'ArrowUp':
        if (showSuggestions && suggestions && suggestions.length > 0) {
          e.preventDefault();
          setSelectedIndex(prev => 
            prev > 0 ? prev - 1 : suggestions.length - 1
          );
        }
        break;
      case 'Enter':
        e.preventDefault();
        if (showSuggestions && selectedIndex >= 0 && suggestions && suggestions[selectedIndex]) {
          handleSelectSuggestion(suggestions[selectedIndex]);
        } else {
          executeSearch();
        }
        break;
      case 'Escape':
        if (showSuggestions) {
          setShowSuggestions(false);
          setSelectedIndex(-1);
        }
        break;
    }
  };
  
  // 외부 클릭 감지를 위한 훅 사용
  const dropdownRef = useClickOutside(() => {
    setShowSuggestions(false);
    setSelectedIndex(-1);
  });

  // 제안 선택 함수
  const handleSelectSuggestion = (suggestion) => {
    setInputValue(suggestion.label);
    onSearchSubmit(suggestion.label);
    setShowSuggestions(false);
    setSelectedIndex(-1);
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
    width: '80px',
    height: '28px',
    padding: '0 12px',
    flexShrink: 0,
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
    width: '80px',
  };

  const formStyle = {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
  };

  const dropdownStyle = {
    position: 'absolute',
    top: '100%',
    left: '0',
    right: '0',
    background: '#fff',
    border: '1px solid #e3e6ef',
    borderRadius: '6px',
    boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
    zIndex: 9999,
    maxHeight: '300px',
    overflowY: 'auto',
    marginTop: '4px',
    minWidth: '200px',
    width: '100%',
    display: 'block',
  };

  const suggestionItemStyle = (isSelected) => ({
    padding: '12px 14px',
    cursor: 'pointer',
    borderBottom: '1px solid #f1f3f4',
    background: isSelected ? '#f8f9fc' : '#fff',
    transition: 'background 0.2s',
    ':hover': {
      background: '#f8f9fc',
    },
  });

  const noResultsStyle = {
    padding: '16px 14px',
    textAlign: 'center',
    color: '#6c757d',
    fontSize: '12px',
    fontStyle: 'italic'
  };

  return (
    <div ref={dropdownRef} style={{ 
      position: 'relative', 
      display: 'inline-block',
      width: 'auto',
      minWidth: '200px',
      zIndex: 99999 // 컨테이너에도 높은 z-index 추가
    }}>
      <form
        style={formStyle}
        onSubmit={(e) => {
          e.preventDefault();
          executeSearch();
        }}
      >
        <input
          ref={inputRef}
          style={defaultInputStyle}
          type="text"
          placeholder="인물 검색 (이름/별칭)"
          value={inputValue}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.style.borderColor = '#6C8EFF';
            e.target.style.background = '#fff';
            e.target.style.boxShadow = '0 0 0 2px rgba(108, 142, 255, 0.1)';
            if (inputValue.trim().length >= 2) {
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
          style={searchButtonStyle}
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
          style={resetButtonStyle}
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
                  onClick={() => handleSelectSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div style={{ fontWeight: '600', fontSize: '14px' }}>
                    {highlightText(suggestion.label, inputValue)}
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
            <div style={noResultsStyle}>
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