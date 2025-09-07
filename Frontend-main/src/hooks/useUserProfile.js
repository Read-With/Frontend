import { useState, useEffect } from 'react';

export const useUserProfile = () => {
  const [userProfile, setUserProfile] = useState({
    nickname: "User's Nickname",
    readingProgress: {},
    bookmarks: [],
    totalBooksRead: 0,
    totalBookmarks: 0
  });

  // 추후 API 연동 시 사용
  const updateProfile = (newData) => {
    setUserProfile(prev => ({ ...prev, ...newData }));
  };

  // 읽기 진행률 업데이트
  const updateReadingProgress = (bookId, progress) => {
    setUserProfile(prev => ({
      ...prev,
      readingProgress: {
        ...prev.readingProgress,
        [bookId]: progress
      }
    }));
  };

  // 북마크 추가/제거
  const toggleBookmark = (bookId, bookmark) => {
    setUserProfile(prev => {
      const existingIndex = prev.bookmarks.findIndex(b => 
        b.bookId === bookId && b.id === bookmark.id
      );
      
      let newBookmarks;
      if (existingIndex >= 0) {
        newBookmarks = prev.bookmarks.filter((_, index) => index !== existingIndex);
      } else {
        newBookmarks = [...prev.bookmarks, { ...bookmark, bookId }];
      }
      
      return {
        ...prev,
        bookmarks: newBookmarks,
        totalBookmarks: newBookmarks.length
      };
    });
  };

  return {
    userProfile,
    updateProfile,
    updateReadingProgress,
    toggleBookmark
  };
};
