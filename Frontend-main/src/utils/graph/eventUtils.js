import { toNumberOrNull } from '../common/numberUtils';
import { toPositiveInt } from './graphNormalizeUtils';

const truncIdx = (value) => {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
};

const normalizeTargetIdx = (targetIdx) => {
  const target = truncIdx(targetIdx);
  return target === null || target < 0 ? null : target;
};

export const getEventOrderIdx = (event) => {
  return (
    truncIdx(event?.eventIdx) ??
    truncIdx(event?.idx) ??
    truncIdx(event?.eventNum)
  );
};

const compareNullableIdxAsc = (idxA, idxB) => {
  if (idxA === null && idxB === null) return 0;
  if (idxA === null) return 1;
  if (idxB === null) return -1;
  return idxA - idxB;
};

export const compareEventsByIdx = (a, b) => {
  return compareNullableIdxAsc(getEventOrderIdx(a), getEventOrderIdx(b));
};

const filterEventsByIdx = (events, targetIdx, predicate) => {
  if (!Array.isArray(events)) return [];
  const target = normalizeTargetIdx(targetIdx);
  if (target === null) return [];
  return events.filter((entry) => {
    const eventIdx = getEventOrderIdx(entry);
    return eventIdx !== null && predicate(eventIdx, target);
  });
};

/**
 * eventIdx 기준 오름차순. eventIdx 없음은 맨 뒤.
 */
export const sortEventsByIdx = (events) => {
  if (!Array.isArray(events)) return [];
  return [...events].sort(compareEventsByIdx);
};

/**
 * eventIdx가 숫자인 항목만 대상으로 idx 이하 포함. (eventIdx 없음 제외)
 * 누적 그래프용 — 배열은 sortEventsByIdx 후 넘기는 것이 안전.
 */
export const filterEventsUpTo = (events, targetIdx) => {
  return filterEventsByIdx(events, targetIdx, (eventIdx, target) => eventIdx <= target);
};

/**
 * eventIdx가 숫자인 항목만 대상으로 idx 미만.
 */
export const filterEventsBefore = (events, targetIdx) => {
  return filterEventsByIdx(events, targetIdx, (eventIdx, target) => eventIdx < target);
};

export const getMaxEventIdx = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 0;
  return events.reduce((max, event) => {
    const idx = getEventOrderIdx(event);
    if (idx === null) return max;
    return Math.max(max, idx);
  }, 0);
};

/**
 * 1-based 이벤트 인덱스 정규화.
 * @param {*} requestedIdx
 * @param {*} maxIdx 상한(포함). 0이면 이벤트 없음 → 항상 0. null/undefined면 상한 없음(무효 요청 시 1).
 */
export const normalizeEventIdx = (requestedIdx, maxIdx) => {
  const maxRaw = toNumberOrNull(maxIdx);
  const hasUpper = maxRaw !== null && Number.isFinite(maxRaw);
  const maxInt = hasUpper ? (toPositiveInt(maxRaw, 0) ?? 0) : null;

  const reqInt = truncIdx(requestedIdx);

  if (hasUpper && maxInt === 0) {
    return 0;
  }

  if (!hasUpper) {
    if (reqInt !== null && reqInt >= 1) return reqInt;
    return 1;
  }

  if (reqInt === null || reqInt < 1) {
    return maxInt;
  }
  return Math.min(reqInt, maxInt);
};
