/** relationship-deltas HTTP (누적·매크로 그래프 응답은 graphModel 8번 섹션) */

import { toNumberOrNull, toTrimmedStringOrNull, asArray } from '../common/valueUtils';
import {
  authenticatedRequest,
  SOFT_FAIL_403_404,
  requireBookId,
  pickResponseResult,
} from './authApi';

/** API/캐시 로드 결과 계약 — UI 뷰 상태(no-data 등)와 분리 */
export const FETCH_STATUS = Object.freeze({
  OK: 'ok',
  /** 요청 성공·payload 없음 (관계 없음 등). UI 'no-data'와 다름 */
  EMPTY: 'empty',
  ERROR: 'error',
});

/** characters 또는 relations가 하나라도 있으면 true */
export const hasGraphPayload = (data) => {
  if (!data || typeof data !== 'object') return false;
  return asArray(data.characters).length > 0 || asArray(data.relations).length > 0;
};

export const buildGraphEventMeta = (eventId, chapterIndex) => {
  const id = toTrimmedStringOrNull(eventId);
  if (!id) return null;
  return { eventId: id, chapterIndex, chapterIdx: chapterIndex };
};

// ─── relationship-deltas: HTTP ─────────────────────────────────────────────

/** Query: chapterIndex | eventId | fromEventId | toEventId (각각 optional) */
const requestRelationshipDeltas = async (
  bookId,
  { chapterIndex = null, eventId = null, fromEventId = null, toEventId = null } = {}
) => {
  const queryParams = new URLSearchParams();
  const resolvedChapter = toNumberOrNull(chapterIndex);
  if (resolvedChapter != null) queryParams.append('chapterIndex', String(resolvedChapter));
  const resolvedEventId = toTrimmedStringOrNull(eventId);
  if (resolvedEventId) queryParams.append('eventId', resolvedEventId);
  const resolvedFrom = toTrimmedStringOrNull(fromEventId);
  if (resolvedFrom) queryParams.append('fromEventId', resolvedFrom);
  const resolvedTo = toTrimmedStringOrNull(toEventId);
  if (resolvedTo) queryParams.append('toEventId', resolvedTo);

  const qs = queryParams.toString();
  const response = await authenticatedRequest(
    `/v2/books/${bookId}/relationship-deltas${qs ? `?${qs}` : ''}`,
    { softFailStatuses: SOFT_FAIL_403_404 }
  );
  return { response, result: pickResponseResult(response) };
};

/** 챕터에 델타 없음(404) — 누적 실패가 아니라 빈 커버리지 */
const isDeltasSoftEmpty = (response) => response?.code === 'NOT_FOUND';

/**
 * delta 원본 목록 조회.
 * chapterIndex | eventId | fromEventId | toEventId — 전달된 것만 쿼리로 보냄.
 */
export const fetchRelationshipDeltasList = async (
  bookId,
  { chapterIndex = null, eventId = null, fromEventId = null, toEventId = null } = {}
) => {
  requireBookId(bookId);

  const { response, result } = await requestRelationshipDeltas(bookId, {
    chapterIndex,
    eventId,
    fromEventId,
    toEventId,
  });

  const softEmpty = isDeltasSoftEmpty(response);
  const deltas = asArray(result?.deltas);
  return {
    // 404를 success 응답으로 정규화해 하위 캐시/로더가 실패로 오인하지 않게 함
    response: softEmpty
      ? {
          isSuccess: true,
          code: 'SUCCESS',
          message: '관계 델타가 없습니다.',
          result: result ?? { deltas: [] },
        }
      : response,
    bookId: result?.bookId ?? bookId,
    deltas,
    isSuccess: response?.isSuccess !== false || softEmpty,
  };
};
