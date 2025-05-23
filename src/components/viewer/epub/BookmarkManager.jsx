export const saveBookmarks = (bookId, bookmarks) => {
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(bookmarks));
  };
  
  export const loadBookmarks = (bookId) => {
    const stored = localStorage.getItem(`bookmarks_${bookId}`);
    return stored ? JSON.parse(stored) : [];
  };
  