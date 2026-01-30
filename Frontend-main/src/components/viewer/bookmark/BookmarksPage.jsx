import React, { useState, useMemo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useBookmarks } from '../../../hooks/bookmarks/useBookmarks';
import { useBookmarkSort } from '../../../hooks/bookmarks/useBookmarkSort';
import {
  bookmarkColors,
  bookmarkBorders,
  colorOptions,
  getColorKey,
  formatRelativeTime,
  formatAbsoluteTime,
  parseBookmarkLocation,
} from '../../../utils/bookmarkUtils';

const getLocationLabel = (bookmark) => {
  return parseBookmarkLocation(bookmark);
};

const getLocationDetail = (bookmark) => {
  return parseBookmarkLocation(bookmark);
};

const getHighlightSnippet = (bookmark) => {
  const text = bookmark?.highlightText || bookmark?.textSnippet;
  if (!text) return '';
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
};

const parseMemoEntries = (memo) => {
  if (!memo) return [];
  if (Array.isArray(memo)) {
    return memo.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof memo === 'string') {
    try {
      const parsed = JSON.parse(memo);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => String(entry).trim()).filter(Boolean);
      }
    } catch {
      // ignore JSON parse errors, fall back to newline split
    }
    return memo
      .split('\n')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (memo && typeof memo === 'object' && Array.isArray(memo.entries)) {
    return memo.entries.map((entry) => String(entry).trim()).filter(Boolean);
  }
  return [];
};

const serializeMemoEntries = (entries) => {
  if (!entries || entries.length === 0) {
    return '';
  }
  return entries.map((entry) => entry.trim()).filter(Boolean).join('\n');
};

const BookmarksPage = () => {
  const { filename } = useParams();
  const navigate = useNavigate();
  const cleanFilename = filename ? filename.replace(/^\//, '') : null;
  const viewerPath = useMemo(() => {
    if (cleanFilename) return `/viewer/${cleanFilename}`;
    if (filename) return `/viewer/${filename.replace(/^\//, '')}`;
    return '/viewer';
  }, [cleanFilename, filename]);
  const [newMemo, setNewMemo] = useState({});
  const [editingMemo, setEditingMemo] = useState({ bookmarkId: null, entryIndex: null, text: '' });
  const [sortOrder, setSortOrder] = useState('recent'); // 'recent' | 'oldest' | 'position'
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');
  const [memoComposer, setMemoComposer] = useState(null);
  const resetEditingMemo = useCallback(() => {
    setEditingMemo({ bookmarkId: null, entryIndex: null, text: '' });
  }, []);
  
  // 북마크 hook 사용 (bookId는 filename을 사용)
  const { bookmarks, loading, removeBookmark, changeBookmarkColor, changeBookmarkMemo } = useBookmarks(cleanFilename);

  const availableTags = useMemo(() => {
    const tags = new Set();
    (bookmarks || []).forEach((bookmark) => {
      (bookmark.tags || []).forEach((tag) => tags.add(tag));
    });
    return Array.from(tags);
  }, [bookmarks]);

  const filterBySearch = useCallback((bookmark, term) => {
    if (!term) return true;
    const lower = term.toLowerCase();
    const candidate = [
      bookmark.memo,
      bookmark.highlightText,
      bookmark.textSnippet,
      bookmark.chapterTitle,
      bookmark.startCfi,
    ].filter(Boolean).join(' ').toLowerCase();
    return candidate.includes(lower);
  }, []);

  const filteredBookmarks = useMemo(() => {
    if (!bookmarks || bookmarks.length === 0) return [];
    return bookmarks.filter((bookmark) => {
      const tagMatch = selectedTag === 'all' || (bookmark.tags || []).includes(selectedTag);
      return tagMatch && filterBySearch(bookmark, searchTerm.trim());
    });
  }, [bookmarks, selectedTag, searchTerm, filterBySearch]);

  const sortedBookmarks = useBookmarkSort(filteredBookmarks, sortOrder);
  const isFilteredView = searchTerm.trim().length > 0 || selectedTag !== 'all';

  const handleDeleteBookmark = async (bookmarkId) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return { success: false };
    setNewMemo(prev => ({ ...prev, [bookmarkId]: '' }));
    if (memoComposer === bookmarkId) setMemoComposer(null);
    if (editingMemo.bookmarkId === bookmarkId) resetEditingMemo();
    const result = await removeBookmark(bookmarkId);
    if (!result.success) {
      alert(result.message || '북마크 삭제에 실패했습니다.');
    }
    return result;
  };

  const handleAddMemo = async (bookmarkId, memoText) => {
    const text = (memoText || '').trim();
    if (!text) return;
    
    const target = (bookmarks || []).find((bookmark) => bookmark.id === bookmarkId);
    const existingEntries = target ? parseMemoEntries(target.memo) : [];
    const combinedMemo = serializeMemoEntries([...existingEntries, text]);

    const result = await changeBookmarkMemo(bookmarkId, combinedMemo);
    if (result.success) {
      setNewMemo(prev => ({ ...prev, [bookmarkId]: '' }));
      setMemoComposer(null);
    } else {
      alert(result.message || '메모 추가에 실패했습니다.');
    }
    return result;
  };

  const handleEditMemo = (bookmarkId, entryIndex, currentMemo) => {
    setEditingMemo({ bookmarkId, entryIndex, text: currentMemo });
    setMemoComposer(null);
  };

  const handleEditMemoSave = async () => {
    const { bookmarkId, entryIndex, text } = editingMemo;
    if (!text || !text.trim()) return;

    const target = (bookmarks || []).find((bookmark) => bookmark.id === bookmarkId);
    const entries = target ? parseMemoEntries(target.memo) : [];
    if (entryIndex == null || entryIndex < 0 || entryIndex >= entries.length) {
      return;
    }

    const updatedEntries = [...entries];
    updatedEntries[entryIndex] = text.trim();
    const serialized = serializeMemoEntries(updatedEntries);

    const result = await changeBookmarkMemo(bookmarkId, serialized);
    if (result.success) {
      resetEditingMemo();
    } else {
      alert(result.message || '메모 수정에 실패했습니다.');
    }
    return result;
  };

  const handleOpenMemoComposer = (bookmarkId) => {
    setMemoComposer((prev) => (prev === bookmarkId ? null : bookmarkId));
    setNewMemo(prev => ({ ...prev, [bookmarkId]: prev[bookmarkId] || '' }));
    resetEditingMemo();
  };

  const handleCancelMemoComposer = (bookmarkId) => {
    setMemoComposer((prev) => (prev === bookmarkId ? null : prev));
    setNewMemo(prev => ({ ...prev, [bookmarkId]: '' }));
  };

  const handleChangeColor = async (bookmarkId, color) => {
    const result = await changeBookmarkColor(bookmarkId, color);
    if (!result.success) {
      alert(result.message || '색상 변경에 실패했습니다.');
    }
    return result;
  };

  const renderBookmark = (bookmark) => {
    if (!bookmark) return null;
    const colorKey = getColorKey(bookmark.color);
    const highlight = getHighlightSnippet(bookmark);
    const memoEntries = parseMemoEntries(bookmark.memo);
    const isComposerOpen = memoComposer === bookmark.id;
    const isEditingBookmark = editingMemo.bookmarkId === bookmark.id;
    const tags = bookmark.tags || [];

    return (
      <div
        key={bookmark.id}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem',
          background: bookmarkColors[colorKey],
          border: `1px solid ${bookmarkBorders[colorKey]}`,
          borderRadius: 18,
          padding: '1.3rem 1.5rem',
          boxShadow: '0 18px 32px rgba(21, 25, 71, 0.08)',
          cursor: 'default',
          transition: 'transform 0.18s ease, box-shadow 0.18s ease',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', minWidth: 0 }}>
              <span className="material-symbols-outlined" style={{ fontSize: '1.05rem', color: '#4c7050' }}>
                auto_stories
              </span>
              <span style={{ fontSize: '1rem', fontWeight: 600, color: '#1f2a44', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {getLocationLabel(bookmark)}
              </span>
            </div>
            <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
              {getLocationDetail(bookmark)}
            </span>
            {!!tags.length && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.35rem' }}>
                {tags.map((tag) => (
                  <span
                    key={tag}
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      color: '#256d4a',
                      background: 'rgba(82, 126, 88, 0.18)',
                      borderRadius: 999,
                      padding: '0.22rem 0.6rem',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexShrink: 0 }}>
            <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
              {formatRelativeTime(bookmark.createdAt || bookmark.created_at)}
            </span>
            <span style={{ fontSize: '0.7rem', color: '#cbd5f0' }}>•</span>
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {formatAbsoluteTime(bookmark.createdAt || bookmark.created_at)}
            </span>
          </div>
        </div>

        {highlight && (
          <div
            style={{
              background: 'rgba(255,255,255,0.66)',
              borderRadius: 12,
              padding: '0.85rem 1rem',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              color: '#1f2a44',
            }}
          >
            <span style={{ color: '#94a3b8', fontWeight: 600, fontSize: '0.74rem', marginRight: '0.5rem' }}>
              하이라이트
            </span>
            {highlight}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '1rem', color: '#6b7280' }}>
              sticky_note_2
            </span>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {memoEntries.length > 0 ? (
                memoEntries.map((entry, entryIndex) => {
                  const isEditingEntry =
                    isEditingBookmark && editingMemo.entryIndex === entryIndex;
                  return (
                    <div
                      key={`${bookmark.id}-memo-${entryIndex}`}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.6rem',
                      }}
                    >
                      {isEditingEntry ? (
                        <>
                          <input
                            value={editingMemo.text}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setEditingMemo((prev) => ({
                                ...prev,
                                text: e.target.value,
                              }))
                            }
                            onKeyDown={(e) => {
                              e.stopPropagation();
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleEditMemoSave();
                              }
                            }}
                            autoFocus
                            style={{
                              flex: 1,
                              padding: '0.48rem 0.8rem',
                              borderRadius: 12,
                              border: '1px solid rgba(86,122,182,0.28)',
                              fontSize: '0.9rem',
                              outline: 'none',
                              background: 'rgba(255,255,255,0.92)',
                            }}
                          />
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditMemoSave();
                            }}
                            style={{
                              padding: '0.48rem 0.95rem',
                              borderRadius: 10,
                              border: 'none',
                              background: '#365d45',
                              color: '#fff',
                              fontSize: '0.85rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            저장
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              resetEditingMemo();
                            }}
                            style={{
                              padding: '0.48rem 0.95rem',
                              borderRadius: 10,
                              border: '1px solid rgba(86,122,182,0.14)',
                              background: 'rgba(255,255,255,0.85)',
                              color: '#6b7280',
                              fontSize: '0.85rem',
                              fontWeight: 500,
                              cursor: 'pointer',
                            }}
                          >
                            취소
                          </button>
                        </>
                      ) : (
                        <>
                          <span style={{ flex: 1, fontSize: '0.9rem', color: '#1f2a44', lineHeight: 1.55 }}>
                            {entry}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEditMemo(bookmark.id, entryIndex, entry);
                            }}
                            style={{
                              border: 'none',
                              background: 'transparent',
                              color: '#306248',
                              fontSize: '0.84rem',
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            수정
                          </button>
                        </>
                      )}
                    </div>
                  );
                })
              ) : (
                <span style={{ fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic' }}>
                  메모가 비어 있습니다.
                </span>
              )}
            </div>
          </div>

          {isComposerOpen ? (
            <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
              <input
                value={newMemo[bookmark.id] || ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => setNewMemo((prev) => ({ ...prev, [bookmark.id]: e.target.value }))}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddMemo(bookmark.id, e.currentTarget.value);
                  }
                }}
                placeholder="메모를 입력하세요"
                style={{
                  flex: 1,
                  padding: '0.5rem 0.85rem',
                  borderRadius: 12,
                  border: '1px solid rgba(86,122,182,0.24)',
                  background: 'rgba(255,255,255,0.92)',
                  fontSize: '0.9rem',
                  outline: 'none',
                }}
              />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleAddMemo(bookmark.id, newMemo[bookmark.id]);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 10,
                  border: 'none',
                  background: '#365d45',
                  color: '#fff',
                  fontSize: '0.85rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                추가
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleCancelMemoComposer(bookmark.id);
                }}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: 10,
                  border: '1px solid rgba(86,122,182,0.14)',
                  background: 'rgba(255,255,255,0.85)',
                  color: '#6b7280',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                닫기
              </button>
            </div>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleOpenMemoComposer(bookmark.id);
              }}
              style={{
                alignSelf: 'flex-start',
                padding: '0.5rem 1rem',
                borderRadius: 999,
                border: 'none',
                background: 'rgba(82,126,88,0.18)',
                color: '#256d4a',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              메모 추가
            </button>
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1.2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
            {colorOptions.map((option) => (
              <button
                key={option.key}
                onClick={(e) => {
                  e.stopPropagation();
                  handleChangeColor(bookmark.id, option.color);
                }}
                title={option.label}
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  border: `2px solid ${option.border}`,
                  background: option.color,
                  boxShadow: colorKey === option.key ? '0 0 0 2px rgba(44,87,58,0.45)' : 'none',
                  opacity: colorKey === option.key ? 1 : 0.6,
                  transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = 'translateY(-1px) scale(1.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = 'translateY(0) scale(1)';
                }}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: '0.65rem' }}>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDeleteBookmark(bookmark.id);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.5rem 0.95rem',
                borderRadius: 12,
                border: 'none',
                background: '#f76c6c',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <span className="material-symbols-outlined" style={{ fontSize: '1rem' }}>delete</span>
              삭제
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#22336b', fontWeight: 600 }}>북마크</h1>
          <span style={{ 
            background: '#EEF2FF', 
            color: '#5C6F5C', 
            padding: '0.3rem 0.8rem', 
            borderRadius: '1rem', 
            fontSize: '0.9rem', 
            fontWeight: 600 
          }}>
            {bookmarks.length}개
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {/* 정렬 옵션 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: 500 }}>정렬:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '0.5rem',
                border: '1px solid #e5e7eb',
                background: 'white',
                fontSize: '0.9rem',
                color: '#374151',
                cursor: 'pointer',
                outline: 'none'
              }}
            >
              <option value="recent">최신순</option>
              <option value="oldest">오래된순</option>
              <option value="position">위치순</option>
            </select>
          </div>
          
          <button
            style={{
              background: 'linear-gradient(135deg, #5C6F5C 0%, #4A5A4A 100%)',
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
            onClick={() => navigate(viewerPath)}
          >
            뷰어로 돌아가기
          </button>
        </div>
      </div>

      {sortedBookmarks.length === 0 ? (
        <div style={{ 
          textAlign: 'center', 
          margin: '4rem 0', 
          color: '#6b7280',
          background: '#f8f9fc',
          borderRadius: '1rem',
          padding: '3rem',
          boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
        }}>
          <p style={{ fontSize: '1.1rem' }}>
            {isFilteredView ? '조건에 맞는 북마크가 없습니다.' : '저장된 북마크가 없습니다.'}
          </p>
          <p>
            {isFilteredView ? '검색어와 태그를 조정해보세요.' : '책을 읽으면서 북마크를 추가해보세요!'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {sortedBookmarks.map((bookmark) => renderBookmark(bookmark))}
        </div>
      )}
    </div>
  );
};

export default BookmarksPage;
