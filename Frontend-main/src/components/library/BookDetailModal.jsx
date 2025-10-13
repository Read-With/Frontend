import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBookManifest } from '../../utils/common/api';
import './BookDetailModal.css';

const BookDetailModal = memo(({ book, isOpen, onClose }) => {
  const navigate = useNavigate();
  const [bookDetails, setBookDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCharacters, setShowCharacters] = useState(false);
  const [progressInfo, setProgressInfo] = useState(null);

  // 중복된 인물들 제거
  const uniqueCharacters = useMemo(() => {
    if (!bookDetails?.characters) return [];
    
    const seen = new Set();
    return bookDetails.characters.filter(character => {
      if (seen.has(character.id)) {
        return false;
      }
      seen.add(character.id);
      return true;
    });
  }, [bookDetails?.characters]);

  useEffect(() => {
    if (isOpen && book) {
      fetchBookDetails();
      fetchProgressInfo();
      setShowCharacters(false); // 모달이 열릴 때마다 인물 숨김 상태로 초기화
    }
  }, [isOpen, book]);

  const fetchProgressInfo = useCallback(() => {
    if (!book || typeof book.id !== 'number') {
      setProgressInfo(null);
      return;
    }

    try {
      // 로컬 스토리지에서 progress 정보 가져오기
      const progressKey = `book_progress_${book.id}`;
      const savedProgress = localStorage.getItem(progressKey);
      
      if (savedProgress) {
        const progress = JSON.parse(savedProgress);
        setProgressInfo(progress);
      } else {
        setProgressInfo(null);
      }
    } catch (err) {
      console.error('Progress 정보를 불러오는데 실패했습니다:', err);
      setProgressInfo(null);
    }
  }, [book]);

  const fetchBookDetails = useCallback(async () => {
    if (!book || typeof book.id !== 'number') {
      setBookDetails(book);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const manifestData = await getBookManifest(book.id);
      
      if (manifestData && manifestData.isSuccess && manifestData.result) {
        // API 응답 구조에 맞게 데이터 처리
        const bookInfo = manifestData.result.book || {};
        setBookDetails({
          ...book,
          ...bookInfo,
          // 추가 정보들
          chapters: manifestData.result.chapters || [],
          characters: manifestData.result.characters || [],
          progressMetadata: manifestData.result.progressMetadata || {}
        });
      } else {
        console.warn('API 응답이 성공하지 않았습니다:', manifestData);
        setBookDetails(book);
        setError('책의 상세 정보를 불러올 수 없습니다. 기본 정보만 표시됩니다.');
      }
    } catch (err) {
      console.error('책 정보를 불러오는데 실패했습니다:', err);
      const errorMessage = err.message || '책 정보를 불러오는데 실패했습니다.';
      setError(errorMessage);
      setBookDetails(book);
    } finally {
      setLoading(false);
    }
  }, [book]);

  // 책 타입 확인 유틸리티
  const isLocalBook = useMemo(() => 
    typeof book?.id === 'string' && book.id.startsWith('local_'), 
    [book?.id]
  );

  const getBookIdentifier = useCallback(() => 
    isLocalBook ? book.epubPath : book.id, 
    [isLocalBook, book]
  );

  const getNavigationState = useCallback(() => 
    isLocalBook ? undefined : { book }, 
    [isLocalBook, book]
  );

  // 네비게이션 핸들러들
  const handleReadClick = useCallback(() => {
    onClose();
    navigate(`/user/viewer/${getBookIdentifier()}`, { state: getNavigationState() });
  }, [onClose, navigate, getBookIdentifier, getNavigationState]);

  const handleGraphClick = useCallback(() => {
    onClose();
    navigate(`/user/graph/${getBookIdentifier()}`, { state: getNavigationState() });
  }, [onClose, navigate, getBookIdentifier, getNavigationState]);


  // ESC 키로 모달 닫기
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden'; // 스크롤 방지
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div 
      className={`book-detail-modal ${!isOpen ? 'hidden' : ''}`} 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="book-detail-title"
    >
      <div className="book-detail-content" onClick={(e) => e.stopPropagation()}>
        <button
          className="book-detail-close-btn"
          onClick={onClose}
          aria-label="모달 닫기"
          type="button"
        >
          ×
        </button>

        <div className="book-detail-header">
          <div className="book-detail-cover">
            <img
              src={bookDetails?.coverImgUrl || book?.coverImgUrl}
              alt={bookDetails?.title || book?.title}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div className="book-detail-info">
            <h2 id="book-detail-title" className="book-detail-title">
              {bookDetails?.title || book?.title || '제목 없음'}
            </h2>
            <p className="book-detail-author">
              {bookDetails?.author || book?.author || '저자 정보 없음'}
            </p>
            {loading && (
              <div className="book-detail-loading" role="status" aria-live="polite">
                정보를 불러오는 중...
              </div>
            )}
            {error && (
              <div className="book-detail-error" role="alert" aria-live="assertive">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="book-detail-body">
          {bookDetails && (
            <>

              {uniqueCharacters && uniqueCharacters.length > 0 && (
                <div className="book-detail-section">
                  <div className="book-detail-characters-header">
                    <div className="book-detail-label">등장 인물</div>
                    <button
                      className="book-detail-toggle-btn"
                      onClick={() => setShowCharacters(!showCharacters)}
                      aria-expanded={showCharacters}
                      aria-label={showCharacters ? '인물 목록 숨기기' : '인물 목록 보기'}
                    >
                      {showCharacters ? '숨기기' : '보기'}
                    </button>
                  </div>
                  <div className="book-detail-value">
                    {showCharacters && (
                      <div className="book-detail-characters-list">
                        {uniqueCharacters.map((character) => (
                          <div key={character.id} className="book-detail-character-item">
                            {character.name} {character.isMainCharacter && '⭐'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {bookDetails.chapters && bookDetails.chapters.length > 0 && (
                <div className="book-detail-section">
                  <div className="book-detail-label">챕터 정보</div>
                  <div className="book-detail-value">
                    <div className="book-detail-chapters-list">
                      {bookDetails.chapters.map((chapter, index) => (
                        <div key={index} className="book-detail-chapter-item">
                          {chapter.idx}. {chapter.title}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 최근에 읽은 시점 */}
              {progressInfo && (
                <div className="book-detail-section">
                  <div className="book-detail-label">최근에 읽은 시점</div>
                  <div className="book-detail-value">
                    <div className="book-detail-progress-info">
                      {progressInfo.currentChapter && (
                        <div className="book-detail-progress-item">
                          챕터 {progressInfo.currentChapter}장
                        </div>
                      )}
                      {progressInfo.currentPage && progressInfo.totalPages && (
                        <div className="book-detail-progress-item">
                          {progressInfo.currentPage} / {progressInfo.totalPages} 페이지
                        </div>
                      )}
                      {progressInfo.progress && (
                        <div className="book-detail-progress-item">
                          진도: {Math.round(progressInfo.progress * 100)}%
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {bookDetails.updatedAt && (
                <div className="book-detail-section">
                  <div className="book-detail-label">업데이트 일시</div>
                  <div className="book-detail-value">
                    {new Date(bookDetails.updatedAt).toLocaleString('ko-KR')}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="book-detail-button-group">
            <button
              className="book-detail-primary-btn"
              onClick={handleReadClick}
              type="button"
              aria-label="책 읽기 페이지로 이동"
            >
              읽기
            </button>
            <button
              className="book-detail-secondary-btn"
              onClick={handleGraphClick}
              type="button"
              aria-label="인물 관계도 페이지로 이동"
            >
              그래프
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

BookDetailModal.displayName = 'BookDetailModal';

export default BookDetailModal;
