// src/hooks/useBookSearch.js
import { useState, useEffect } from 'react';

const parseDate = (str) => {
  if (!str || str.length < 8) return new Date('1900-01-01');
  const formatted = `${str.slice(0, 4)}-${str.slice(4, 6)}-${str.slice(6, 8)}`;
  return new Date(formatted);
};

const sortBooks = (books, option) => {
  switch (option) {
    case 'latest':
      return books.sort((a, b) => parseDate(b.pubdate) - parseDate(a.pubdate));
    case 'oldest':
      return books.sort((a, b) => parseDate(a.pubdate) - parseDate(b.pubdate));
    case 'title':
      return books.sort((a, b) => a.title.localeCompare(b.title));
    default:
      return books;
  }
};

const useBookSearch = () => {
  const [searchResults, setSearchResults] = useState([]);
  const [currentQuery, setCurrentQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [hasMore, setHasMore] = useState(true);
  const [sortOption, setSortOption] = useState('sim');
  const [genreFilter, setGenreFilter] = useState('all');

  useEffect(() => {
    if (currentQuery) {
      handleSearch(currentQuery, 1, false);
    }
  }, [sortOption]);

  const handleSearch = async (query, page = 1, isLoadMore = false) => {
    if (!query.trim()) {
      setErrorMessage('검색어를 입력해주세요.');
      setSearchResults([]);
      return;
    }

    setLoading(true);
    setErrorMessage('');
    if (!isLoadMore) {
      setSearchResults([]);
      setCurrentPage(1);
      setHasMore(true);
      setCurrentQuery(query);
    }

    try {
      const apiSort = sortOption === 'latest' ? 'date' : 'sim';
      const response = await fetch(`/naver?query=${encodeURIComponent(query)}&start=${(page - 1) * 10 + 1}&sort=${apiSort}`);
      if (!response.ok) throw new Error('검색 요청에 실패했습니다.');

      const data = await response.json();

      if (data.items && data.items.length > 0) {
        const sorted = sortBooks(data.items, sortOption);
        setSearchResults(prev => isLoadMore ? [...prev, ...sorted] : sorted);
        setCurrentPage(page);
        if (data.items.length < 10) setHasMore(false);
      } else {
        if (!isLoadMore) {
          setSearchResults([]);
          setErrorMessage('검색 결과가 없습니다.');
        }
        setHasMore(false);
      }
    } catch (error) {
      console.error('검색 오류:', error);
      setErrorMessage('검색 중 오류가 발생했습니다.');
      setSearchResults([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSortChange = (option) => {
    setSortOption(option);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleGenreFilter = (genre) => {
    setGenreFilter(genre);
  };

  const filteredBooks =
    genreFilter === 'all'
      ? searchResults
      : searchResults.filter(book => book.description.includes(genreFilter));

  return {
    searchResults: filteredBooks,
    handleSearch,
    loading,
    errorMessage,
    currentQuery,
    currentPage,
    setCurrentPage,
    hasMore,
    sortOption,
    handleSortChange,
    genreFilter,
    handleGenreFilter,
    setSearchResults,
  };
};

export default useBookSearch;
