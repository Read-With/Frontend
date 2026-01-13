import React, { useState, useEffect, useMemo, useCallback, memo } from 'react';
import PropTypes from 'prop-types';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getBookManifest, getBookProgress, deleteBookProgress } from '../../utils/api/api';
import { getManifestFromCache } from '../../utils/common/cache/manifestCache';
import { deleteLocalBookBuffer } from '../../utils/localBookStorage';
import { getServerBookId } from '../../utils/viewerUtils';
import { toast } from 'react-toastify';
import './BookDetailModal.css';

const BookDetailModal = memo(({ book, isOpen, onClose, onDelete }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [bookDetails, setBookDetails] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showMoreCharacters, setShowMoreCharacters] = useState(false);
  const [progressInfo, setProgressInfo] = useState(null);

  // 중복된 인물들 제거 및 주요/일반 인물 분리
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

  const mainCharacters = useMemo(() => {
    return uniqueCharacters.filter(char => char.isMainCharacter);
  }, [uniqueCharacters]);

  const otherCharacters = useMemo(() => {
    return uniqueCharacters.filter(char => !char.isMainCharacter);
  }, [uniqueCharacters]);

  const fetchProgressInfo = useCallback(async () => {
    const serverBookId = getServerBookId(book);
    
    if (!serverBookId) {
      setProgressInfo(null);
      return;
    }

    try {
      const response = await getBookProgress(serverBookId);
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
    const serverBookId = getServerBookId(book);
    
    if (!serverBookId) {
      setBookDetails(book);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const manifestData = await getBookManifest(serverBookId);
      
      if (manifestData && manifestData.isSuccess && manifestData.result) {
        // 정규화된 manifest 데이터 가져오기 (캐시에서 가져오면 정규화됨)
        const normalizedManifest = getManifestFromCache(serverBookId) || manifestData.result;
        
        // API 응답 구조에 맞게 데이터 처리
        const bookInfo = normalizedManifest.book || manifestData.result.book || {};
        setBookDetails({
          ...book,
          ...bookInfo,
          // 정규화된 챕터 데이터 사용 (title 필드가 정규화됨)
          chapters: normalizedManifest.chapters || manifestData.result.chapters || [],
          characters: normalizedManifest.characters || manifestData.result.characters || [],
          progressMetadata: normalizedManifest.progressMetadata || manifestData.result.progressMetadata || {}
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
    }
  }, [isOpen, book, fetchBookDetails, fetchProgressInfo]);

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

  // 진도 삭제 - useMutation + 낙관적 업데이트
  const deleteProgressMutation = useMutation({
    mutationFn: (bookId) => deleteBookProgress(bookId),
    onMutate: async () => {
      // 낙관적 업데이트 - 즉시 UI 반영
      const previousProgress = progressInfo;
      setProgressInfo(null);
      return { previousProgress };
    },
    onSuccess: () => {
      toast.success('독서 진도가 삭제되었습니다');
      // 책 목록 무효화 (진도율 업데이트)
      queryClient.invalidateQueries({ queryKey: ['books', 'server'] });
    },
    onError: (err, variables, context) => {
      // 롤백
      if (context?.previousProgress) {
        setProgressInfo(context.previousProgress);
      }
      console.error('독서 진도 삭제 실패:', err);
      toast.error('독서 진도 삭제에 실패했습니다');
    },
  });

  const handleDeleteProgress = useCallback(async () => {
    const serverBookId = getServerBookId(book);
    
    if (!serverBookId || !progressInfo) {
      return;
    }

    if (!window.confirm('독서 진도를 삭제하시겠습니까?')) {
      return;
    }

    try {
      await deleteProgressMutation.mutateAsync(serverBookId);
    } catch (err) {
      // 에러는 onError에서 처리
    }
  }, [book, progressInfo, deleteProgressMutation]);

  const handleDeleteBook = useCallback(async () => {
    if (!book || !book.id) {
      return;
    }

    if (!window.confirm('이 책을 삭제하시겠습니까?')) {
      return;
    }

    try {
      // 모든 책은 서버 API 기반으로 삭제
      if (onDelete) {
        await onDelete(book.id);
        toast.success('책이 삭제되었습니다');
        onClose();
      } else {
        toast.error('삭제 기능을 사용할 수 없습니다');
      }
    } catch (err) {
      console.error('책 삭제 실패:', err);
      toast.error('책 삭제에 실패했습니다');
    }
  }, [book, onDelete, onClose]);


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
          {bookDetails?.updatedAt && (() => {
            const date = new Date(bookDetails.updatedAt);
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return (
              <div className="book-detail-updated-at">
                {year}. {month}. {day}. {hours}:{minutes}
              </div>
            );
          })()}
        </div>

        <div className="book-detail-body">
          {bookDetails && (
            <>

              {uniqueCharacters && uniqueCharacters.length > 0 && (
                <div className="book-detail-section">
                  <div className="book-detail-characters-header">
                    <div className="book-detail-label">등장 인물</div>
                  </div>
                  <div className="book-detail-value">
                    {/* 주요 인물 - 항상 표시 */}
                    {mainCharacters.length > 0 && (
                      <div className="book-detail-characters-list">
                        {mainCharacters
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((character) => (
                            <div 
                              key={character.id} 
                              className="book-detail-character-item main-character"
                            >
                              <span className="character-name">{character.name}</span>
                              <span className="character-star" aria-label="주요 인물">⭐</span>
                            </div>
                          ))}
                      </div>
                    )}
                    
                    {/* 일반 인물 - 더보기 버튼으로 제어 */}
                    {otherCharacters.length > 0 && (
                      <>
                        {showMoreCharacters && (
                          <div className="book-detail-characters-list">
                            {otherCharacters
                              .sort((a, b) => a.name.localeCompare(b.name))
                              .map((character) => (
                                <div 
                                  key={character.id} 
                                  className="book-detail-character-item"
                                >
                                  <span className="character-name">{character.name}</span>
                                </div>
                              ))}
                          </div>
                        )}
                        <button
                          className="book-detail-more-btn"
                          onClick={() => setShowMoreCharacters(!showMoreCharacters)}
                          aria-expanded={showMoreCharacters}
                        >
                          {showMoreCharacters ? '일반 인물 숨기기' : `일반 인물 더보기 (${otherCharacters.length}명)`}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              {bookDetails.chapters && bookDetails.chapters.length > 0 && (
                <div className="book-detail-section">
                  <div className="book-detail-label">챕터 정보</div>
                  <div className="book-detail-value">
                    <div className="book-detail-chapters-list">
                      {bookDetails.chapters.map((chapter, index) => {
                        const chapterTitle = chapter.title || 
                                             chapter.chapterTitle || 
                                             chapter.name || 
                                             chapter.chapterName ||
                                             '';
                        const chapterIdx = chapter.idx || 
                                         chapter.chapterIdx || 
                                         chapter.chapter || 
                                         chapter.number ||
                                         (index + 1);
                        return (
                          <div key={index} className="book-detail-chapter-item">
                            {chapterIdx}. {chapterTitle || '(제목 없음)'}
                          </div>
                        );
                      })}
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
            <button
              className="book-detail-danger-btn"
              onClick={handleDeleteBook}
              type="button"
              aria-label="책 삭제"
              style={{
                backgroundColor: '#dc2626',
                color: 'white',
                border: '1px solid #dc2626',
                marginTop: '8px'
              }}
            >
              삭제
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});

BookDetailModal.propTypes = {
  book: PropTypes.object,
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onDelete: PropTypes.func
};

BookDetailModal.displayName = 'BookDetailModal';

export default BookDetailModal;

