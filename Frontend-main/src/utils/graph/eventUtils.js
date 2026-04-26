import { toNumberOrNull } from '../common/numberUtils';

const truncIdx = (value) => {
  const n = toNumberOrNull(value);
  return n === null ? null : Math.trunc(n);
};

/**
 * eventIdx 기준 오름차순. eventIdx 없음은 맨 뒤.
 */
export const sortEventsByIdx = (events) => {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => {
    const idxA = toNumberOrNull(a?.eventIdx) || 0;
    const idxB = toNumberOrNull(b?.eventIdx) || 0;
    return idxA - idxB;
  });
};

/**
 * eventIdx가 숫자인 항목만 대상으로 idx 이하 포함. (eventIdx 없음 제외)
 * 누적 그래프용 — 배열은 sortEventsByIdx 후 넘기는 것이 안전.
 */
export const filterEventsUpTo = (events, targetIdx) => {
  if (!Array.isArray(events)) return [];
  const target = truncIdx(targetIdx);
  if (target === null || target < 0) return [];
  return events.filter((entry) => {
    const e = truncIdx(entry?.eventIdx);
    return e !== null && e <= target;
  });
};

/**
 * eventIdx가 숫자인 항목만 대상으로 idx 미만.
 */
export const filterEventsBefore = (events, targetIdx) => {
  if (!Array.isArray(events)) return [];
  const target = truncIdx(targetIdx);
  if (target === null || target < 0) return [];
  return events.filter((entry) => {
    const e = truncIdx(entry?.eventIdx);
    return e !== null && e < target;
  });
};

export const getMaxEventIdx = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 0;
  return events.reduce((max, event) => {
    const idx = truncIdx(event?.eventIdx);
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
  const maxInt = hasUpper ? Math.max(0, Math.trunc(maxRaw)) : null;

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
