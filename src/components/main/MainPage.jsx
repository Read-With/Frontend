import React, { useEffect, useRef } from 'react';
import SearchBar from '../common/SearchBar';
import BookList from './BookList';
import LoadingSpinner from '../common/LoadingSpinner';
import SortDropdown from '../common/SortDropdown';
import Library from '../library/Library';
import PageLayout from '../common/PageLayout';
import useBookSearch from '../../hooks/useBookSearch'; // hook 가져오기

const MainPage = ({ showLibrary, setSelectedBook, handleBookSelect, darkMode }) => {
  const {
    searchResults,
    handleSearch,
    loading,
    errorMessage,
    currentQuery,
    currentPage,
    hasMore,
    sortOption,
    handleSortChange,
  } = useBookSearch();

  const lastBookElementRef = useRef(null);

  useEffect(() => {
    if (loading || !currentQuery) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          entries[0].isIntersecting &&
          hasMore &&
          searchResults.length >= currentPage * 10
        ) {
          handleSearch(currentQuery, currentPage + 1, true);
        }
      },
      { threshold: 1.0 }
    );

    const lastElement = lastBookElementRef.current;
    if (lastElement) observer.observe(lastElement);

    return () => {
      if (lastElement) observer.unobserve(lastElement);
    };
  }, [searchResults, currentPage, loading, currentQuery, hasMore]);

  return (
    <PageLayout darkMode={darkMode}>
      {/* 본문 영역 */}
      <div className="w-full mx-auto max-w-5xl bg-white rounded-xl shadow-xl my-6 p-6 flex flex-col">
        {/* 헤더 + 검색창 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">📚 책 검색</h1>
          <SearchBar onSearch={handleSearch} />
        </div>

        {/* 정렬 옵션 */}
        <div className="mb-4">
          <SortDropdown value={sortOption} onChange={handleSortChange} />
        </div>

        {/* 오류 메시지 */}
        {errorMessage && (
          <p className="text-center text-red-500 mb-4">{errorMessage}</p>
        )}

        {/* 콘텐츠 표시 */}
        {showLibrary ? (
          <Library onBookSelect={setSelectedBook} darkMode={darkMode} />
        ) : (
          <>
            <BookList
              books={searchResults}
              onSelectBook={handleBookSelect}
              darkMode={darkMode}
              lastBookRef={lastBookElementRef}
            />
            {loading && <LoadingSpinner />}
          </>
        )}
      </div>
    </PageLayout>
  );
};

export default MainPage;
