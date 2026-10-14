/** 책 전체 누적 그래프 → API 응답 shape (매크로 그래프). 변환은 graphElements, 챕터 캐시는 graphChapterCache */

import { resolveManifestEventId } from './graphCore';
import {
  asArray,
  toNumberOrNull,
  toTrimmedStringOrNull,
  errorUtils,
} from '../common/valueUtils';
import { buildGraphEventMeta, FETCH_STATUS, hasGraphPayload } from '../api/graphApi';
import { requireBookId, toUnifiedApiResponse } from '../api/authApi';
import { getLastManifestEventInChapter } from '../common/cache/manifestCache';
import { accumulateDeltasToGraphResult, resolveChapterEventIdOrder, ensureBookRelationshipDeltas } from './graphDeltas';

const handleApiError = (error, context) => {
  const statusMessages = {
    400: '잘못된 요청입니다',
    401: '인증이 필요합니다',
    403: '접근 권한이 없습니다',
    404: '요청한 리소스를 찾을 수 없습니다',
    500: '서버 내부 오류가 발생했습니다',
    502: '게이트웨이 오류가 발생했습니다',
    503: '서비스를 일시적으로 사용할 수 없습니다',
  };
  const statusCode = error.status || 'unknown';
  const statusMessage = statusMessages[statusCode] || 'API 요청 중 오류가 발생했습니다';
  errorUtils.logError('graphApi', error, { context, status: statusCode });
  throw new Error(
    `${context}: ${statusMessage} (${statusCode}) - ${error.message || '알 수 없는 오류'}`
  );
};

const emptyAccumulatedGraphResult = (overrides = {}) => ({
  bookId: null,
  chapterIndex: null,
  eventId: null,
  characters: [],
  relations: [],
  event: null,
  ...overrides,
});

const normalizeAccumulatedGraphResult = (payload) => {
  if (!payload || typeof payload !== 'object') return emptyAccumulatedGraphResult();
  const eventId = toTrimmedStringOrNull(payload.eventId);
  const chapterIndex = payload.chapterIndex ?? null;
  return {
    ...payload,
    bookId: payload.bookId ?? null,
    chapterIndex,
    eventId,
    characters: asArray(payload.characters),
    relations: asArray(payload.relations),
    event:
      payload.event && typeof payload.event === 'object'
        ? payload.event
        : buildGraphEventMeta(eventId, chapterIndex),
  };
};

const createRelationshipDeltasResponse = (isSuccess, code, message, result, status = null) => {
  const normalized = normalizeAccumulatedGraphResult(result);
  const hasPayload =
    normalized.characters.length > 0 || normalized.relations.length > 0 || Boolean(normalized.eventId);
  let resolvedStatus = status;
  if (!resolvedStatus) {
    if (!isSuccess) resolvedStatus = FETCH_STATUS.ERROR;
    else if (!hasPayload) resolvedStatus = FETCH_STATUS.EMPTY;
    else resolvedStatus = FETCH_STATUS.OK;
  }
  return {
    isSuccess,
    code,
    message,
    status: resolvedStatus,
    result: normalized,
  };
};

const toGraphApiResponse = ({ response, result, empty }) => {
  const resolved = result || empty;
  const hasPayload = hasGraphPayload(resolved);
  // soft-empty는 fetch 단계에서 success로 정규화됨. 여기선 누적 payload로 부분 실패 보정.
  const failed = (!response || response.isSuccess === false) && !hasPayload;
  const code = failed ? response?.code || 'ERROR' : hasPayload ? 'SUCCESS' : 'NOT_FOUND';
  const message = failed
    ? response?.message || '관계 델타 조회에 실패했습니다.'
    : hasPayload
      ? '관계 델타를 성공적으로 조회했습니다.'
      : '관계 델타를 찾을 수 없습니다.';
  return toUnifiedApiResponse(
    createRelationshipDeltasResponse(
      !failed,
      code,
      message,
      failed ? empty : resolved,
      failed ? FETCH_STATUS.ERROR : null
    )
  );
};

const relationshipDeltasInvalidParams = (empty, message = 'chapterIndex가 필요합니다.') =>
  toUnifiedApiResponse(
    createRelationshipDeltasResponse(false, 'INVALID_PARAMS', message, empty)
  );

/** 매크로 그래프: 해당 챕터까지(챕터 단위) 책 전체 누적 */
export const getBookScopeRelationshipGraph = async (bookId, uptoChapter = null) => {
  requireBookId(bookId);

  const chapterIndex = toNumberOrNull(uptoChapter);
  const bookIdNum = Number(bookId) || null;
  if (chapterIndex == null) {
    return relationshipDeltasInvalidParams(
      emptyAccumulatedGraphResult({ bookId: bookIdNum })
    );
  }

  const resolvedTo = resolveManifestEventId(getLastManifestEventInChapter(bookId, chapterIndex));
  const empty = emptyAccumulatedGraphResult({
    bookId: bookIdNum,
    chapterIndex,
    eventId: resolvedTo,
  });

  try {
    const fetched = await ensureBookRelationshipDeltas(bookId, {
      chapterIndex,
    });
    return toGraphApiResponse({
      response: fetched.response,
      result: accumulateDeltasToGraphResult(fetched.bookId, fetched.deltas, {
        chapterIndex,
        throughEventId: resolvedTo,
        chapterEventIdOrder: resolveChapterEventIdOrder(bookId, chapterIndex),
      }),
      empty,
    });
  } catch (error) {
    handleApiError(error, '관계 델타 조회 실패');
  }
};
