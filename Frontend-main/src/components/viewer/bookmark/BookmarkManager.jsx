import { getBookmarks, createBookmark, updateBookmark, deleteBookmark } from '../../../utils/api/bookmarksApi';

// 북마크 데이터 구조 개선 (로컬 CFI 기반)
const createBookmarkData = (bookId, startCfi, endCfi = null, color = '#28B532', memo = '', title = null) => ({
  bookId,
  startCfi,
  endCfi,
  color,
  memo,
  title, // 로컬 CFI 기반으로 생성된 "몇페이지 (챕터 몇)" 형식
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

// 북마크 추가 (서버에 저장, 로컬 CFI 기반)
export const addBookmark = async (bookId, startCfi, endCfi = null, color = '#28B532', memo = '', title = null) => {
  try {
    const bookmarkData = createBookmarkData(bookId, startCfi, endCfi, color, memo, title);
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
export const createBookmarkHighlightStyle = (color = '#28B532') => ({
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
  
  // CFI 파싱 로직이 정확하지 않아 body가 녹색으로 칠해지는 문제 발생
  // 임시로 비활성화 - 향후 EpubCFI 라이브러리를 사용하여 정확한 DOM Range 찾기 구현 필요
  return;
};
  