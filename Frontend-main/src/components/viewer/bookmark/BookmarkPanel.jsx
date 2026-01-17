import React, { useState, useMemo } from 'react';
import { useBookmarks } from '../../../hooks/bookmarks/useBookmarks';

const parseBookmarkLocation = (bookmark) => {
  if (!bookmark) return '';
  
  // 저장된 title이 있으면 우선 사용 (로컬 CFI 기반으로 저장된 형식)
  if (bookmark.title) return bookmark.title;
  
  // title이 없으면 CFI에서 파싱 (로컬 CFI 기반)
  const cfi = bookmark.startCfi || '';
  const chapterMatch = cfi.match(/\[chapter-(\d+)\]/);
  const chapter = chapterMatch ? parseInt(chapterMatch[1]) : null;
  const pageMatch = cfi.match(/\[chapter-\d+\]\/(\d+)/);
  const page = pageMatch ? parseInt(pageMatch[1]) : null;
  
  // "몇페이지 (챕터 몇)" 형식으로 반환
  if (page && chapter) return `${page}페이지 (${chapter}챕터)`;
  if (page) return `${page}페이지`;
  if (chapter) return `${chapter}챕터`;
  return cfi;
};

const BookmarkPanel = ({ bookId, onSelect, onDelete }) => {
  const [sortOrder, setSortOrder] = useState('recent');
  const { bookmarks, loading, removeBookmark } = useBookmarks(bookId);

  const sortedBookmarks = useMemo(() => {
    if (!bookmarks || bookmarks.length === 0) return [];
    const sorted = [...bookmarks];
    if (sortOrder === 'position') return sorted.sort((a, b) => (a.startCfi || '').localeCompare(b.startCfi || ''));
    const factor = sortOrder === 'oldest' ? 1 : -1;
    return sorted.sort((a, b) => {
      const dateA = new Date(a.createdAt || a.created_at || 0).getTime();
      const dateB = new Date(b.createdAt || b.created_at || 0).getTime();
      return (dateA - dateB) * factor;
    });
  }, [bookmarks, sortOrder]);

  const handleDelete = async (bookmarkId) => {
    const result = await removeBookmark(bookmarkId);
    if (result.success && onDelete) onDelete(bookmarkId);
    return result;
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}시간 전`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 7) return `${diffDays}일 전`;
    return date.toLocaleDateString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="absolute right-0 top-16 bg-white shadow-xl border border-gray-200 rounded-xl z-50 w-80 max-h-96 overflow-hidden">
      <div className="p-4 border-b border-gray-100 bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="material-symbols-outlined text-blue-600">bookmark</span>
            <h3 className="font-bold text-gray-800 text-lg">북마크</h3>
            <span className="bg-blue-100 text-blue-600 text-xs px-2 py-1 rounded-full font-medium">
              {bookmarks.length}
            </span>
          </div>
          
          {/* 정렬 옵션 */}
          <div className="flex items-center space-x-1">
            <span className="text-xs text-gray-500 mr-2">정렬:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="text-xs border border-gray-200 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="recent">최신순</option>
              <option value="oldest">오래된순</option>
              <option value="position">위치순</option>
            </select>
          </div>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto">
        {loading ? (
          <div className="p-6 text-left text-gray-500">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mb-3"></div>
            <p className="text-sm">북마크를 불러오는 중...</p>
          </div>
        ) : bookmarks.length === 0 ? (
          <div className="p-6 text-left text-gray-500">
            <span className="material-symbols-outlined mb-3 text-3xl text-gray-300">bookmark</span>
            <p className="text-sm">저장된 북마크가 없습니다</p>
            <p className="text-xs text-gray-400 mt-1">중요한 부분을 북마크해보세요</p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {sortedBookmarks.map((bookmark) => (
              <li
                key={bookmark.id}
                className="group relative"
              >
                <button
                  onClick={() => onSelect(bookmark.startCfi)}
                  className="w-full text-left p-3 rounded-lg transition-all duration-200 hover:bg-green-50 focus:bg-green-50 focus:outline-none focus:ring-2 focus:ring-green-200"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="material-symbols-outlined text-green-500 text-xs mt-0.5 flex-shrink-0">place</span>
                        <div className="flex flex-col truncate">
                          <p className="text-sm font-semibold text-gray-800 truncate">
                            {parseBookmarkLocation(bookmark)}
                          </p>
                          <span className="text-xs text-gray-500 truncate">
                            북마크 #{bookmark.id}
                          </span>
                        </div>
                      </div>

                      {(bookmark.highlightText || bookmark.textSnippet) && (
                        <p className="text-xs text-gray-600 line-clamp-2 ml-4 mb-2 italic">
                          “{bookmark.highlightText || bookmark.textSnippet}”
                        </p>
                      )}

                      {bookmark.memo && (
                        <p className="text-xs text-gray-700 line-clamp-2 ml-4 mb-2">
                          {bookmark.memo}
                        </p>
                      )}

                      {!!(bookmark.tags && bookmark.tags.length) && (
                        <div className="flex flex-wrap gap-1 ml-4 mb-2">
                          {bookmark.tags.map((tag) => (
                            <span
                              key={tag}
                              className="text-[11px] px-2 py-0.5 rounded-full bg-green-100 text-green-600 font-medium"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center space-x-2 ml-4">
                        <span className="material-symbols-outlined text-gray-400 text-xs">schedule</span>
                        <span className="text-xs text-gray-500">
                          {formatDate(bookmark.createdAt)}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(bookmark.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 ml-2 p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all duration-200 flex-shrink-0"
                      title="북마크 삭제"
                    >
                      <span className="material-symbols-outlined text-xs">delete</span>
                    </button>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default BookmarkPanel;