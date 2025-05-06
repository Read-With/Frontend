import React, { useState } from 'react';
import PageLayout from '../common/PageLayout';
import SearchBar from '../common/SearchBar';
import BookList from './BookList';
import LoadingSpinner from '../common/LoadingSpinner';

const SearchPage = () => {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  // 예시: 검색 시 임의의 결과 반환
  const handleSearch = (query) => {
    setLoading(true);
    setTimeout(() => {
      setResults([
        { title: `${query} 예시 책 1` },
        { title: `${query} 예시 책 2` },
        { title: `${query} 예시 책 3` },
      ]);
      setLoading(false);
    }, 800);
  };

  return (
    <PageLayout>
      <div style={{ maxWidth: 600, margin: '3rem auto 0 auto', background: '#fff', borderRadius: 18, boxShadow: '0 4px 16px rgba(0,0,0,0.08)', padding: '2.5rem 2.5rem 2rem 2.5rem' }}>
        <div style={{ fontSize: '3rem', color: '#4F6DDE', marginBottom: '1.2rem', textAlign: 'center' }}>🔍</div>
        <h2 style={{ fontWeight: 700, fontSize: '1.45rem', marginBottom: '0.7rem', color: '#22336b', textAlign: 'center' }}>책 검색</h2>
        <p style={{ color: '#6b7280', fontSize: '1.08rem', lineHeight: 1.6, marginBottom: '1.5rem', textAlign: 'center' }}>
          새로운 책을 검색하고 찾아보세요
        </p>
        <SearchBar onSearch={handleSearch} />
        {loading && <LoadingSpinner />}
        {!loading && results.length > 0 && <BookList books={results} />}
      </div>
    </PageLayout>
  );
};

export default SearchPage; 