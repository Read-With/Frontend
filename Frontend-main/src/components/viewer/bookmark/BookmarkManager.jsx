import { getBookmarks, createBookmark, updateBookmark, deleteBookmark } from '../../../utils/api';

// 북마크 데이터 구조 개선
const createBookmarkData = (bookId, startCfi, endCfi = null, color = '#0Ccd5B', memo = '') => ({
  bookId,
  startCfi,
  endCfi,
  color,
  memo,
  createdAt: new Date().toISOString()
});

// 북마크 목록 조회 (서버에서)
export const loadBookmarks = async (bookId) => {
  try {
    const response = await getBookmarks(bookId);
    if (response.isSuccess) {
      return response.result || [];
    }
    return [];
  } catch (error) {
    return [];
  }
};

// 북마크 추가 (서버에 저장)
export const addBookmark = async (bookId, startCfi, endCfi = null, color = '#0Ccd5B', memo = '') => {
  try {
    const bookmarkData = createBookmarkData(bookId, startCfi, endCfi, color, memo);
    const response = await createBookmark(bookmarkData);
    
    if (response.isSuccess) {
      return { success: true, bookmark: response.result };
    } else {
      return { success: false, message: response.message || '북마크 생성에 실패했습니다.' };
    }
  } catch (error) {
    return { success: false, message: '북마크 추가에 실패했습니다.' };
  }
};

// 북마크 수정
export const modifyBookmark = async (bookmarkId, color, memo) => {
  try {
    const response = await updateBookmark(bookmarkId, { color, memo });
    
    if (response.isSuccess) {
      return { success: true, bookmark: response.result };
    } else {
      return { success: false, message: response.message || '북마크 수정에 실패했습니다.' };
    }
  } catch (error) {
    return { success: false, message: '북마크 수정에 실패했습니다.' };
  }
};

// 북마크 삭제
export const removeBookmark = async (bookmarkId) => {
  try {
    const response = await deleteBookmark(bookmarkId);
    
    if (response.isSuccess) {
      return { success: true };
    } else {
      return { success: false, message: response.message || '북마크 삭제에 실패했습니다.' };
    }
  } catch (error) {
    return { success: false, message: '북마크 삭제에 실패했습니다.' };
  }
};

// 로컬 스토리지 백업 함수들 (오프라인 지원용)
export const saveBookmarksToLocal = (bookId, bookmarks) => {
  try {
    localStorage.setItem(`bookmarks_${bookId}`, JSON.stringify(bookmarks));
    return true;
  } catch (error) {
    return false;
  }
};

export const loadBookmarksFromLocal = (bookId) => {
  try {
    const stored = localStorage.getItem(`bookmarks_${bookId}`);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    return [];
  }
};

// 북마크 정렬 함수 (최근 북마크 우선)
export const sortBookmarksByDate = (bookmarks) => {
  return [...bookmarks].sort((a, b) => {
    const dateA = new Date(a.createdAt || a.created_at || 0);
    const dateB = new Date(b.createdAt || b.created_at || 0);
    return dateB - dateA; // 최신순
  });
};

// 북마크 하이라이트 스타일 생성
export const createBookmarkHighlightStyle = (color = '#0Ccd5B') => ({
  backgroundColor: color,
  opacity: 0.3,
  borderRadius: '2px',
  padding: '1px 2px',
  margin: '0 1px',
  transition: 'all 0.2s ease'
});

// 북마크 하이라이트 제거
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

// 북마크 하이라이트 적용
export const applyBookmarkHighlights = (bookmarks) => {
  // 기존 하이라이트 제거
  removeBookmarkHighlights();
  
  bookmarks.forEach(bookmark => {
    try {
      // CFI를 DOM Range로 변환
      const range = document.createRange();
      const cfi = bookmark.startCfi;
      
      // CFI 파싱 및 DOM 요소 찾기
      const cfiMatch = cfi.match(/epubcfi\(([^)]+)\)/);
      if (!cfiMatch) return;
      
      const cfiPath = cfiMatch[1];
      const pathParts = cfiPath.split('/').filter(part => part);
      
      // DOM 요소 찾기 시도
      let element = document.body;
      for (const part of pathParts) {
        if (part.startsWith('[') && part.endsWith(']')) {
          // ID나 클래스로 찾기
          const selector = part.slice(1, -1);
          const found = element.querySelector(`#${selector}`) || element.querySelector(`.${selector}`);
          if (found) element = found;
        } else if (!isNaN(part)) {
          // 인덱스로 찾기
          const children = Array.from(element.children);
          if (children[parseInt(part) - 1]) {
            element = children[parseInt(part) - 1];
          }
        }
      }
      
      // 하이라이트 적용
      if (element && element.textContent) {
        element.classList.add('bookmark-highlight');
        element.style.backgroundColor = bookmark.color || '#0Ccd5B';
        element.style.opacity = '0.3';
        element.style.borderRadius = '2px';
        element.style.padding = '1px 2px';
        element.style.margin = '0 1px';
        element.style.transition = 'all 0.2s ease';
      }
    } catch (error) {
      console.warn('북마크 하이라이트 적용 실패:', error);
    }
  });
};
  