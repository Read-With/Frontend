import React, { useRef, useEffect, useCallback, useState } from "react";
import { useClickOutside } from "../../hooks/ui/useClickOutside";
import { graphControlsStyles } from "../../utils/styles/styles.js";

function GraphControls({
  searchTerm,
  onSearchSubmit,
  onClearSearch,
  onGenerateSuggestions,
  suggestions = [],
  showSuggestions = false,
  selectedIndex = -1,
  onSelectSuggestion: _onSelectSuggestion,
  onKeyDown,
  onCloseSuggestions,
  isSearchActive = false
}) {
  const [internalSearchTerm, setInternalSearchTerm] = useState(searchTerm || "");
  const [internalShowSuggestions, setInternalShowSuggestions] = useState(showSuggestions);
  const [internalSelectedIndex, setInternalSelectedIndex] = useState(selectedIndex);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const inputRef = useRef(null);

  // 토스트 메시지 표시 함수
  const showToastMessage = useCallback((message) => {
    setToastMessage(message);
    setShowToast(true);
    // 3초 후 토스트 메시지 자동 숨김
    setTimeout(() => {
      setShowToast(false);
    }, 3000);
  }, []);

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

  const handleClearSearch = useCallback(() => {
    onClearSearch();
  }, [onClearSearch]);

  // 제안 생성을 위한 함수
  const handleInputChange = useCallback((e) => {
    const newValue = e.target.value;
    setInternalSearchTerm(newValue);
    
    if (newValue.trim().length >= 2) {
      onGenerateSuggestions(newValue);
    } else {
      setInternalShowSuggestions(false);
      setInternalSelectedIndex(-1);
    }
  }, [onGenerateSuggestions]);

  // 키보드 이벤트 처리
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmedTerm = internalSearchTerm.trim();
      if (trimmedTerm.length >= 2) {
        // 정확히 일치하는 인물이 있는지 확인
        const exactMatch = suggestions.find(suggestion => 
          suggestion.label?.toLowerCase() === trimmedTerm.toLowerCase() ||
          suggestion.common_name?.toLowerCase() === trimmedTerm.toLowerCase() ||
          suggestion.names?.some(name => String(name).toLowerCase() === trimmedTerm.toLowerCase())
        );
        
        if (exactMatch) {
          onSearchSubmit(trimmedTerm);
        } else if (suggestions.length > 0) {
          // 정확히 일치하는 인물이 없고 여러 후보가 있으면 토스트 메시지 표시
          showToastMessage("여러 후보가 있습니다. 드롭다운에서 선택해주세요.");
        }
      }
    } else {
      // 화살표 키 등 다른 키 처리
      if (onKeyDown) {
        onKeyDown(e, (selectedTerm) => {
          if (selectedTerm) {
            setInternalSearchTerm(selectedTerm);
            // 키보드로 선택한 인물에 대해 즉시 검색 실행
            onSearchSubmit(selectedTerm);
          }
        });
      }
    }
  }, [internalSearchTerm, onSearchSubmit, onKeyDown, suggestions, showToastMessage]);
  
  const dropdownRef = useClickOutside(() => {
    onCloseSuggestions();
  }, internalShowSuggestions);

  // 제안 선택 함수
  const handleSelectSuggestion = useCallback((suggestion) => {
    if (suggestion) {
      // 드롭다운에서 표시되는 이름과 동일한 이름을 검색창에 입력
      const displayName = suggestion.label || suggestion.common_name || 'Unknown';
      setInternalSearchTerm(displayName);
      setInternalShowSuggestions(false);
      setInternalSelectedIndex(-1);
      // 선택한 인물에 대해 즉시 검색 실행
      onSearchSubmit(displayName);
    }
  }, [onSearchSubmit]);

  const handleFormSubmit = useCallback((e) => {
    e.preventDefault();
    
    const trimmedTerm = internalSearchTerm.trim();
    if (trimmedTerm.length >= 2) {
      // 정확히 일치하는 인물이 있는지 확인
      const exactMatch = suggestions.find(suggestion => 
        suggestion.label?.toLowerCase() === trimmedTerm.toLowerCase() ||
        suggestion.common_name?.toLowerCase() === trimmedTerm.toLowerCase() ||
        suggestion.names?.some(name => String(name).toLowerCase() === trimmedTerm.toLowerCase())
      );
      
      if (exactMatch) {
        onSearchSubmit(trimmedTerm);
      } else if (suggestions.length > 0) {
        // 정확히 일치하는 인물이 없고 여러 후보가 있으면 토스트 메시지 표시
        showToastMessage("여러 후보가 있습니다. 드롭다운에서 선택해주세요.");
      }
    }
  }, [internalSearchTerm, onSearchSubmit, suggestions, showToastMessage]);

  // 검색 버튼 클릭 핸들러
  const handleSearchButtonClick = useCallback((e) => {
    e.preventDefault();
    
    const trimmedTerm = internalSearchTerm.trim();
    
    if (trimmedTerm.length >= 2) {
      // 정확히 일치하는 인물이 있는지 확인
      const exactMatch = suggestions.find(suggestion => 
        suggestion.label?.toLowerCase() === trimmedTerm.toLowerCase() ||
        suggestion.common_name?.toLowerCase() === trimmedTerm.toLowerCase() ||
        suggestion.names?.some(name => String(name).toLowerCase() === trimmedTerm.toLowerCase())
      );
      
      if (exactMatch) {
        onSearchSubmit(trimmedTerm);
      } else if (suggestions.length > 0) {
        // 정확히 일치하는 인물이 없고 여러 후보가 있으면 토스트 메시지 표시
        showToastMessage("여러 후보가 있습니다. 드롭다운에서 선택해주세요.");
      }
    }
  }, [internalSearchTerm, onSearchSubmit, suggestions, showToastMessage]);

  const handleResetButtonClick = useCallback((e) => {
    e.preventDefault();
    handleClearSearch();
  }, [handleClearSearch]);

  return (
    <div ref={dropdownRef} style={graphControlsStyles.container}>
      {/* 토스트 메시지 */}
      {showToast && (
        <div style={{
          position: 'absolute',
          top: '0',
          left: '100%',
          marginLeft: '12px',
          background: '#5C6F5C',
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
          ref={inputRef}
          style={graphControlsStyles.input}
          type="text"
          placeholder="인물 검색"
          value={internalSearchTerm}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            e.target.style.borderColor = '#5C6F5C';
            e.target.style.background = '#fff';
            e.target.style.boxShadow = '0 0 0 2px rgba(92, 111, 92, 0.1)';
            if (internalSearchTerm.trim().length >= 2) {
              setInternalShowSuggestions(true);
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

      {/* 드롭다운 - 검색어가 있을 때만 표시 */}
      {internalShowSuggestions && internalSearchTerm && internalSearchTerm.trim().length >= 2 && (
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
              {/* 드롭다운 헤더 */}
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
              
              {/* 제안 목록 */}
              {suggestions.map((suggestion, index) => (
                <div
                  key={suggestion.id || index}
                  style={{
                    padding: '20px 28px',
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
                      fontWeight: '900', 
                      fontSize: '20px',
                      color: '#5C6F5C',
                      marginBottom: '8px',
                    }}>
                      {suggestion.label || suggestion.common_name || 'Unknown'}
                    </div>
                    
                    {/* 설명 */}
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
                    
                    {/* 다른 이름들 */}
                    {suggestion.names && suggestion.names.length > 0 && (
                      <div style={{ 
                        marginTop: '8px',
                      }}>
                        {/* 구분선 */}
                        <div style={{
                          height: '1px',
                          background: '#e5e7eb',
                          marginBottom: '8px',
                        }} />
                        
                        {/* 다른 이름 라벨 */}
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
                        
                        {/* 다른 이름 목록 */}
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
          ) : internalSearchTerm.trim().length >= 2 ? (
            /* 검색 결과 없음 메시지 */
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
                color: '#5C6F5C',
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
          ) : null}
        </div>
      )}
    </div>
  );
}

export default GraphControls;