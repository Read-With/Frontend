/** 문자열 정규화·변환 */

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
