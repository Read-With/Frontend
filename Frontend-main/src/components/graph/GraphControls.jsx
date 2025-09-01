import React, { useRef, useEffect, useCallback, useState } from "react";
import { FaSearch, FaUndo } from "react-icons/fa";
import { useClickOutside } from "../../hooks/useClickOutside";
import { graphControlsStyles } from "../../utils/styles/styles.js";

function GraphControls({
  searchTerm,
  onSearchSubmit,
  onClearSearch,
  onGenerateSuggestions, // 제안 생성을 위한 새로운 prop
  suggestions = [],
  showSuggestions = false,
  selectedIndex = -1,
  onSelectSuggestion,
  onKeyDown,
  onCloseSuggestions,
  isSearchActive = false
}) {
  const [internalSearchTerm, setInternalSearchTerm] = useState(searchTerm || "");
  const [internalShowSuggestions, setInternalShowSuggestions] = useState(showSuggestions);
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(selectedIndex);
  const inputRef = useRef(null);

  // 외부 상태와 동기화
  useEffect(() => {
    setInternalSearchTerm(searchTerm || "");
  }, [searchTerm]);

  useEffect(() => {
    setInternalShowSuggestions(showSuggestions);
  }, [showSuggestions]);

  useEffect(() => {
    setInternalSelectedIndex(selectedIndex);
  }, [selectedIndex]);

  // 제안 표시 조건: 외부 제안이 있고 내부 검색어가 2글자 이상일 때
  useEffect(() => {
    // 선택된 인물이 있으면 드롭다운 숨기기 (검색 결과만 표시)
    if (internalSearchTerm && suggestions && suggestions.length > 0) {
      const hasSelectedSuggestion = suggestions.some(s => s.label === internalSearchTerm);
      if (hasSelectedSuggestion) {
        setInternalShowSuggestions(false);
        setInternalSelectedIndex(-1);
        return;
      }
    }
    
    const shouldShowSuggestions = (suggestions && suggestions.length > 0) && 
                                 (internalSearchTerm.trim().length >= 2);
    
    setInternalShowSuggestions(shouldShowSuggestions);
    
    if (!shouldShowSuggestions) {
      setInternalSelectedIndex(-1);
    }
  }, [suggestions, internalSearchTerm]);

  // 검색 초기화 함수
  const handleClearSearch = useCallback(() => {
    onClearSearch();
  }, [onClearSearch]);

  // 제안 생성을 위한 함수
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    setInternalSearchTerm(newValue);
    
    // 검색어가 2글자 이상일 때 제안만 생성 (실제 검색은 하지 않음)
    if (newValue.trim().length >= 2) {
      onGenerateSuggestions(newValue);
    } else {
      // 검색어가 2글자 미만일 때 제안 숨기기
      setInternalShowSuggestions(false);
      setInternalSelectedIndex(-1);
    }
  }, [onGenerateSuggestions]);

  // 키보드 이벤트 처리 (Enter 키만 처리)
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Enter 키를 눌렀을 때만 실제 검색 실행
      if (internalSearchTerm.trim().length >= 2) {
        onSearchSubmit(internalSearchTerm);
      }
    } else {
      // 다른 키는 기존 제안 네비게이션 처리
      onKeyDown(e, (selectedTerm) => {
        if (selectedTerm) {
          onSearchSubmit(selectedTerm);
        }
      });
    }
  }, [internalSearchTerm, onSearchSubmit, onKeyDown]);
  
  // 외부 클릭 감지
  const dropdownRef = useClickOutside(() => {
    onCloseSuggestions();
  });

  // 제안 선택 함수
  const handleSelectSuggestion = useCallback((suggestion) => {
    if (suggestion && suggestion.label) {
      // 선택된 인물 이름을 검색창에 설정
      setInternalSearchTerm(suggestion.label);
      
      // 드롭다운 완전히 숨기기
      setInternalShowSuggestions(false);
      setInternalSelectedIndex(-1);
      
      // 선택된 인물로 실제 검색 실행
      onSearchSubmit(suggestion.label);
    }
  }, [onSearchSubmit]);

  // 폼 제출 처리 함수
  const handleFormSubmit = useCallback((e) => {
    e.preventDefault();
    
    if (internalSearchTerm.trim()) {
      // 검색어가 있을 때: 초기화 버튼으로 동작
      handleClearSearch();
    } else {
      // 검색어가 없을 때: 검색 버튼으로 동작 (하지만 검색할 내용이 없음)
      // 실제로는 아무 동작 안함
      return;
    }
  }, [internalSearchTerm, handleClearSearch]);

  // 검색 버튼 클릭 핸들러
  const handleSearchButtonClick = useCallback((e) => {
    e.preventDefault();
    
    const trimmedTerm = internalSearchTerm.trim();
    
    if (trimmedTerm.length >= 2) {
      // 검색어가 2글자 이상일 때: 검색 실행
      onSearchSubmit(trimmedTerm);
    } else if (trimmedTerm.length === 1) {
      // 검색어가 1글자일 때: 아무 동작 안함
      return;
    } else {
      // 검색어가 없을 때: 아무 동작 안함
      return;
    }
  }, [internalSearchTerm, onSearchSubmit]);

  // 초기화 버튼 클릭 핸들러
  const handleResetButtonClick = useCallback((e) => {
    e.preventDefault();
    handleClearSearch();
  }, [handleClearSearch]);

  return (
    <div ref={dropdownRef} style={graphControlsStyles.container}>
      <form
        style={graphControlsStyles.form}
        onSubmit={handleFormSubmit}
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
            // 2글자 이상일 때만 드롭다운 표시
            if (internalSearchTerm.trim().length >= 2) {
              setInternalShowSuggestions(true);
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
          style={{ 
            ...graphControlsStyles.button, 
            ...(internalSearchTerm.trim() ? graphControlsStyles.resetButton : graphControlsStyles.searchButton)
          }}
          onClick={internalSearchTerm.trim() ? handleResetButtonClick : handleSearchButtonClick}
          onMouseEnter={(e) => {
            if (internalSearchTerm.trim()) {
              e.target.style.background = '#EEF2FF';
            } else {
              e.target.style.background = '#5a7cff';
            }
          }}
          onMouseLeave={(e) => {
            if (internalSearchTerm.trim()) {
              e.target.style.background = '#fff';
            } else {
              e.target.style.background = '#6C8EFF';
            }
          }}
        >
          {internalSearchTerm.trim() ? (
            <>
              <FaUndo size={10} />
              초기화
            </>
          ) : (
            <>
              <FaSearch size={10} />
              검색
            </>
          )}
        </button>
      </form>

      {internalShowSuggestions && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: '0',
          right: '0',
          background: '#fff',
          border: '1px solid #e3e6ef',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.12), 0 4px 16px rgba(0, 0, 0, 0.08)',
          zIndex: 9999,
          maxHeight: '320px',
          overflowY: 'auto',
          marginTop: '8px',
          minWidth: '280px',
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
              {/* 드롭다운 헤더 */}
              <div style={{
                padding: '12px 16px',
                background: '#f8f9fc',
                borderBottom: '1px solid #e3e6ef',
                borderTopLeftRadius: '12px',
                borderTopRightRadius: '12px',
              }}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#6c757d',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}>
                  인물 검색 결과 ({suggestions.length}개)
                </div>
              </div>
              
              {/* 제안 목록 */}
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id || index}
                  style={{
                    padding: '16px 20px',
                    cursor: 'pointer',
                    borderBottom: index < suggestions.length - 1 ? '1px solid #f0f0f0' : 'none',
                    background: index === internalSelectedIndex ? '#f8f9fc' : 'transparent',
                    transition: 'background 0.2s ease',
                    position: 'relative',
                  }}
                  onClick={() => handleSelectSuggestion(suggestion)}
                  onMouseEnter={() => setInternalSelectedIndex(index)}
                  onMouseLeave={() => setInternalSelectedIndex(-1)}
                >
                  {/* 메인 콘텐츠 */}
                  <div>
                    {/* 주요 이름 */}
                    <div style={{ 
                      fontWeight: '700', 
                      fontSize: '15px',
                      color: '#22336b',
                      marginBottom: '6px',
                    }}>
                      {suggestion.label || suggestion.common_name || 'Unknown'}
                    </div>
                    
                    {/* 설명 */}
                    {suggestion.description && (
                      <div style={{ 
                        fontSize: '13px', 
                        color: '#6c757d', 
                        lineHeight: '1.5',
                        marginBottom: '8px',
                        fontWeight: '400',
                      }}>
                        {suggestion.description}
                      </div>
                    )}
                    
                    {/* 다른 이름들 */}
                    {suggestion.names && suggestion.names.length > 0 && (
                      <div style={{ 
                        marginTop: '8px',
                      }}>
                        {/* 구분선 */}
                        <div style={{
                          height: '1px',
                          background: '#e3e6ef',
                          marginBottom: '8px',
                        }} />
                        
                        {/* 다른 이름 라벨 */}
                        <div style={{
                          fontSize: '11px',
                          color: '#8b9bb4',
                          fontWeight: '500',
                          marginBottom: '4px',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}>
                          다른 이름
                        </div>
                        
                        {/* 다른 이름 목록 */}
                        <div style={{
                          fontSize: '12px',
                          color: '#6c757d',
                          fontStyle: 'italic',
                          lineHeight: '1.4',
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
          ) : internalSearchTerm.trim().length >= 2 ? (
            /* 검색 결과 없음 메시지 */
            <div style={{
              padding: '32px 24px',
              textAlign: 'center',
              color: '#6c757d',
              fontSize: '14px',
              background: '#fafbfc',
              borderBottomLeftRadius: '12px',
              borderBottomRightRadius: '12px',
            }}>
              <div style={{ 
                marginBottom: '12px', 
                fontSize: '48px',
                opacity: 0.6,
              }}>
                🔍
              </div>
              <div style={{ 
                fontWeight: '600', 
                marginBottom: '6px',
                color: '#22336b',
                fontSize: '16px',
              }}>
                검색 결과가 없습니다
              </div>
              <div style={{ 
                fontSize: '13px', 
                opacity: 0.7,
                color: '#6c757d',
                lineHeight: '1.4',
              }}>
                다른 검색어를 시도해보세요
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

export default GraphControls;