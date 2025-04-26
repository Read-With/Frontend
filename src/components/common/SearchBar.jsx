import React, { useState } from 'react';

const SearchBar = ({ onSearch }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (input.trim()) {
      onSearch(input.trim());
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexWrap: 'wrap',
        marginTop: '1rem',
        width: '100%',
        maxWidth: '600px',
        marginLeft: 'auto',
        marginRight: 'auto',
      }}
    >
      <input
        type="text"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder="책 제목 또는 키워드 입력"
        style={{
          padding: '0.5rem',
          flex: '1',
          minWidth: '200px',
          fontSize: '1rem',
        }}
      />
      <button
        type="submit"
        style={{
          marginLeft: '0.5rem',
          padding: '0.5rem 1rem',
          fontSize: '1rem',
          cursor: 'pointer',
          marginTop: '0.5rem',
        }}
      >
        🔍 검색
      </button>
    </form>
  );
};

export default SearchBar;
