import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { loadBookmarks, removeBookmark, modifyBookmark } from './BookmarkManager';
import { createButtonStyle, createAdvancedButtonHandlers } from '../../../utils/styles/styles';
import { ANIMATION_VALUES } from '../../../utils/styles/animations';

const bookmarkColors = {
  normal: '#f4f7ff', // 연회색(이전 페이지와 통일)
  important: '#fff3c2', // 노랑 (더 부드럽게)
  highlight: '#e0e7ff', // 파랑(더 부드럽게)
};

const bookmarkBorders = {
  normal: '#e7eaf7',
  important: '#ffd600',
  highlight: '#4F6DDE',
};

// 위치 정보 파싱 함수: 장 + 페이지까지만 표시
function parseCfiToChapterPage(cfi) {
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? `${chapterMatch[1]}장` : null;
  // [chapter-x]/숫+ 추출 (페이지)
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  const page = pageMatch ? `${pageMatch[1]}페이지` : null;
  if (chapter && page) return `${chapter} ${page}`;
  if (chapter) return chapter;
  return cfi;
}

// 위치 정보 파싱 함수 개선: 장 + [chapter-x] 뒤의 전체 경로
function parseCfiToChapterFullDetail(cfi) {
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? `${chapterMatch[1]}장` : null;
  // [chapter-x] 뒤의 전체 경로 추출 (예: /220/1:305)
  const afterChapterMatch = cfi.match(/\[chapter-\d+\]((?:\/\d+)+:\d+)/);
  const detail = afterChapterMatch ? afterChapterMatch[1].replace(/^\//, '') : null;
  if (chapter && detail) return `${chapter} ${detail}`;
  if (chapter) return chapter;
  return cfi;
}

const BookmarksPage = () => {
  const { filename } = useParams();
  const navigate = useNavigate();
  const cleanFilename = filename ? filename.replace(/^\//, '') : null;
  const [bookmarks, setBookmarks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newMemo, setNewMemo] = useState({});
  const [editingMemo, setEditingMemo] = useState({});

  // 북마크 로드
  useEffect(() => {
    const fetchBookmarks = async () => {
      if (!cleanFilename) return;
      
      setLoading(true);
      try {
        const bookmarksData = await loadBookmarks(cleanFilename);
        setBookmarks(bookmarksData);
      } catch (error) {
      } finally {
        setLoading(false);
      }
    };

    fetchBookmarks();
  }, [cleanFilename]);

  const handleDeleteBookmark = async (bookmarkId) => {
    try {
      const result = await removeBookmark(bookmarkId);
      if (result.success) {
        setBookmarks(prev => prev.filter(b => b.id !== bookmarkId));
      } else {
        alert(result.message || '북마크 삭제에 실패했습니다.');
      }
    } catch (error) {
      alert('북마크 삭제에 실패했습니다.');
    }
  };

  const handleAddMemo = async (bookmarkId, memoText) => {
    if (!memoText.trim()) return;
    
    try {
      const result = await modifyBookmark(bookmarkId, null, memoText);
      if (result.success) {
        setBookmarks(prev => prev.map(b => 
          b.id === bookmarkId ? { ...b, memo: memoText } : b
        ));
        setNewMemo(prev => ({ ...prev, [bookmarkId]: '' }));
      } else {
        alert(result.message || '메모 추가에 실패했습니다.');
      }
    } catch (error) {
      alert('메모 추가에 실패했습니다.');
    }
  };

  const handleEditMemo = (bookmarkId, currentMemo) => {
    setEditingMemo({ bookmarkId, text: currentMemo });
  };

  const handleEditMemoSave = async () => {
    const { bookmarkId, text } = editingMemo;
    if (!text.trim()) return;
    
    try {
      const result = await modifyBookmark(bookmarkId, null, text);
      if (result.success) {
        setBookmarks(prev => prev.map(b => 
          b.id === bookmarkId ? { ...b, memo: text } : b
        ));
        setEditingMemo({});
      } else {
        alert(result.message || '메모 수정에 실패했습니다.');
      }
    } catch (error) {
      alert('메모 수정에 실패했습니다.');
    }
  };

  const handleChangeColor = async (bookmarkId, color) => {
    try {
      const result = await modifyBookmark(bookmarkId, color, null);
      if (result.success) {
        setBookmarks(prev => prev.map(b => 
          b.id === bookmarkId ? { ...b, color } : b
        ));
      } else {
        alert(result.message || '색상 변경에 실패했습니다.');
      }
    } catch (error) {
      alert('색상 변경에 실패했습니다.');
    }
  };

  const handleAddBookmark = () => {
    // ... 이하 생략
  };

  // 북마크를 3개씩 그룹화하는 함수 (2개씩에서 3개씩으로 변경)
  const getBookmarkGroups = () => {
    const groups = [];
    for (let i = 0; i < bookmarks.length; i += 3) {
      groups.push([
        bookmarks[i],
        i + 1 < bookmarks.length ? bookmarks[i + 1] : null,
        i + 2 < bookmarks.length ? bookmarks[i + 2] : null
      ]);
    }
    return groups;
  };

  // 카드 너비 계산 (3개 기준)
  const cardWidth = 'calc((100% - 2.4rem) / 3)'; // 1.2rem 간격 * 2 = 2.4rem

  const renderBookmark = (bm, bIdx, isLast) => {
    // 마지막 요소가 아닌 경우에만 오른쪽 여백 추가
    const marginRight = isLast ? '0' : '1.2rem';
    
    if (!bm) return (
      <div
        style={{
          flex: '0 0 calc(33.33% - 0.8rem)',
          marginRight: marginRight,
          visibility: 'hidden'
        }}
      />
    );

    const getColorKey = (color) => {
      if (color === '#fff3c2') return 'important';
      if (color === '#e0e7ff') return 'highlight';
      return 'normal';
    };

    const colorKey = getColorKey(bm.color);

    return (
      <div
        key={bm.id}
        style={{
          background: bookmarkColors[colorKey],
          borderRadius: 12,
          boxShadow: '0 2px 10px rgba(79,109,222,0.07)',
          padding: '1.2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.7rem',
          border: `1px solid ${bookmarkBorders[colorKey]}`,
          position: 'relative',
          fontFamily: 'var(--font-family-primary)',
          flex: '0 0 calc(33.33% - 0.8rem)',
          marginRight: marginRight,
          height: '100%',
          maxWidth: 'calc(33.33% - 0.8rem)',
          boxSizing: 'border-box',
          overflow: 'hidden'
        }}
      >
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          gap: '0.5rem', 
          borderBottom: '1px solid rgba(0,0,0,0.05)', 
          paddingBottom: '0.5rem' 
        }}>
          <div style={{ 
            width: 24, 
            height: 24, 
            borderRadius: '50%', 
            background: '#6C8EFF', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            color: 'white', 
            fontSize: '0.8rem', 
            fontWeight: 'bold' 
          }}>
            📑
          </div>
          <span style={{ 
            fontSize: '0.85rem', 
            color: '#22336b', 
            fontWeight: 600, 
            flex: 1, 
            whiteSpace: 'nowrap', 
            overflow: 'hidden', 
            textOverflow: 'ellipsis' 
          }}>
            {parseCfiToChapterPage(bm.startCfi)}
          </span>
          <span style={{ 
            fontSize: '0.75rem', 
            color: '#6b7280', 
            whiteSpace: 'nowrap' 
          }}>
            {new Date(bm.createdAt).toLocaleDateString()}
          </span>
        </div>

        {/* 메모 표시 */}
        <div style={{ flex: 1, minHeight: '80px' }}>
          {bm.memo ? (
            <div style={{ 
              background: 'rgba(255,255,255,0.7)', 
              borderRadius: 6, 
              padding: '0.5rem',
              fontSize: '0.85rem',
              color: '#22336b',
              fontWeight: 500,
              minHeight: '60px',
              display: 'flex',
              alignItems: 'center'
            }}>
              {editingMemo.bookmarkId === bm.id ? (
                <div style={{ display: 'flex', gap: '0.5rem', width: '100%' }}>
                  <input
                    value={editingMemo.text}
                    onChange={e => setEditingMemo(prev => ({ ...prev, text: e.target.value }))}
                    style={{ 
                      fontSize: '0.85rem', 
                      padding: '0.3rem 0.5rem', 
                      borderRadius: 6, 
                      border: '1px solid #e7eaf7', 
                      outline: 'none', 
                      flex: 1 
                    }}
                    autoFocus
                  />
                  <button
                    style={{ 
                      fontSize: '0.8rem', 
                      color: '#4F6DDE', 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      fontWeight: 700 
                    }}
                    onClick={handleEditMemoSave}
                  >저장</button>
                  <button
                    style={{ 
                      fontSize: '0.8rem', 
                      color: '#bfc8e6', 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      fontWeight: 700 
                    }}
                    onClick={() => setEditingMemo({})}
                  >취소</button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '100%' }}>
                  <span style={{ flex: 1 }}>{bm.memo}</span>
                  <button
                    style={{ 
                      fontSize: '0.9rem', 
                      color: '#4F6DDE', 
                      background: 'none', 
                      border: 'none', 
                      cursor: 'pointer', 
                      padding: '0 0.2rem' 
                    }}
                    onClick={() => handleEditMemo(bm.id, bm.memo)}
                  >✏️</button>
                </div>
              )}
            </div>
          ) : (
            <div style={{ 
              fontSize: '0.85rem', 
              color: '#94a3b8', 
              fontStyle: 'italic', 
              padding: '0.5rem 0' 
            }}>
              메모 없음
            </div>
          )}
        </div>

        {/* 새 메모 입력 */}
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            style={{ 
              fontSize: '0.85rem', 
              padding: '0.3rem 0.7rem', 
              borderRadius: 6, 
              border: '1px solid #e7eaf7', 
              outline: 'none', 
              flex: 1, 
              background: 'white' 
            }}
            value={newMemo[bm.id] || ''}
            onChange={e => setNewMemo(prev => ({ ...prev, [bm.id]: e.target.value }))}
            placeholder="메모 추가"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMemo(bm.id, e.target.value); } }}
          />
          <button
            style={{ 
              fontSize: '0.85rem', 
              background: '#6C8EFF', 
              color: '#fff', 
              border: 'none', 
              borderRadius: 6, 
              padding: '0.3rem 0.7rem', 
              fontWeight: 600, 
              cursor: 'pointer',
              whiteSpace: 'nowrap'
            }}
            onClick={() => handleAddMemo(bm.id, newMemo[bm.id])}
          >추가</button>
        </div>

        {/* 하단 액션 버튼 */}
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'space-between', 
          borderTop: '1px solid rgba(0,0,0,0.05)', 
          paddingTop: '0.5rem' 
        }}>
          <div style={{ display: 'flex', gap: '0.3rem' }}>
            <button
              title="일반"
              style={{ 
                width: 18, 
                height: 18, 
                borderRadius: '50%', 
                border: `1px solid ${bookmarkBorders.normal}`, 
                background: bookmarkColors.normal, 
                boxShadow: colorKey === 'normal' ? '0 0 0 2px #4F6DDE' : 'none', 
                outline: 'none', 
                cursor: 'pointer', 
                opacity: colorKey === 'normal' ? 1 : 0.6 
              }}
              onClick={() => handleChangeColor(bm.id, bookmarkColors.normal)}
            />
            <button
              title="중요"
              style={{ 
                width: 18, 
                height: 18, 
                borderRadius: '50%', 
                border: `1px solid ${bookmarkBorders.important}`, 
                background: bookmarkColors.important, 
                boxShadow: colorKey === 'important' ? '0 0 0 2px #FFD600' : 'none', 
                outline: 'none', 
                cursor: 'pointer', 
                opacity: colorKey === 'important' ? 1 : 0.6 
              }}
              onClick={() => handleChangeColor(bm.id, bookmarkColors.important)}
            />
            <button
              title="강조"
              style={{ 
                width: 18, 
                height: 18, 
                borderRadius: '50%', 
                border: `1px solid ${bookmarkBorders.highlight}`, 
                background: bookmarkColors.highlight, 
                boxShadow: colorKey === 'highlight' ? '0 0 0 2px #4F6DDE' : 'none', 
                outline: 'none', 
                cursor: 'pointer', 
                opacity: colorKey === 'highlight' ? 1 : 0.6 
              }}
              onClick={() => handleChangeColor(bm.id, bookmarkColors.highlight)}
            />
          </div>
        
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              style={{ 
                background: '#6C8EFF', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 6, 
                fontWeight: 600, 
                fontSize: '0.85rem', 
                padding: '0.3rem 0.7rem', 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
              onClick={() => navigate(`/viewer/${filename}`, { state: { cfi: bm.startCfi } })}
            >
              <span style={{ fontSize: '0.7rem' }}>📖</span> 이동
            </button>
            <button
              style={{ 
                background: '#f87171', 
                color: '#fff', 
                border: 'none', 
                borderRadius: 6, 
                fontWeight: 600, 
                fontSize: '0.85rem', 
                padding: '0.3rem 0.7rem', 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.3rem'
              }}
              onClick={() => { if(window.confirm('정말 삭제하시겠습니까?')) handleDeleteBookmark(bm.id); }}
            >
              <span style={{ fontSize: '0.7rem' }}>🗑</span> 삭제
            </button>
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--font-family-primary)' }}>
        <div style={{ textAlign: 'center', margin: '4rem 0' }}>
          <div style={{ fontSize: '1.2rem', color: '#6b7280' }}>북마크를 불러오는 중...</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto', fontFamily: 'var(--font-family-primary)' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#22336b', fontWeight: 600 }}>북마크</h1>
        <button
          style={{
            background: 'linear-gradient(135deg, #6C8EFF 0%, #5A7BFF 100%)',
            color: 'white',
            border: 'none',
            padding: '0.6rem 1.2rem',
            borderRadius: '0.5rem',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            boxShadow: '0 2px 8px rgba(108, 142, 255, 0.2)',
            transition: 'all 0.2s ease',
          }}
          onClick={() => navigate(`/viewer/${cleanFilename}`)}
        >
          뷰어로 돌아가기
        </button>
      </div>

      {bookmarks.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          margin: '4rem 0', 
          color: '#6b7280',
          background: '#f8f9fc',
          borderRadius: '1rem',
          padding: '3rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
        }}>
          <p style={{ fontSize: '1.1rem' }}>저장된 북마크가 없습니다.</p>
          <p>책을 읽으면서 북마크를 추가해보세요!</p>
          <button
            style={{
              background: '#6C8EFF',
              color: 'white',
              border: 'none',
              padding: '0.6rem 1.2rem',
              borderRadius: '0.5rem',
              marginTop: '1rem',
              fontWeight: 500,
              cursor: 'pointer',
            }}
            onClick={() => navigate(`/viewer/${cleanFilename}`)}
          >
            뷰어로 돌아가기
          </button>
        </div>
      ) : (
        // 북마크 그룹(행)들
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
          {getBookmarkGroups().map((group, gIdx) => (
            <div key={gIdx} style={{ display: 'flex', gap: '1.2rem', minHeight: '200px' }}>
              {group.map((bm, i) => 
                bm ? renderBookmark(bm, gIdx * 3 + i, i === 2) : (
                  <div 
                    key={`empty-${i}`} 
                    style={{ 
                      flex: '0 0 calc(33.33% - 0.8rem)', 
                      visibility: 'hidden',
                      height: '100%' 
                    }} 
                  />
                )
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default BookmarksPage;
