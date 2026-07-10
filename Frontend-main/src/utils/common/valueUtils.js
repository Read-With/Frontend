/** 숫자·문자열 변환, 깊은 복제 등 공통 값 유틸 */

export const toNumberOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const trimTrailingSlash = (value) => String(value ?? '').replace(/\/$/, '');

export const toTrimmedStringOrNull = (value) => {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length > 0 ? s : null;
};

export const toStringOrNull = (value) => (value == null ? null : String(value));

/** 책 제목 비교용 정규화 (대소문자·공백·특수문자 제거) */
export const normalizeTitle = (title) => {
  if (!title) return '';
  return String(title)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s/g, '');
};

export const toFiniteNumber = (value) => {
  if (value === undefined || value === null) return NaN;
  const converted = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(converted) ? converted : NaN;
};

export const toPositiveNumberOrNull = (value) => {
  const num = toNumberOrNull(value);
  return num && num > 0 ? num : null;
};

export const toPositiveInt = (value, fallback = null) => {
  const parsed = toFiniteNumber(value);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.trunc(parsed) : fallback;
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

/** locator·manifest·payload 공통 1-based 챕터 번호 해석 */
export const resolveChapterIndex = (row) =>
  toNumberOrNull(row?.chapterIndex ?? row?.chapterIdx ?? row?.idx);

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

export const clampPercent = (value, fallback = null) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
};

export const deepClone = (value) => {
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (error) {
    console.warn('structuredClone 실패, JSON 직렬화로 대체합니다.', error);
  }
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    console.error('deepClone 실패:', error);
    return value;
  }
};
