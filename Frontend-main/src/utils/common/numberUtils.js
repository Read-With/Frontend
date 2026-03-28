// 숫자 변환 유틸리티

export const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const toPositiveNumberOrNull = (value) => {
  const num = toNumberOrNull(value);
  return num && num > 0 ? num : null;
};

export const safeParseInt = (value, fallback = 0) => {
  const num = toNumberOrNull(value);
  return num !== null ? Math.trunc(num) : fallback;
};

export const clampNumber = (value, min, max) => {
  const num = toNumberOrNull(value);
  if (num === null) return min;
  return Math.max(min, Math.min(max, num));
};
