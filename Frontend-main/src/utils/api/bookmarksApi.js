import { authenticatedRequest } from './authApi';
import { toLocator, locatorsEqual } from '../common/locatorUtils';

const normalizeBookId = (bookId) => {
  if (bookId == null || bookId === '') return null;
  const normalized = Number(bookId);
  return Number.isFinite(normalized) ? normalized : null;
};

const BOOKMARK_SORT = new Set(['time_desc', 'time_asc']);

export const getBookmarks = async (bookId, sort = 'time_desc') => {
  const normalizedBookId = normalizeBookId(bookId);
  if (normalizedBookId == null) {
    throw new Error('유효한 bookId는 필수입니다.');
  }
  try {
    const queryParams = new URLSearchParams();
    queryParams.append('bookId', String(normalizedBookId));
    const sortParam = BOOKMARK_SORT.has(sort) ? sort : 'time_desc';
    queryParams.append('sort', sortParam);
    const data = await authenticatedRequest(`/v2/bookmarks?${queryParams.toString()}`);
    return data;
  } catch (error) {
    console.error('북마크 목록 조회 실패:', error);
    throw error;
  }
};

const buildPatchBody = (updateData) => {
  const body = {};
  if (updateData?.color !== undefined) body.color = updateData.color;
  if (updateData?.memo !== undefined) body.memo = updateData.memo;
  return body;
};

export const createBookmark = async (bookmarkData) => {
  if (!bookmarkData || typeof bookmarkData !== 'object') {
    throw new Error('bookmarkData는 필수입니다.');
  }
  const normalizedBookId = normalizeBookId(bookmarkData.bookId);
  if (normalizedBookId == null) {
    throw new Error('유효한 bookId는 필수입니다.');
  }
  const startLocator = toLocator(bookmarkData.startLocator);
  if (!startLocator) {
    throw new Error('startLocator는 필수입니다.');
  }
  try {
    const endLocator = toLocator(bookmarkData.endLocator);
    const dataToSend = {
      bookId: normalizedBookId,
      startLocator,
      color: bookmarkData.color ?? '#28B532',
      memo: bookmarkData.memo ?? '',
    };
    if (endLocator && !locatorsEqual(startLocator, endLocator)) {
      dataToSend.endLocator = endLocator;
    }
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
  const body = buildPatchBody(updateData);
  if (Object.keys(body).length === 0) {
    throw new Error('수정할 color 또는 memo가 필요합니다.');
  }
  try {
    const data = await authenticatedRequest(`/v2/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
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
