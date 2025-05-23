import React from 'react';

const BookmarkPanel = ({ bookmarks, onSelect }) => (
  <div className="absolute right-0 top-16 bg-white dark:bg-gray-800 shadow-lg p-4 z-50 w-64 border border-gray-300 rounded-md">
    <h3 className="font-bold mb-2">📑 북마크</h3>
    <ul className="space-y-2">
      {bookmarks.map((b, i) => (
        <li
          key={i}
          onClick={() => {
            console.log("📌 북마크 클릭:", b.cfi);
            onSelect(b.cfi)}}
          className="epub-bookmark-btn"
        >
          {new Date(b.createdAt).toLocaleString()}
        </li>
      ))}
    </ul>
  </div>
);

export default BookmarkPanel;