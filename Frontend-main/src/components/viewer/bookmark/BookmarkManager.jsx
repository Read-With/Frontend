// 북마크 데이터 구조 개선
const createBookmark = (cfi, preview = '', chapterTitle = '') => ({
  cfi,
  preview: preview.substring(0, 100), // 미리보기 텍스트 100자 제한
  chapterTitle,
  createdAt: new Date().toISOString(),
  id: `bookmark_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
});

// 북마크 저장
export const saveBookmarks = (bookId, bookmarks) => {
  try {
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(bookmarks));
    return true;
  } catch (error) {

    return false;
  }
};

// 북마크 로드
export const loadBookmarks = (bookId) => {
  try {
    const stored = localStorage.getItem(`bookmarks_${bookId}`);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {

    return [];
  }
};

// 북마크 추가
export const addBookmark = (bookId, cfi, preview = '', chapterTitle = '') => {
  const bookmarks = loadBookmarks(bookId);
  
  // 중복 북마크 체크
  if (bookmarks.some(bookmark => bookmark.cfi === cfi)) {
    return { success: false, message: '이미 북마크된 위치입니다.' };
  }
  
  const newBookmark = createBookmark(cfi, preview, chapterTitle);
  const updatedBookmarks = [...bookmarks, newBookmark];
  
  if (saveBookmarks(bookId, updatedBookmarks)) {
    return { success: true, bookmark: newBookmark, bookmarks: updatedBookmarks };
  } else {
    return { success: false, message: '북마크 저장에 실패했습니다.' };
  }
};

// 북마크 삭제
export const removeBookmark = (bookId, index) => {
  try {
    const bookmarks = loadBookmarks(bookId);
    if (index >= 0 && index < bookmarks.length) {
      const updatedBookmarks = bookmarks.filter((_, i) => i !== index);
      saveBookmarks(bookId, updatedBookmarks);
      return { success: true, bookmarks: updatedBookmarks };
    }
    return { success: false, message: '유효하지 않은 북마크입니다.' };
  } catch (error) {

    return { success: false, message: '북마크 삭제에 실패했습니다.' };
  }
};

// 북마크 전체 삭제
export const clearAllBookmarks = (bookId) => {
  try {
    localStorage.removeItem(`bookmarks_${bookId}`);
    return { success: true, bookmarks: [] };
  } catch (error) {

    return { success: false, message: '북마크 삭제에 실패했습니다.' };
  }
};
  