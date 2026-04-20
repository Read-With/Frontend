/**
 * 매니페스트 챕터 title 표시용: 문자열에 로마숫자 또는 아라비아 숫자가 있으면 그 부분만,
 * 둘 다 없으면 원문 그대로.
 */

const ROMAN_GLYPH = /^[IVXLCDM]+$/i;

function romanToInt(roman) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const u = roman.toUpperCase();
  let total = 0;
  let prev = 0;
  for (let i = u.length - 1; i >= 0; i -= 1) {
    const v = map[u[i]];
    if (v == null) return 0;
    if (v < prev) total -= v;
    else {
      total += v;
      prev = v;
    }
  }
  return total;
}

function isValidRomanToken(token) {
  const u = String(token).toUpperCase();
  if (!ROMAN_GLYPH.test(u) || u.length > 12) return false;
  const strict = /^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;
  if (!strict.test(u)) return false;
  const n = romanToInt(u);
  return n >= 1 && n <= 3999;
}

function isPlausibleRomanInTitle(fullTitle, token, startIndex) {
  if (!isValidRomanToken(token)) return false;
  const u = String(token).toUpperCase();
  if (u.length >= 2) return true;
  const pre = fullTitle.slice(0, startIndex);
  if (/\b(?:chapter|ch\.?|part|book|section)\s*$/i.test(pre)) return true;
  const trimmed = pre.trimEnd();
  return /[-–—]\s*$/i.test(trimmed);
}

function collapseWhitespace(s) {
  return String(s).trim().replace(/\s+/g, ' ');
}

/**
 * 챕터 제목 앞부분이 책 제목과 같으면(대소문자·연속 공백 무시) 나머지 문자열만 반환.
 * @param {string} chapterTitle
 * @param {string} bookTitle
 * @returns {string}
 */
export function stripRedundantBookTitlePrefix(chapterTitle, bookTitle) {
  const ch = String(chapterTitle ?? '').trim();
  const book = String(bookTitle ?? '').trim();
  if (!ch || !book) return ch;

  const chN = collapseWhitespace(ch);
  const bookN = collapseWhitespace(book);
  const chL = chN.toLowerCase();
  const bookL = bookN.toLowerCase();

  if (chL === bookL) return ch;
  if (!chL.startsWith(bookL)) return ch;

  let rest = chN.slice(bookN.length).trim();
  rest = rest.replace(/^[-–—:|]+\s*/, '').trim();
  if (!rest) return ch;
  return rest;
}

/**
 * @param {string} title
 * @returns {string}
 */
export function formatChapterBadgeFromTitle(title) {
  const s = String(title ?? '').trim();
  if (!s) return '';

  const romanRe = /\b([IVXLCDM]{1,6})\b/gi;
  let firstRoman = null;
  let romanIdx = Infinity;
  let m;
  while ((m = romanRe.exec(s)) !== null) {
    if (isPlausibleRomanInTitle(s, m[1], m.index)) {
      firstRoman = m[1].toUpperCase();
      romanIdx = m.index;
      break;
    }
  }

  const arabRe = /\d+/g;
  let firstArab = null;
  let arabIdx = Infinity;
  while ((m = arabRe.exec(s)) !== null) {
    firstArab = m[0];
    arabIdx = m.index;
    break;
  }

  if (romanIdx !== Infinity && arabIdx !== Infinity) {
    return romanIdx <= arabIdx ? firstRoman : firstArab;
  }
  if (romanIdx !== Infinity) return firstRoman;
  if (arabIdx !== Infinity) return firstArab;
  return s;
}

function isChapterNumeralBadge(v) {
  if (!v || v === '—') return false;
  if (/^\d+$/.test(v)) return true;
  return isValidRomanToken(v);
}

/**
 * 뷰어 그래프 분할 화면 전용: 숫자·로마자 배지면 "chapter {값}", 아니면 문자열 그대로.
 * @param {string|number} value
 * @returns {string}
 */
export function formatChapterColonLine(value) {
  const v = String(value ?? '').trim();
  if (!v || v === '—') return 'chapter —';
  if (isChapterNumeralBadge(v)) return `chapter ${v}`;
  return v;
}

/**
 * 뷰어 상단바: 1부터 시작하는 챕터 순서 + 챕터 이름.
 * @param {string|number} orderOneBased
 * @param {string} chapterTitle 표시용 제목(이미 정리된 문자열 권장)
 * @returns {string}
 */
export function formatChapterOrderAndName(orderOneBased, chapterTitle) {
  const ord = Number(orderOneBased);
  const o = Number.isFinite(ord) && ord >= 1 ? String(Math.trunc(ord)) : '—';
  const name = collapseWhitespace(String(chapterTitle ?? '').trim());
  if (!name) return `chapter ${o}`;
  return `chapter ${o} : ${name}`;
}

/**
 * 서재·그래프 전체화면 목차 등: 접두어 없이 숫자만(제목에서 뽑은 아라비아/로마, 없으면 챕터 인덱스).
 * @param {string} part formatChapterBadgeFromTitle 결과 또는 idxStr
 * @param {string} idxStr 챕터 인덱스 문자열
 * @returns {string}
 */
export function formatChapterTocNumericLine(part, idxStr) {
  const p = String(part ?? '').trim();
  const idx = String(idxStr ?? '').trim();
  if (isChapterNumeralBadge(p)) return p;
  if (idx && idx !== '—') return idx;
  return '—';
}
