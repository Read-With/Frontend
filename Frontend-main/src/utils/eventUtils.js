import { toNumberOrNull } from './numberUtils';

// 이벤트 정렬 (eventIdx 기준)
export const sortEventsByIdx = (events) => {
  if (!Array.isArray(events)) return [];
  return [...events].sort((a, b) => {
    const idxA = toNumberOrNull(a?.eventIdx) || 0;
    const idxB = toNumberOrNull(b?.eventIdx) || 0;
    return idxA - idxB;
  });
};

// 특정 이벤트까지의 이벤트 필터
export const filterEventsUpTo = (events, targetIdx) => {
  if (!Array.isArray(events)) return [];
  const target = toNumberOrNull(targetIdx);
  if (target === null) return [];
  return events.filter((entry) => toNumberOrNull(entry?.eventIdx) <= target);
};

// 특정 이벤트 전까지의 이벤트 필터
export const filterEventsBefore = (events, targetIdx) => {
  if (!Array.isArray(events)) return [];
  const target = toNumberOrNull(targetIdx);
  if (target === null) return [];
  return events.filter((entry) => toNumberOrNull(entry?.eventIdx) < target);
};

// 최대 이벤트 인덱스 찾기
export const getMaxEventIdx = (events) => {
  if (!Array.isArray(events) || events.length === 0) return 0;
  return events.reduce((max, event) => {
    const idx = toNumberOrNull(event?.eventIdx) || 0;
    return Math.max(max, idx);
  }, 0);
};

// 이벤트 인덱스 정규화 (범위 내로 제한)
export const normalizeEventIdx = (requestedIdx, maxIdx) => {
  let targetIdx = toNumberOrNull(requestedIdx);
  if (!targetIdx || targetIdx < 1) {
    targetIdx = maxIdx || 1;
  }
  if (maxIdx && targetIdx > maxIdx) {
    targetIdx = maxIdx;
  }
  return targetIdx;
};
