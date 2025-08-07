import React, { useState } from "react";
import { FaSearch } from "react-icons/fa";

const GraphControls = ({
  onSearchSubmit = () => {} // 부모 컴포넌트에 검색 결과를 전달하는 콜백
}) => {
  // 내부 상태 관리
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  // 내부 검색 처리 함수
  const handleSearch = () => {
    const trimmedSearch = searchInput.trim();
    setSearch(trimmedSearch);
    onSearchSubmit(trimmedSearch); // 부모 컴포넌트에 검색어 전달
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
    minWidth: '50px',
    height: '28px',
    padding: '0 12px',
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
    maxWidth: '400px'
  };

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        handleSearch();
      }}
    >
      <input
        style={defaultInputStyle}
        type="text"
        placeholder="인물 검색 (이름/별칭)"
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        onFocus={(e) => {
          e.target.style.borderColor = '#6C8EFF';
          e.target.style.background = '#fff';
          e.target.style.boxShadow = '0 0 0 2px rgba(108, 142, 255, 0.1)';
        }}
        onBlur={(e) => {
          e.target.style.borderColor = '#e3e6ef';
          e.target.style.background = '#f8f9fc';
          e.target.style.boxShadow = 'none';
        }}
      />
      <button 
        type="submit" 
        style={defaultButtonStyle}
        onMouseEnter={(e) => {
          e.target.style.background = '#5A7BFF';
          e.target.style.boxShadow = '0 2px 8px rgba(108, 142, 255, 0.2)';
          e.target.style.transform = 'translateY(-1px)';
        }}
        onMouseLeave={(e) => {
          e.target.style.background = '#6C8EFF';
          e.target.style.boxShadow = 'none';
          e.target.style.transform = 'translateY(0)';
        }}
        onMouseDown={(e) => {
          e.target.style.transform = 'translateY(0)';
        }}
      >
        <FaSearch size={10} />
        <span style={{ fontSize: '12px' }}>검색</span>
      </button>
    </form>
  );
};

export default GraphControls;