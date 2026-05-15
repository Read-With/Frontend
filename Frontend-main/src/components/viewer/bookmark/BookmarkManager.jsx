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
