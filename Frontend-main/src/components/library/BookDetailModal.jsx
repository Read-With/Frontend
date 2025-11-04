import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getBookManifest, getBookProgress, deleteBookProgress } from '../../utils/common/api';
import { getChapterPovSummaries } from '../../utils/api/booksApi';
import { toast } from 'react-toastify';
import './BookDetailModal.css';

const BookDetailModal = memo(({ book, isOpen, onClose }) => {
  const navigate = useNavigate();
  const [bookDetails, setBookDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showCharacters, setShowCharacters] = useState(false);
  const [progressInfo, setProgressInfo] = useState(null);
  const [povTestResult, setPovTestResult] = useState(null);

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

  const testPovSummaries = useCallback(async () => {
    if (!book || typeof book.id !== 'number') {
      setPovTestResult(null);
      return;
    }

    try {
      const response = await getChapterPovSummaries(book.id, 1);
      setPovTestResult({
        success: true,
        data: response,
        message: '챕터 1의 POV 요약 데이터가 있습니다'
      });
    } catch (err) {
      setPovTestResult({
        success: false,
        error: err.message,
        message: '챕터 1의 POV 요약 데이터가 없습니다'
      });
    }
  }, [book]);

  const fetchProgressInfo = useCallback(async () => {
    if (!book || typeof book.id !== 'number') {
      setProgressInfo(null);
      return;
    }

    try {
      const response = await getBookProgress(book.id);
      if (response.isSuccess && response.result) {
        setProgressInfo(response.result);
      } else {
        setProgressInfo(null);
      }
    } catch (err) {
      if (!err.message.includes('404') && !err.message.includes('찾을 수 없습니다')) {
        console.error('Progress 정보를 불러오는데 실패했습니다:', err);
      }
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

  useEffect(() => {
    if (isOpen && book) {
      fetchBookDetails();
      fetchProgressInfo();
      testPovSummaries();
    }
  }, [isOpen, book, fetchBookDetails, fetchProgressInfo, testPovSummaries]);

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

  const handleDeleteProgress = useCallback(async () => {
    if (!book || typeof book.id !== 'number' || !progressInfo) {
      return;
    }

    if (!window.confirm('독서 진도를 삭제하시겠습니까?')) {
      return;
    }

    try {
      const response = await deleteBookProgress(book.id);
      if (response.isSuccess) {
        setProgressInfo(null);
        toast.success('독서 진도가 삭제되었습니다');
      } else {
        toast.error(response.message || '독서 진도 삭제에 실패했습니다');
      }
    } catch (err) {
      console.error('독서 진도 삭제 실패:', err);
      toast.error('독서 진도 삭제에 실패했습니다');
    }
  }, [book, progressInfo]);


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
                  <div className="book-detail-characters-header">
                    <div className="book-detail-label">최근에 읽은 시점</div>
                    <button
                      className="book-detail-toggle-btn"
                      onClick={handleDeleteProgress}
                      style={{ 
                        color: '#dc2626',
                        border: '1px solid #fecaca'
                      }}
                      aria-label="진도 삭제"
                    >
                      삭제
                    </button>
                  </div>
                  <div className="book-detail-value">
                    <div className="book-detail-progress-info">
                      {progressInfo.chapterIdx && (
                        <div className="book-detail-progress-item">
                          챕터 {progressInfo.chapterIdx}장
                        </div>
                      )}
                      {progressInfo.eventIdx !== undefined && (
                        <div className="book-detail-progress-item">
                          이벤트 {progressInfo.eventIdx}
                        </div>
                      )}
                      {progressInfo.cfi && (
                        <div className="book-detail-progress-item" style={{ 
                          fontSize: '0.8em',
                          color: '#6b7280',
                          wordBreak: 'break-all'
                        }}>
                          위치: {progressInfo.cfi.substring(0, 50)}...
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

              {/* POV 요약 테스트 결과 */}
              {povTestResult && (
                <div className="book-detail-section">
                  <div className="book-detail-label">
                    백엔드 POV 데이터 확인
                  </div>
                  <div className="book-detail-value">
                    <div style={{
                      padding: '12px',
                      backgroundColor: povTestResult.success ? '#d1fae5' : '#fee2e2',
                      borderRadius: '8px',
                      border: `1px solid ${povTestResult.success ? '#10b981' : '#ef4444'}`,
                      fontSize: '0.9em'
                    }}>
                      {povTestResult.success ? (
                        <>
                          <div style={{ color: '#065f46', fontWeight: 'bold', marginBottom: '8px' }}>
                            ✅ {povTestResult.message}
                          </div>
                          {povTestResult.data?.result?.povSummaries?.length > 0 && (
                            <div style={{ color: '#047857', marginTop: '8px' }}>
                              인물 수: {povTestResult.data.result.povSummaries.length}명
                            </div>
                          )}
                        </>
                      ) : (
                        <div style={{ color: '#991b1b' }}>
                          ❌ {povTestResult.message}
                        </div>
                      )}
                    </div>
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

