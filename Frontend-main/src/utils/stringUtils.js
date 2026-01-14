/**
 * 문자열 유틸리티 함수 모음
 */

/**
 * 책 제목을 정규화합니다.
 * 대소문자, 공백, 특수문자를 제거하여 비교 가능한 형태로 변환합니다.
 * 
 * @param {string} title - 정규화할 제목
 * @returns {string} 정규화된 제목
 */
export const normalizeTitle = (title) => {
  if (!title) return '';
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣]/g, '')
    .replace(/\s/g, '');
};
