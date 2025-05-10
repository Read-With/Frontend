import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './SearchPage.css';

function formatDate(pubdate) {
  if (!pubdate || pubdate.length < 8) return pubdate;
  return `${pubdate.slice(0,4)}.${pubdate.slice(4,6)}.${pubdate.slice(6,8)}`;
}

const sortOptions = [
  { value: 'sim', label: '정확도순' },
  { value: 'date', label: '출간일순' },
  { value: 'count', label: '판매량순' },
];
const PER_PAGE = 20;

function getSessionKey(query) {
  return `search_${query}`;
}

function saveToSession(query, allData) {
  sessionStorage.setItem(getSessionKey(query), JSON.stringify(allData));
}
function loadFromSession(query) {
  const data = sessionStorage.getItem(getSessionKey(query));
  return data ? JSON.parse(data) : null;
}

const SearchPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sort, setSort] = useState('sim');
  const [currentPage, setCurrentPage] = useState(1);
  const [searched, setSearched] = useState(false); // 검색 실행 여부
  const ref = useRef(null);

  // 네이버 API에서 특정 정렬만 받아오는 함수
  const fetchSortFromAPI = async (query, sortType) => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(`http://localhost:5000/naver`, {
        params: {
          query: query,
          display: 100,
          sort: sortType
        }
      });
      return {
        items: response.data.items || [],
        total: response.data.total || 0
      };
    } catch (err) {
      setError('검색 중 오류가 발생했습니다.');
      return { items: [], total: 0 };
    } finally {
      setLoading(false);
    }
  };

  // 검색 및 sessionStorage 저장
  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);
    setCurrentPage(1);
    setSearched(true);
    
    // sessionStorage에 이미 있으면 불러오기
    const cached = loadFromSession(searchQuery);
    if (cached && cached[sort]) {
      setSearchResults(cached[sort].items.slice(0, PER_PAGE));
      setTotal(cached[sort].total);
      setLoading(false);
      return;
    }

    try {
      // 현재 선택된 정렬로만 API 요청
      const response = await axios.get(`http://localhost:5000/naver`, {
        params: {
          query: searchQuery,
          display: 100,
          sort: sort
        }
      });

      const data = {
        items: response.data.items || [],
        total: response.data.total || 0
      };

      // sessionStorage에 저장
      const updatedCache = cached || {};
      updatedCache[sort] = data;
      saveToSession(searchQuery, updatedCache);

      setSearchResults(data.items.slice(0, PER_PAGE));
      setTotal(data.total);
    } catch (err) {
      setError('검색 중 오류가 발생했습니다.');
      setSearchResults([]);
      setTotal(0);
      console.error('검색 오류:', err);
    } finally {
      setLoading(false);
    }
  };

  // 정렬 변경 시 sessionStorage에 없으면 API 요청, 있으면 불러오기
  const handleSortChange = async (e) => {
    const newSort = e.target.value;
    setSort(newSort);
    setCurrentPage(1);
    const cached = loadFromSession(searchQuery);
    if (cached && cached[newSort]) {
      setSearchResults(cached[newSort].items.slice(0, PER_PAGE));
      setTotal(cached[newSort].total);
    } else if (searchQuery.trim()) {
      setLoading(true);
      setError(null);
      // 해당 정렬만 API에서 받아와서 sessionStorage에 추가 저장
      const sortData = await fetchSortFromAPI(searchQuery, newSort);
      const updatedCache = cached || {};
      updatedCache[newSort] = sortData;
      saveToSession(searchQuery, updatedCache);
      setSearchResults(sortData.items.slice(0, PER_PAGE));
      setTotal(sortData.total);
      setLoading(false);
    }
  };

  // 페이지네이션 이동
  const handlePageChange = (page) => {
    setCurrentPage(page);
    const cached = loadFromSession(searchQuery);
    if (cached && cached[sort]) {
      const start = (page - 1) * PER_PAGE;
      setSearchResults(cached[sort].items.slice(start, start + PER_PAGE));
    }
  };

  // 페이지네이션 버튼 생성
  const totalPages = Math.ceil(total / PER_PAGE);
  const renderPagination = () => {
    if (totalPages <= 1) return null;
    let pages = [];
    for (let i = 1; i <= totalPages && i <= 5; i++) {
      // 최대 5페이지까지만 노출
      pages.push(
        <button
          key={i}
          className={`pagination-btn${currentPage === i ? ' active' : ''}`}
          onClick={() => handlePageChange(i)}
        >
          {i}
        </button>
      );
    }
    return <div className="pagination">{pages}</div>;
  };

  useEffect(() => {
    if (ref.current) {
      const cy = ref.current;
      cy.resize();
      if (fitNodeIds && fitNodeIds.length > 0) {
        const nodesToFit = cy.nodes().filter(n => fitNodeIds.includes(n.id()));
        if (nodesToFit.length > 0) {
          cy.fit(nodesToFit, 0);
        }
      } else {
        cy.fit(undefined, 0);
      }
      // boundingBox를 이용해 그래프를 왼쪽 상단에 맞춤
      const bb = cy.elements().boundingBox();
      cy.pan({ x: -bb.x1, y: 0 });
    }
  }, [elements, fitNodeIds, ref]);

  return (
    <div className="search-outer">
      <div className="search-card">
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="책 제목 또는 키워드 입력"
            className="search-input"
          />
          <button type="submit" className="search-button" disabled={loading}>
            <span role="img" aria-label="검색">🔍</span> 검색
          </button>
        </form>
        {error && <div className="error-message">{error}</div>}
        {!searched && (
          <div className="search-guide">
            <div className="guide-title">검색어를 입력해주세요</div>
            <div className="guide-desc">책 제목, 저자, 출판사 등으로 검색할 수 있습니다</div>
          </div>
        )}
        {loading && <div className="search-loading">검색 중...</div>}
        {searched && !loading && searchResults.length === 0 && !error && (
          <div className="search-guide">
            <div className="guide-title">검색 결과가 없습니다</div>
          </div>
        )}
        {searchResults.length > 0 && !loading && (
          <>
            <div className="search-result-header">
              <span>검색결과 {total.toLocaleString()}건</span>
              <div className="search-sort">
                <label htmlFor="sort-select">정렬: </label>
                <select id="sort-select" value={sort} onChange={handleSortChange}>
                  {sortOptions.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="search-results">
              {searchResults.map((book) => (
                <div key={book.isbn} className="book-card">
                  {book.image ? (
                    <img src={book.image} alt={book.title} className="book-image" />
                  ) : (
                    <div className="book-image book-image-placeholder">이미지 준비중</div>
                  )}
                  <div className="book-info">
                    <h3>{book.title.replace(/<[^>]*>/g, '')}</h3>
                    <p className="book-meta">
                      {[
                        book.author?.replace(/<[^>]*>/g, '') || '저자 정보 없음',
                        book.publisher?.replace(/<[^>]*>/g, '') || '출판사 정보 없음',
                        book.pubdate ? formatDate(book.pubdate) : '출판일 정보 없음'
                      ].join(' | ')}
                    </p>
                    <p className="book-desc">{book.description.replace(/<[^>]*>/g, '')}</p>
                    <p className={`book-price ${(() => {
                      const price = book.discount || book.price;
                      if (!price) return '';
                      const numPrice = Number(price.replace(/[^0-9]/g, ''));
                      return numPrice > 0 ? 'has-price' : '';
                    })()}`}>
                      {(() => {
                        const price = book.discount || book.price;
                        if (!price) return '가격 정보 없음';
                        const numPrice = Number(price.replace(/[^0-9]/g, ''));
                        return numPrice > 0 ? `${numPrice.toLocaleString()}원` : '가격 정보 없음';
                      })()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            {renderPagination()}
          </>
        )}
      </div>
    </div>
  );
};

export default SearchPage; 