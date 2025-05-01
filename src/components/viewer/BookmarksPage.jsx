import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { loadBookmarks, saveBookmarks } from './epub/BookmarkManager';

const bookmarkColors = {
  normal: 'bg-[#f6f6fa] dark:bg-gray-700',
  important: 'bg-yellow-100 dark:bg-yellow-700',
  highlight: 'bg-blue-50 dark:bg-blue-800',
};

const BookmarksPage = () => {
  const { filename } = useParams(); // 예: gatsby.epub
  const navigate = useNavigate();

  const [bookmarks, setBookmarks] = useState(() => loadBookmarks(filename));
  const [newMemo, setNewMemo] = useState({});
  const [editingMemo, setEditingMemo] = useState({});

  const updateAndSave = (updatedList) => {
    console.log('✅ 북마크 저장됨:', updatedList);
    setBookmarks(updatedList);
    saveBookmarks(filename, updatedList);
  };

  const handleDeleteBookmark = (cfi) => {
    const filtered = bookmarks.filter((b) => b.cfi !== cfi);
    updateAndSave(filtered);
  };

  const handleAddMemo = (bIdx) => {
    const text = (newMemo[bIdx] || '').trim();
    if (!text) return;
    const updated = bookmarks.map((b, i) =>
      i === bIdx
        ? { ...b, memos: [...(b.memos || []), { text, createdAt: new Date().toISOString() }] }
        : b
    );
    updateAndSave(updated);
    setNewMemo((prev) => ({ ...prev, [bIdx]: '' }));
  };

  const handleDeleteMemo = (bIdx, mIdx) => {
    const updated = bookmarks.map((b, i) =>
      i === bIdx
        ? { ...b, memos: b.memos.filter((_, j) => j !== mIdx) }
        : b
    );
    updateAndSave(updated);
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
            memos: b.memos.map((m, j) => (j === mIdx ? { ...m, text } : m)),
          }
        : b
    );
    updateAndSave(updated);
    setEditingMemo({});
  };

  const handleChangeColor = (idx, color) => {
    const updated = bookmarks.map((b, i) =>
      i === idx ? { ...b, color } : b
    );
    updateAndSave(updated);
  };

  useEffect(() => {
    const key = `bookmarks_${filename}`;
    const handleStorageChange = (e) => {
      if (e.key === key) {
        const updated = loadBookmarks(filename);
        setBookmarks(updated);
        console.log('📥 북마크 storage 변경 감지됨:', updated);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [filename]);

  return (
    <div className="flex flex-col items-center min-h-screen bg-gradient-to-br from-[#f7f7f8] via-[#f1f1f5] to-[#e9ecef] dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-lg mt-14 bg-white/80 dark:bg-gray-800/90 rounded-2xl shadow-2xl p-8 backdrop-blur-sm ring-1 ring-gray-200 dark:ring-gray-700">
        <div className="flex justify-between items-center border-b pb-4 mb-6">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">📑 내 북마크 목록</h2>
          <button
            className="text-gray-400 hover:text-blue-500 text-xl font-bold transition"
            onClick={() => navigate(-1)}
            aria-label="닫기"
          >
            ×
          </button>
        </div>
        <ul className="space-y-5">
          {bookmarks.length === 0 && (
            <li className="text-gray-400 text-center py-12">저장된 북마크가 없습니다.</li>
          )}
          {bookmarks.map((bm, bIdx) => (
            <li
              key={bIdx}
              className={`flex flex-col md:flex-row md:items-center md:justify-between gap-2 p-4 rounded-xl shadow hover:shadow-lg transition-all border border-gray-100 dark:border-gray-700 ${bookmarkColors[bm.color || 'normal']}`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-300">
                    {new Date(bm.createdAt).toLocaleString()}
                  </span>
                  <span className="text-xs text-blue-500 dark:text-blue-300 font-mono">
                    위치: {bm.cfi}
                  </span>
                </div>
                <div className="mt-2">
                  {bm.memos?.length > 0 && (
                    <ul className="space-y-5">
                      {bm.memos.map((m, mIdx) => (
                        <li key={mIdx} className="flex items-center gap-2 group">
                          {editingMemo.bIdx === bIdx && editingMemo.mIdx === mIdx ? (
                            <>
                              <input
                                value={editingMemo.text}
                                onChange={(e) =>
                                  setEditingMemo((prev) => ({ ...prev, text: e.target.value }))
                                }
                                className="text-[13px] px-1 py-0.5 rounded border focus:ring"
                                autoFocus
                              />
                              <button className="text-xs text-blue-500" onClick={handleEditMemoSave}>
                                저장
                              </button>
                              <button
                                className="text-xs text-gray-400 hover:text-red-400"
                                onClick={() => setEditingMemo({})}
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <>
                              <span className="text-[13px] text-gray-900 dark:text-gray-100">
                                {m.text}
                              </span>
                              <span className="text-[11px] text-gray-400">
                                {new Date(m.createdAt).toLocaleTimeString()}
                              </span>
                              <button
                                className="text-xs text-blue-400 hover:text-blue-600"
                                onClick={() => handleEditMemo(bIdx, mIdx, m.text)}
                              >
                                ✏️
                              </button>
                              <button
                                className="text-xs text-gray-400 hover:text-red-500"
                                onClick={() => handleDeleteMemo(bIdx, mIdx)}
                              >
                                🗑
                              </button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    className="px-2 py-1 border rounded focus:ring w-40 text-sm"
                    value={newMemo[bIdx] || ''}
                    onChange={(e) =>
                      setNewMemo((prev) => ({ ...prev, [bIdx]: e.target.value }))
                    }
                    placeholder="메모 추가"
                  />
                  <button
                    className="text-xs px-2 py-1 rounded bg-blue-500 text-white hover:bg-blue-700"
                    onClick={() => handleAddMemo(bIdx)}
                  >
                    추가
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-1 md:gap-3 mt-2 md:mt-0">
                <button
                  className="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg shadow-sm transition"
                  onClick={() => navigate(`/viewer/${filename}`, { state: { cfi: bm.cfi } })}
                >
                  바로가기
                </button>
                <div className="flex gap-1">
                  <button
                    title="일반"
                    className={`w-5 h-5 rounded-full border ${
                      bm.color === 'normal' ? 'ring-2 ring-blue-400' : 'opacity-60'
                    } bg-[#f6f6fa]`}
                    onClick={() => handleChangeColor(bIdx, 'normal')}
                  />
                  <button
                    title="중요"
                    className={`w-5 h-5 rounded-full border ${
                      bm.color === 'important' ? 'ring-2 ring-yellow-500' : 'opacity-60'
                    } bg-yellow-200`}
                    onClick={() => handleChangeColor(bIdx, 'important')}
                  />
                  <button
                    title="하이라이트"
                    className={`w-5 h-5 rounded-full border ${
                      bm.color === 'highlight' ? 'ring-2 ring-blue-500' : 'opacity-60'
                    } bg-blue-200`}
                    onClick={() => handleChangeColor(bIdx, 'highlight')}
                  />
                </div>
                <button
                  className="p-1 rounded-full bg-gray-100 hover:bg-red-500 hover:text-white dark:bg-gray-700 dark:hover:bg-red-600 transition"
                  onClick={() => handleDeleteBookmark(bm.cfi)}
                  aria-label="북마크 삭제"
                >
                  🗑
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default BookmarksPage;
