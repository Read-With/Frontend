export const getBookmarkKey = (filename) => `bookmarks_${filename}`;

export const saveBookmarks = (filename, bookmarks) => {
  const key = getBookmarkKey(filename);
  localStorage.setItem(key, JSON.stringify(bookmarks));
};

export const loadBookmarks = (filename) => {
  const key = getBookmarkKey(filename);
  const stored = localStorage.getItem(key);
  return stored ? JSON.parse(stored) : [];
};
