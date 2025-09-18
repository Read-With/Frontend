import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { theme } from '../common/theme';
import { getBookManifest } from '../../utils/api';
import { createButtonStyle, createAdvancedButtonHandlers } from '../../utils/styles/styles';
import { ANIMATION_VALUES } from '../../utils/styles/animations';

const BookDetailModal = ({ book, isOpen, onClose }) => {
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

  const fetchProgressInfo = () => {
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
  };

  const fetchBookDetails = async () => {
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
        setBookDetails(book);
      }
    } catch (err) {
      setError('책 정보를 불러오는데 실패했습니다.');
      setBookDetails(book);
    } finally {
      setLoading(false);
    }
  };

  const modalStyle = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: isOpen ? 'flex' : 'none',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    padding: '20px'
  };

  const contentStyle = {
    backgroundColor: theme.colors.background.white,
    borderRadius: theme.borderRadius.lg,
    maxWidth: '600px',
    width: '100%',
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)',
    position: 'relative'
  };

  const headerStyle = {
    padding: '24px 24px 16px 24px',
    borderBottom: `1px solid ${theme.colors.border}`,
    display: 'flex',
    alignItems: 'flex-start',
    gap: '16px'
  };

  const coverStyle = {
    width: '120px',
    height: '180px',
    borderRadius: theme.borderRadius.md,
    objectFit: 'cover',
    flexShrink: 0,
    backgroundColor: theme.colors.background.card
  };

  const titleStyle = {
    fontSize: theme.fontSize.xl,
    fontWeight: 700,
    color: theme.colors.text.primary,
    marginBottom: '8px',
    lineHeight: 1.3
  };

  const authorStyle = {
    fontSize: theme.fontSize.lg,
    color: theme.colors.text.secondary,
    marginBottom: '12px'
  };

  const closeButtonStyle = {
    position: 'absolute',
    top: '16px',
    right: '16px',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    border: 'none',
    backgroundColor: theme.colors.background.card,
    color: theme.colors.text.secondary,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '18px',
    transition: 'all 0.2s ease'
  };

  const bodyStyle = {
    padding: '24px'
  };

  const sectionStyle = {
    marginBottom: '20px'
  };

  const labelStyle = {
    fontSize: theme.fontSize.sm,
    fontWeight: 600,
    color: theme.colors.text.secondary,
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px'
  };

  const valueStyle = {
    fontSize: theme.fontSize.base,
    color: theme.colors.text.primary,
    lineHeight: 1.5
  };

  const buttonGroupStyle = {
    display: 'flex',
    gap: '4px',
    justifyContent: 'center',
    marginTop: '24px',
    paddingTop: '20px',
    borderTop: `1px solid ${theme.colors.border}`
  };

  const primaryButtonStyle = {
    ...createButtonStyle(ANIMATION_VALUES, 'primary'),
    padding: '8px 16px',
    fontSize: theme.fontSize.sm,
    borderRadius: theme.borderRadius.full,
    minWidth: '80px',
    height: 'auto'
  };

  const secondaryButtonStyle = {
    ...createButtonStyle(ANIMATION_VALUES, 'default'),
    padding: '8px 16px',
    fontSize: theme.fontSize.sm,
    borderRadius: theme.borderRadius.full,
    background: '#f0f4fa',
    color: theme.colors.primary,
    border: 'none',
    minWidth: '80px',
    height: 'auto'
  };

  const handleReadClick = () => {
    onClose();
    // 로컬 책인지 확인
    const isLocalBook = typeof book.id === 'string' && book.id.startsWith('local_');
    // 로컬 책은 filename을 사용, API 책은 id를 사용
    const identifier = isLocalBook ? book.epubPath : book.id;
    // API 책인 경우 책 정보를 state로 전달
    const state = isLocalBook ? undefined : { book };
    navigate(`/user/viewer/${identifier}`, { state });
  };

  const handleGraphClick = () => {
    onClose();
    // 로컬 책인지 확인
    const isLocalBook = typeof book.id === 'string' && book.id.startsWith('local_');
    // 로컬 책은 filename을 사용, API 책은 id를 사용
    const identifier = isLocalBook ? book.epubPath : book.id;
    // API 책인 경우 책 정보를 state로 전달
    const state = isLocalBook ? undefined : { book };
    navigate(`/user/graph/${identifier}`, { state });
  };

  if (!isOpen) return null;

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={(e) => e.stopPropagation()}>
        <button
          style={closeButtonStyle}
          onClick={onClose}
          onMouseEnter={(e) => {
            e.target.style.backgroundColor = theme.colors.background.section;
          }}
          onMouseLeave={(e) => {
            e.target.style.backgroundColor = theme.colors.background.card;
          }}
        >
          ×
        </button>

        <div style={headerStyle}>
          <div style={coverStyle}>
            <img
              src={bookDetails?.coverImgUrl || book?.coverImgUrl}
              alt={bookDetails?.title || book?.title}
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                borderRadius: theme.borderRadius.md,
                display: 'block'
              }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <h2 style={titleStyle}>
              {bookDetails?.title || book?.title || '제목 없음'}
            </h2>
            <p style={authorStyle}>
              {bookDetails?.author || book?.author || '저자 정보 없음'}
            </p>
            {loading && (
              <div style={{ color: theme.colors.text.secondary, fontSize: theme.fontSize.sm }}>
                정보를 불러오는 중...
              </div>
            )}
            {error && (
              <div style={{ color: theme.colors.error, fontSize: theme.fontSize.sm }}>
                {error}
              </div>
            )}
          </div>
        </div>

        <div style={bodyStyle}>
          {bookDetails && (
            <>

              {uniqueCharacters && uniqueCharacters.length > 0 && (
                <div style={sectionStyle}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '4px'
                  }}>
                    <div style={labelStyle}>등장 인물</div>
                    <button
                      onClick={() => setShowCharacters(!showCharacters)}
                      style={{
                        background: theme.colors.background.card,
                        border: `1px solid ${theme.colors.border}`,
                        borderRadius: theme.borderRadius.sm,
                        color: theme.colors.text.primary,
                        cursor: 'pointer',
                        fontSize: '0.75em',
                        fontWeight: 500,
                        padding: '4px 8px',
                        transition: 'all 0.2s ease'
                      }}
                      onMouseEnter={(e) => {
                        e.target.style.backgroundColor = theme.colors.background.primary;
                        e.target.style.borderColor = theme.colors.primary;
                      }}
                      onMouseLeave={(e) => {
                        e.target.style.backgroundColor = theme.colors.background.card;
                        e.target.style.borderColor = theme.colors.border;
                      }}
                    >
                      {showCharacters ? '숨기기' : '보기'}
                    </button>
                  </div>
                  <div style={valueStyle}>
                    {showCharacters && (
                      <div style={{ marginTop: '8px', fontSize: '0.9em', color: theme.colors.text.secondary }}>
                        {uniqueCharacters.map((character, index) => (
                          <div key={character.id} style={{ marginBottom: '4px' }}>
                            {character.name} {character.isMainCharacter && '⭐'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {bookDetails.chapters && bookDetails.chapters.length > 0 && (
                <div style={sectionStyle}>
                  <div style={labelStyle}>챕터 정보</div>
                  <div style={valueStyle}>
                    <div style={{ marginTop: '8px', fontSize: '0.9em', color: theme.colors.text.secondary }}>
                      {bookDetails.chapters.map((chapter, index) => (
                        <div key={index} style={{ marginBottom: '4px' }}>
                          {chapter.idx}. {chapter.title}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* 최근에 읽은 시점 */}
              {progressInfo && (
                <div style={sectionStyle}>
                  <div style={labelStyle}>최근에 읽은 시점</div>
                  <div style={valueStyle}>
                    {progressInfo.currentChapter && (
                      <div style={{ marginBottom: '4px' }}>
                        챕터 {progressInfo.currentChapter}장
                      </div>
                    )}
                    {progressInfo.currentPage && progressInfo.totalPages && (
                      <div style={{ marginBottom: '4px' }}>
                        {progressInfo.currentPage} / {progressInfo.totalPages} 페이지
                      </div>
                    )}
                    {progressInfo.progress && (
                      <div style={{ marginBottom: '4px' }}>
                        진도: {Math.round(progressInfo.progress * 100)}%
                      </div>
                    )}
                  </div>
                </div>
              )}

              {bookDetails.updatedAt && (
                <div style={sectionStyle}>
                  <div style={labelStyle}>업데이트 일시</div>
                  <div style={valueStyle}>
                    {new Date(bookDetails.updatedAt).toLocaleString('ko-KR')}
                  </div>
                </div>
              )}
            </>
          )}

          <div style={buttonGroupStyle}>
            <button
              style={primaryButtonStyle}
              onClick={handleReadClick}
              {...createAdvancedButtonHandlers('primary')}
            >
              읽기
            </button>
            <button
              style={secondaryButtonStyle}
              onClick={handleGraphClick}
              {...createAdvancedButtonHandlers('default')}
            >
              그래프
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BookDetailModal;
