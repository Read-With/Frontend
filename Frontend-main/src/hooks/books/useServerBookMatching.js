import { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { normalizeTitle } from '../../utils/common/stringUtils';
import { errorUtils } from '../../utils/viewer/viewerUtils';

/**
 * 서버 책 매칭 훅
 * 동일 제목+저자 책이 여러 개면 최소 bookId로 리다이렉트합니다.
 *
 * @param {string} bookId - 현재 URL의 bookId
 * @returns {Object} { serverBook, loadingServerBook, matchedServerBook }
 */
const normalizeAuthor = (author) => (author || '').toLowerCase().trim().replace(/\s+/g, ' ');
const serverBookFetchState = new Map();

export function useServerBookMatching(bookId, options = {}) {
  const { skipBookIdRedirectRef } = options;
  const location = useLocation();
  const navigate = useNavigate();
  
  const [serverBook, setServerBook] = useState(null);
  const [loadingServerBook, setLoadingServerBook] = useState(false);
  const [matchedServerBook, setMatchedServerBook] = useState(null);
  
  const matchedServerBookRef = useRef(null);
  
  // matchedServerBook을 ref로 추적하여 의존성 문제 방지
  useEffect(() => {
    matchedServerBookRef.current = matchedServerBook;
  }, [matchedServerBook]);

  // 서버에서 책 정보 가져오기 (URL 직접 접근 시)
  useEffect(() => {
    const fetchServerBook = async () => {
      const numericBookId = parseInt(bookId, 10);
      if (isNaN(numericBookId)) {
        return;
      }
      if (serverBook?.id === numericBookId) {
        return;
      }
      if (serverBookFetchState.get(numericBookId) === 'inflight') {
        return;
      }
      
      setLoadingServerBook(true);
      serverBookFetchState.set(numericBookId, 'inflight');
      try {
        const { getBook } = await import('../../utils/api/booksApi');
        const response = await getBook(numericBookId);
        
        if (response && response.isSuccess && response.result) {
          const bookData = response.result;
          setServerBook(bookData);
          serverBookFetchState.set(numericBookId, 'done');
        } else {
          serverBookFetchState.delete(numericBookId);
        }
      } catch (error) {
        serverBookFetchState.delete(numericBookId);
        errorUtils.logError('fetchServerBook', error, { bookId, numericBookId });
      } finally {
        setLoadingServerBook(false);
      }
    };
    
    fetchServerBook();
  }, [bookId, location.state?.book]);

  // 제목+저자 기준 최소 bookId를 계산
  useEffect(() => {
    // 라이브러리에서 클릭한 책은 목록에서 이미 canonical 처리된 id를 신뢰
    if (location.state?.fromLibrary === true) {
      setMatchedServerBook(null);
      return;
    }

    const sourceBook = location.state?.book || serverBook;
    if (!sourceBook?.title || !sourceBook?.author) {
      setMatchedServerBook(null);
      return;
    }

    const titleKey = normalizeTitle(sourceBook.title);
    const authorKey = normalizeAuthor(sourceBook.author);
    if (!titleKey || !authorKey) {
      setMatchedServerBook(null);
      return;
    }

    let cancelled = false;
    const resolveCanonical = async () => {
      try {
        const { getBooks } = await import('../../utils/api/booksApi');
        const res = await getBooks({});
        if (cancelled || !res?.isSuccess || !Array.isArray(res.result)) return;

        const candidates = res.result
          .filter((item) => {
            const id = Number(item?.id);
            return (
              Number.isFinite(id) &&
              id > 0 &&
              normalizeTitle(item?.title || '') === titleKey &&
              normalizeAuthor(item?.author || '') === authorKey
            );
          })
          .sort((a, b) => Number(a.id) - Number(b.id));

        if (candidates.length > 0) {
          setMatchedServerBook(candidates[0]);
        } else {
          setMatchedServerBook(null);
        }
      } catch {
        if (!cancelled) setMatchedServerBook(null);
      }
    };

    resolveCanonical();
    return () => { cancelled = true; };
  }, [bookId, location.state?.book, location.state?.fromLibrary, serverBook]);

  // canonical bookId로 리다이렉트
  useEffect(() => {
    if (skipBookIdRedirectRef?.current) return;
    if (!location.pathname.includes('/viewer/')) return;
    if (!matchedServerBook || typeof matchedServerBook.id !== 'number') return;

    const canonicalId = String(matchedServerBook.id);
    if (String(bookId) === canonicalId) return;

    navigate(`/user/viewer/${canonicalId}`, {
      replace: true,
      state: {
        ...location.state,
        book: {
          ...matchedServerBook,
          filename: canonicalId,
          _bookId: matchedServerBook.id,
          _needsLoad: true,
          xhtmlPath: undefined,
          filePath: undefined,
          s3Path: undefined,
          fileUrl: undefined,
        },
      },
    });
  }, [matchedServerBook, bookId, location.pathname, location.state, navigate, skipBookIdRedirectRef]);

  return {
    serverBook,
    loadingServerBook,
    matchedServerBook
  };
}
