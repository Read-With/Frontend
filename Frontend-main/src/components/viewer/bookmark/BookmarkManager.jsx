import { getBookmarks } from '../../../utils/api/bookmarksApi';

export const loadBookmarks = async (bookId, sort = 'time_desc') => {
  try {
    const response = await getBookmarks(bookId, sort);
    if (response.isSuccess) {
      const list = response.result;
      return Array.isArray(list) ? list : [];
    }
    return [];
  } catch (_error) {
    return [];
  }
};

// 로컬 스토리지 백업 함수들 (오프라인 지원용)
export const saveBookmarksToLocal = (bookId, bookmarks) => {
  try {
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(bookmarks));
    return true;
  } catch (_error) {
    return false;
  }
};

export const loadBookmarksFromLocal = (bookId) => {
  try {
    const stored = localStorage.getItem(`bookmarks_${bookId}`);
    return stored ? JSON.parse(stored) : [];
  } catch (_error) {
    return [];
  }
};

export const removeBookmarkHighlights = () => {
  const highlights = document.querySelectorAll('.bookmark-highlight');
  highlights.forEach(highlight => {
    highlight.classList.remove('bookmark-highlight');
    highlight.style.backgroundColor = '';
    highlight.style.opacity = '';
    highlight.style.borderRadius = '';
    highlight.style.padding = '';
    highlight.style.margin = '';
  });
};
