import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { normalizeTitle } from '../../utils/stringUtils';
import { errorUtils } from '../../utils/viewerUtils';

/**
 * 서버 책 매칭 훅
 * 로컬에서 열린 책이 서버에 존재하는지 확인하고, 매칭되면 서버 bookId로 URL을 업데이트합니다.
 * 
 * 중요: EPUB 파일은 IndexedDB에만 저장되며, 서버에는 메타데이터만 저장됨
 * 서버 bookId를 키로 사용하여 서버 책 목록과 IndexedDB의 EPUB 파일을 매칭함
 * 
 * @param {string} bookId - 현재 URL의 bookId
 * @returns {Object} { serverBook, loadingServerBook, matchedServerBook }
 */
export function useServerBookMatching(bookId) {
  const location = useLocation();
  const navigate = useNavigate();
  
  const [serverBook, setServerBook] = useState(null);
  const [loadingServerBook, setLoadingServerBook] = useState(false);
  const [matchedServerBook, setMatchedServerBook] = useState(null);
  
  const matchedServerBookRef = useRef(null);
  const prevNormalizedTitleRef = useRef(null);
  
  // matchedServerBook을 ref로 추적하여 의존성 문제 방지
  useEffect(() => {
    matchedServerBookRef.current = matchedServerBook;
  }, [matchedServerBook]);

  // 서버에서 책 정보 가져오기 (URL 직접 접근 시)
  useEffect(() => {
    const fetchServerBook = async () => {
      if (location.state?.book) {
        return;
      }
      
      const numericBookId = parseInt(bookId, 10);
      if (isNaN(numericBookId)) {
        return;
      }
      
      setLoadingServerBook(true);
      try {
        const { getBook } = await import('../../utils/api/booksApi');
        const response = await getBook(numericBookId);
        
        if (response && response.isSuccess && response.result) {
          const bookData = response.result;
          setServerBook(bookData);
        }
      } catch (error) {
        errorUtils.logError('fetchServerBook', error, { bookId, numericBookId });
      } finally {
        setLoadingServerBook(false);
      }
    };
    
    fetchServerBook();
  }, [bookId, location.state?.book]);

  // 로컬 책과 서버 책 매칭
  useEffect(() => {
    const stateBook = location.state?.book;
    if (!stateBook || typeof stateBook.id === 'number') {
      if (matchedServerBookRef.current) {
        setMatchedServerBook(null);
      }
      prevNormalizedTitleRef.current = null;
      return;
    }

    const normalizedTitle = normalizeTitle(stateBook.title);
    if (!normalizedTitle) {
      if (matchedServerBookRef.current) {
        setMatchedServerBook(null);
      }
      prevNormalizedTitleRef.current = null;
      return;
    }

    // 이미 같은 제목으로 검색했으면 스킵
    if (prevNormalizedTitleRef.current === normalizedTitle) {
      const currentMatched = matchedServerBookRef.current;
      if (
        currentMatched &&
        typeof currentMatched.id === 'number' &&
        normalizeTitle(currentMatched.title) === normalizedTitle
      ) {
        return;
      }
    }

    prevNormalizedTitleRef.current = normalizedTitle;
    let cancelled = false;

    const fetchMatchingServerBook = async () => {
      try {
        const { getBooks } = await import('../../utils/api/booksApi');
        const response = await getBooks({ q: stateBook.title });

        if (cancelled) {
          return;
        }

        if (response?.isSuccess && Array.isArray(response.result)) {
          const matched = response.result.filter(
            (item) => normalizeTitle(item.title) === normalizedTitle && typeof item.id === 'number'
          );
          
          if (matched.length > 0) {
            const sortedMatched = matched.sort((a, b) => {
              const aId = Number(a?.id) || Number.MAX_SAFE_INTEGER;
              const bId = Number(b?.id) || Number.MAX_SAFE_INTEGER;
              return aId - bId;
            });
            
            setMatchedServerBook(sortedMatched[0]);
            return;
          }
        }

        setMatchedServerBook(null);
      } catch (error) {
        if (!cancelled) {
          setMatchedServerBook(null);
        }
      }
    };

    fetchMatchingServerBook();

    return () => {
      cancelled = true;
    };
  }, [location.state?.book]);

  // 매칭된 서버 책으로 URL 업데이트
  useEffect(() => {
    if (!matchedServerBook || typeof matchedServerBook.id !== 'number') {
      return;
    }

    const numericId = matchedServerBook.id;
    if (`${numericId}` === bookId) {
      return;
    }

    const stateBook = location.state?.book;
    const indexedDbKey = String(numericId);

    navigate(`/user/viewer/${numericId}${location.search || ''}`, {
      replace: true,
      state: {
        ...location.state,
        book: {
          ...matchedServerBook,
          epubFile: stateBook?.epubFile,
          epubArrayBuffer: stateBook?.epubArrayBuffer,
          filename: String(numericId),
          _indexedDbId: indexedDbKey,
          _bookId: numericId,
          _needsLoad: !stateBook?.epubFile && !stateBook?.epubArrayBuffer,
          epubPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined
        }
      }
    });
  }, [matchedServerBook, bookId, location.search, location.state, navigate]);

  return {
    serverBook,
    loadingServerBook,
    matchedServerBook
  };
}
