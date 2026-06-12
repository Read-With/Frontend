/** combined.xhtml·EPUB style 살균 */

import DOMPurify from 'isomorphic-dompurify';

const CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['data-chapter-index', 'data-block-index', 'epub:type'],
  FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'template'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

/** EPUB style CSS 살균 (@import·expression·javascript: url 등 제거) */
export function sanitizeEpubStyleCss(css) {
  if (!css || typeof css !== 'string') return '';
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/@import\b[\s\S]*?;/gi, '');
  s = s.replace(/expression\s*\(/gi, 'expression-blocked(');
  s = s.replace(/-moz-binding\s*:/gi, 'invalid:');
  s = s.replace(/behavior\s*:/gi, 'invalid:');
  s = s.replace(/javascript\s*:/gi, 'invalid:');
  s = s.replace(/url\s*\(\s*["']?\s*javascript:/gi, 'url(invalid:');
  s = s.replace(/url\s*\(\s*["']?\s*data\s*:\s*text\/html/gi, 'url(invalid:');
  return s.trim();
}

/** 문서 내 모든 style 태그 텍스트를 합쳐 살균 */
export function collectSanitizedStyleCssFromDocument(doc) {
  if (!doc?.querySelectorAll) return '';
  const styles = doc.querySelectorAll('style');
  if (!styles.length) return '';
  const parts = [];
  styles.forEach((el) => {
    const raw = el.textContent ?? '';
    const cleaned = sanitizeEpubStyleCss(raw);
    if (cleaned) parts.push(cleaned);
  });
  return parts.join('\n\n');
}

/** body innerHTML 살균 (data-chapter-index 등 로케이터 속성 유지) */
export function sanitizeXhtmlBodyHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, CONFIG);
}
