import { authenticatedRequest } from './authApi';

export const getBookmarks = async (bookId, sort = 'time_desc') => {
  if (bookId == null || bookId === '') {
    throw new Error('bookId는 필수입니다.');
  }
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('bookId', bookId);
    if (sort) queryParams.append('sort', sort);
    const data = await authenticatedRequest(`/v2/bookmarks?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('북마크 목록 조회 실패:', error);
    throw error;
  }
};

export const createBookmark = async (bookmarkData) => {
  if (!bookmarkData || typeof bookmarkData !== 'object') {
    throw new Error('bookmarkData는 필수입니다.');
  }
  try {
    const dataToSend = {
      ...bookmarkData,
      color: bookmarkData.color ?? '#28B532',
    };
    const data = await authenticatedRequest('/v2/bookmarks', {
      method: 'POST',
      body: JSON.stringify(dataToSend),
    });
    return data;
  } catch (error) {
    console.error('북마크 생성 실패:', error);
    throw error;
  }
};

export const updateBookmark = async (bookmarkId, updateData) => {
  if (bookmarkId == null || bookmarkId === '') {
    throw new Error('bookmarkId는 필수입니다.');
  }
  try {
    const data = await authenticatedRequest(`/v2/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify(updateData ?? {}),
    });
    return data;
  } catch (error) {
    console.error('북마크 수정 실패:', error);
    throw error;
  }
};

export const deleteBookmark = async (bookmarkId) => {
  if (bookmarkId == null || bookmarkId === '') {
    throw new Error('bookmarkId는 필수입니다.');
  }
  try {
    const data = await authenticatedRequest(`/v2/bookmarks/${bookmarkId}`, {
      method: 'DELETE',
    });
    return data;
  } catch (error) {
    console.error('북마크 삭제 실패:', error);
    throw error;
  }
};
