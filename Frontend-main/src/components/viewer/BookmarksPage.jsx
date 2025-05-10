import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { loadBookmarks, saveBookmarks } from './epub/BookmarkManager';

const bookmarkColors = {
  normal: '#f4f7ff', // 연회색(이전 페이지와 통일)
  important: '#ffe066', // 노랑
  highlight: '#4F6DDE', // 파랑(이전 페이지와 통일)
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
  console.log('filename:', filename);
  const navigate = useNavigate();
  const cleanFilename = filename ? filename.replace(/^\//, '') : null;
  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(cleanFilename));
  const [newMemo, setNewMemo] = useState({});
  const [editingMemo, setEditingMemo] = useState({});

  // 실시간 동기화: localStorage 변경 감지 (filename 기반 key)
  useEffect(() => {
    console.log('북마크 불러오기 시 cleanFilename:', cleanFilename);
    if (!cleanFilename) return;
    const key = `bookmarks_${cleanFilename}`;
    const handleStorage = (e) => {
      if (e.key === key) {
        setBookmarks(loadBookmarks(cleanFilename));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [cleanFilename]);

  const handleDeleteBookmark = (cfi) => {
    if (!cleanFilename) return;
    const filtered = bookmarks.filter(b => b.cfi !== cfi);
    setBookmarks(filtered);
    saveBookmarks(cleanFilename, filtered);
  };

  const handleAddMemo = (bIdx) => {
    const text = (newMemo[bIdx] || '').trim();
    if (!text) return;
    const updated = bookmarks.map((b, i) =>
      i === bIdx
        ? {
            ...b,
            memos: [...(b.memos || []), { text, createdAt: new Date().toISOString() }],
          }
        : b
    );
    setBookmarks(updated);
    saveBookmarks(cleanFilename, updated);
    setNewMemo((prev) => ({ ...prev, [bIdx]: '' }));
  };

  const handleDeleteMemo = (bIdx, mIdx) => {
    const updated = bookmarks.map((b, i) =>
      i === bIdx
        ? {
            ...b,
            memos: b.memos.filter((_, j) => j !== mIdx),
          }
        : b
    );
    setBookmarks(updated);
    saveBookmarks(cleanFilename, updated);
  };

  const handleEditMemo = (bIdx, mIdx, text) => {
    setEditingMemo({ bIdx, mIdx, text });
  };
  const handleEditMemoSave = () => {
    const { bIdx, mIdx, text } = editingMemo;
    const updated = bookmarks.map((b, i) =>
      i === bIdx
        ? {
            ...b,
            memos: b.memos.map((m, j) =>
              j === mIdx ? { ...m, text } : m
            ),
          }
        : b
    );
    setBookmarks(updated);
    saveBookmarks(cleanFilename, updated);
    setEditingMemo({});
  };

  const handleChangeColor = (idx, color) => {
    const updated = bookmarks.map((b, i) =>
      i === idx ? { ...b, color } : b
    );
    setBookmarks(updated);
    saveBookmarks(cleanFilename, updated);
  };

  const handleAddBookmark = () => {
    console.log('북마크 추가 시 cleanFilename:', cleanFilename);
    // ... 이하 생략
  };

  return (
      <div style={{ maxWidth: 600, margin: '0 auto', marginTop: '2.5rem', background: '#fff', borderRadius: 20, boxShadow: '0 8px 32px rgba(79,109,222,0.18)', padding: '2.2rem 2rem 2rem 2rem', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1.5px solid #e7eaf7', paddingBottom: '1.1rem', marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#22336b', letterSpacing: '-1px' }}>📑 내 북마크 목록</h2>
          <button
            style={{ fontSize: '1.7rem', color: '#bfc8e6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, borderRadius: 8, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.18s, color 0.18s' }}
            onClick={() => navigate(-1)}
            aria-label="닫기"
            onMouseOver={e => e.currentTarget.style.background = '#f4f7ff'}
            onMouseOut={e => e.currentTarget.style.background = 'none'}
          >
            ×
          </button>
        </div>
        <ul style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', padding: 0, margin: 0, listStyle: 'none' }}>
          {bookmarks.length === 0 && (
            <li style={{ color: '#bfc8e6', textAlign: 'center', padding: '3rem 0', fontWeight: 600, fontSize: '1.1rem' }}>저장된 북마크가 없습니다.</li>
          )}
          {bookmarks.map((bm, bIdx) => (
            <li
              key={bIdx}
              style={{
                background: bookmarkColors[bm.color || 'normal'],
                borderRadius: 16,
                boxShadow: '0 2px 10px rgba(79,109,222,0.07)',
                padding: '1.3rem 1.2rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.7rem',
                border: '1.5px solid #e7eaf7',
                position: 'relative',
                fontFamily: "'Pretendard', 'Noto Sans KR', 'Inter', 'Segoe UI', 'Arial', sans-serif"
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1.2rem', marginBottom: '0.2rem' }}>
                <span style={{ fontSize: '0.98rem', color: '#6b7280' }}>{new Date(bm.createdAt).toLocaleString()}</span>
                <span style={{ fontSize: '0.98rem', color: '#4F6DDE', fontFamily: 'monospace' }}>위치: {parseCfiToChapterPage(bm.cfi)}</span>
              </div>
              {/* 메모 리스트 */}
              <div>
                {(bm.memos && bm.memos.length > 0) ? (
                  <ul style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem', padding: 0, margin: 0, listStyle: 'none' }}>
                    {bm.memos.map((m, mIdx) => (
                      <li key={mIdx} style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', background: '#f8f9fc', borderRadius: 8, padding: '0.3rem 0.7rem' }}>
                        {editingMemo.bIdx === bIdx && editingMemo.mIdx === mIdx ? (
                          <>
                            <input
                              value={editingMemo.text}
                              onChange={e => setEditingMemo((prev) => ({ ...prev, text: e.target.value }))}
                              style={{ fontSize: '0.98rem', padding: '0.2rem 0.5rem', borderRadius: 6, border: '1.5px solid #e7eaf7', outline: 'none', flex: 1 }}
                              autoFocus
                            />
                            <button
                              style={{ fontSize: '0.95rem', color: '#4F6DDE', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                              onClick={handleEditMemoSave}
                            >저장</button>
                            <button
                              style={{ fontSize: '0.95rem', color: '#bfc8e6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}
                              onClick={() => setEditingMemo({})}
                            >취소</button>
                          </>
                        ) : (
                          <>
                            <span style={{ fontSize: '0.98rem', color: '#22336b', fontWeight: 600 }}>{m.text}</span>
                            <span style={{ fontSize: '0.93rem', color: '#bfc8e6' }}>{new Date(m.createdAt).toLocaleTimeString()}</span>
                            <button
                              style={{ fontSize: '1.1rem', color: '#4F6DDE', background: 'none', border: 'none', cursor: 'pointer', marginLeft: 'auto' }}
                              onClick={() => handleEditMemo(bIdx, mIdx, m.text)}
                            >✏️</button>
                            <button
                              style={{ fontSize: '1.1rem', color: '#f87171', background: 'none', border: 'none', cursor: 'pointer' }}
                              onClick={() => handleDeleteMemo(bIdx, mIdx)}
                            >🗑</button>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              {/* 새 메모 입력 */}
              <div style={{ display: 'flex', gap: '0.7rem', marginTop: '0.2rem' }}>
                <input
                  type="text"
                  style={{ fontSize: '0.98rem', padding: '0.2rem 0.7rem', borderRadius: 6, border: '1.5px solid #e7eaf7', outline: 'none', flex: 1, background: '#f8f9fc', transition: 'border 0.18s' }}
                  value={newMemo[bIdx] || ''}
                  onChange={e => setNewMemo(prev => ({ ...prev, [bIdx]: e.target.value }))}
                  placeholder="메모 추가"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAddMemo(bIdx); } }}
                />
                <button
                  style={{ fontSize: '0.98rem', background: '#6C8EFF', color: '#fff', border: 'none', borderRadius: 6, padding: '0.2rem 1.1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 8px rgba(79,109,222,0.07)', transition: 'background 0.18s' }}
                  onClick={() => handleAddMemo(bIdx)}
                  onMouseOver={e => e.currentTarget.style.background = '#5A7BFF'}
                  onMouseOut={e => e.currentTarget.style.background = '#6C8EFF'}
                >추가</button>
              </div>
              {/* 오른쪽: 바로가기/색상/삭제 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', marginTop: '0.5rem' }}>
                <button
                  style={{ background: '#6C8EFF', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.98rem', padding: '0.3rem 1.1rem', cursor: 'pointer', boxShadow: '0 2px 8px rgba(79,109,222,0.07)', transition: 'background 0.18s' }}
                  onClick={() => navigate(`/viewer/${filename}`, { state: { cfi: bm.cfi } })}
                  onMouseOver={e => e.currentTarget.style.background = '#5A7BFF'}
                  onMouseOut={e => e.currentTarget.style.background = '#6C8EFF'}
                >
                  바로가기
                </button>
                {/* 색상 구분 */}
                <div style={{ display: 'flex', gap: '0.3rem' }}>
                  <button
                    title="일반"
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #e7eaf7', background: bookmarkColors.normal, boxShadow: bm.color === 'normal' ? '0 0 0 2px #4F6DDE' : 'none', outline: 'none', cursor: 'pointer', opacity: bm.color === 'normal' ? 1 : 0.6, transition: 'box-shadow 0.18s, opacity 0.18s' }}
                    onClick={() => handleChangeColor(bIdx, 'normal')}
                  />
                  <button
                    title="중요"
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #ffe066', background: bookmarkColors.important, boxShadow: bm.color === 'important' ? '0 0 0 2px #FFD600' : 'none', outline: 'none', cursor: 'pointer', opacity: bm.color === 'important' ? 1 : 0.6, transition: 'box-shadow 0.18s, opacity 0.18s' }}
                    onClick={() => handleChangeColor(bIdx, 'important')}
                  />
                  <button
                    title="강조"
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '2px solid #4F6DDE', background: bookmarkColors.highlight, boxShadow: bm.color === 'highlight' ? '0 0 0 2px #4F6DDE' : 'none', outline: 'none', cursor: 'pointer', opacity: bm.color === 'highlight' ? 1 : 0.6, transition: 'box-shadow 0.18s, opacity 0.18s' }}
                    onClick={() => handleChangeColor(bIdx, 'highlight')}
                  />
                </div>
                <button
                  style={{ background: '#f87171', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: '0.98rem', padding: '0.3rem 1.1rem', cursor: 'pointer', boxShadow: '0 2px 8px rgba(79,109,222,0.07)', transition: 'background 0.18s' }}
                  onClick={() => { if(window.confirm('정말 삭제하시겠습니까?')) handleDeleteBookmark(bm.cfi); }}
                  onMouseOver={e => e.currentTarget.style.background = '#e53935'}
                  onMouseOut={e => e.currentTarget.style.background = '#f87171'}
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
  );
};

export default BookmarksPage;
