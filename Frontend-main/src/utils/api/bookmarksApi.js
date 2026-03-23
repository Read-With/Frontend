import { authenticatedRequest } from './authApi';

const normalizeBookId = (bookId) => {
  if (bookId == null || bookId === '') return null;
  const normalized = Number(bookId);
  return Number.isFinite(normalized) ? normalized : null;
};

export const getBookmarks = async (bookId, sort = 'time_desc') => {
  const normalizedBookId = normalizeBookId(bookId);
  if (normalizedBookId == null) {
    throw new Error('유효한 bookId는 필수입니다.');
  }
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('bookId', String(normalizedBookId));
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
  const normalizedBookId = normalizeBookId(bookmarkData.bookId);
  if (normalizedBookId == null) {
    throw new Error('유효한 bookId는 필수입니다.');
  }
  if (!bookmarkData.startLocator || typeof bookmarkData.startLocator !== 'object') {
    throw new Error('startLocator는 필수입니다.');
  }
  try {
    const dataToSend = {
      bookId: normalizedBookId,
      startLocator: bookmarkData.startLocator,
      color: bookmarkData.color ?? '#203A7B',
      memo: bookmarkData.memo ?? '',
      ...(bookmarkData.endLocator ? { endLocator: bookmarkData.endLocator } : {}),
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
