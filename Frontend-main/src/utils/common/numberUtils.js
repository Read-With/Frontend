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

export const toPositiveNumberFromId = (value) => {
  if (value == null) return null;
  const direct = toPositiveNumberOrNull(value);
  if (direct) return direct;

  const text = String(value).trim();
  if (!text) return null;

  const eTail = text.match(/[eE](\d+)\s*$/);
  if (eTail) return toPositiveNumberOrNull(eTail[1]);

  const lastDigits = text.match(/(\d+)\s*$/);
  return lastDigits ? toPositiveNumberOrNull(lastDigits[1]) : null;
};

export const isPositiveFiniteNumber = (value) => {
  const num = toNumberOrNull(value);
  return num !== null && num > 0;
};

/** URL·쿼리·상태에서 온 1-based 챕터 번호: trim 후 유한·정수·>= 1 만 통과 */
export const toOneBasedChapterIndexOrNull = (value) => {
  if (value === null || value === undefined) return null;
  let v = value;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '') return null;
    v = s;
  }
  const num = Number(v);
  if (!Number.isFinite(num) || num < 1) return null;
  const t = Math.trunc(num);
  return t === num ? t : null;
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

export const clampPercent = (value, fallback = null) => {
  const num = toNumberOrNull(value);
  if (num === null) return fallback;
  return clampNumber(num, 0, 100);
};
