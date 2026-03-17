import React, { useState } from 'react';
import BookmarkCreator from './BookmarkCreator';
import { useBookmarks } from '../../../hooks/bookmarks/useBookmarks';
import { isSameBookmarkPosition } from '../../../utils/bookmarkUtils';

/**
 * 북마크 툴바 컴포넌트
 * @param {Object} props
 * @param {number} props.bookId - 책 ID
 * @param {Object} props.startLocator - 시작 locator (v2)
 * @param {Object} props.endLocator - 종료 locator (선택)
 * @param {string} props.startCfi - 시작 CFI (폴백)
 * @param {string} props.endCfi - 종료 CFI (폴백)
 * @param {Function} props.onBookmarkCreated - 북마크 생성 콜백
 */
const BookmarkToolbar = ({ bookId, startLocator, endLocator, startCfi, endCfi, onBookmarkCreated }) => {
  const [showCreator, setShowCreator] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [editingBookmark, setEditingBookmark] = useState(null);
  const { bookmarks, loading } = useBookmarks(bookId);

  const currentBookmark = bookmarks.find((b) =>
    isSameBookmarkPosition(b, { startLocator, endLocator, startCfi, endCfi })
  );

  const handleCreateBookmark = () => {
    setShowCreator(true);
  };

  const handleEditBookmark = () => {
    if (currentBookmark) {
      setEditingBookmark(currentBookmark);
      setShowEditor(true);
    }
  };

  const handleBookmarkCreated = (bookmark) => {
    setShowCreator(false);
    if (onBookmarkCreated) {
      onBookmarkCreated(bookmark);
    }
  };

  const handleBookmarkEdited = () => {
    setShowEditor(false);
    setEditingBookmark(null);
  };

  const handleCloseCreator = () => {
    setShowCreator(false);
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setEditingBookmark(null);
  };

  if (!bookId || (!startLocator && !startCfi)) return null;

  return (
    <>
      <div className="flex items-center space-x-2 bg-white rounded-lg shadow-lg border border-gray-200 p-2">
        {currentBookmark ? (
          <>
            <button
              onClick={handleEditBookmark}
              className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-white rounded-md transition-colors"
              style={{ backgroundColor: currentBookmark.color }}
              title="북마크 편집"
            >
              <span className="material-symbols-outlined text-sm">edit</span>
              <span>편집</span>
            </button>
            <div className="text-xs text-gray-500">
              북마크됨
            </div>
          </>
        ) : (
          <button
            onClick={handleCreateBookmark}
            className="flex items-center space-x-1 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors"
            title="북마크 추가"
          >
            <span className="material-symbols-outlined text-sm">bookmark_add</span>
            <span>북마크</span>
          </button>
        )}
        
        {loading && (
          <div className="flex items-center space-x-1 text-xs text-gray-500">
            <div className="animate-spin rounded-full h-3 w-3 border-b border-gray-400"></div>
            <span>로딩 중...</span>
          </div>
        )}
      </div>

      {/* 북마크 생성 모달 */}
      {showCreator && (
        <BookmarkCreator
          bookId={bookId}
          startLocator={startLocator}
          endLocator={endLocator}
          startCfi={startCfi}
          endCfi={endCfi}
          onClose={handleCloseCreator}
          onSuccess={handleBookmarkCreated}
        />
      )}

      {/* 북마크 편집 모달 */}
      {showEditor && editingBookmark && (
        <BookmarkCreator
          bookId={bookId}
          bookmark={editingBookmark}
          onClose={handleCloseEditor}
          onSuccess={handleBookmarkEdited}
        />
      )}
    </>
  );
};

export default BookmarkToolbar;
