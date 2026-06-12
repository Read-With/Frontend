/** 챕터 제목·배지·목차 표시 (책 제목 접두어 제거) */

function collapseWhitespace(s) {
  return String(s).trim().replace(/\s+/g, ' ');
}

/** 챕터 제목 앞이 책 제목과 같으면 나머지만 반환 */
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

/** 상단바: "chapter {순서} : {이름}" */
export function formatChapterOrderAndName(orderOneBased, chapterTitle) {
  const ord = Number(orderOneBased);
  const o = Number.isFinite(ord) && ord >= 1 ? String(Math.trunc(ord)) : '—';
  const name = collapseWhitespace(String(chapterTitle ?? '').trim());
  if (!name) return `chapter ${o}`;
  return `chapter ${o} : ${name}`;
}
