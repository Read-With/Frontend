/** combined.xhtml·EPUB style 살균 */

import DOMPurify from 'isomorphic-dompurify';

const XHTML_SANITIZE_CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['data-chapter-index', 'data-block-index', 'epub:type'],
  FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'template'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

const CSS_SANITIZE_RULES = [
  [/\/\*[\s\S]*?\*\//g, ''],
  [/@import\b[\s\S]*?;/gi, ''],
  [/expression\s*\(/gi, 'expression-blocked('],
  [/-moz-binding\s*:/gi, 'invalid:'],
  [/behavior\s*:/gi, 'invalid:'],
  [/javascript\s*:/gi, 'invalid:'],
  [/url\s*\(\s*["']?\s*javascript:/gi, 'url(invalid:'],
  [/url\s*\(\s*["']?\s*data\s*:\s*text\/html/gi, 'url(invalid:'],
];

/** EPUB style CSS 살균 (@import·expression·javascript: url 등 제거) */
export function sanitizeEpubStyleCss(css) {
  if (!css || typeof css !== 'string') return '';
  let sanitized = css;
  for (const [pattern, replacement] of CSS_SANITIZE_RULES) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized.trim();
}

/** 문서 내 모든 style 태그 텍스트를 합쳐 살균 */
export function collectSanitizedStyleCssFromDocument(doc) {
  if (!doc?.querySelectorAll) return '';
  return Array.from(doc.querySelectorAll('style'))
    .map((el) => sanitizeEpubStyleCss(el.textContent ?? ''))
    .filter(Boolean)
    .join('\n\n');
}

/** body innerHTML 살균 (data-chapter-index 등 로케이터 속성 유지) */
export function sanitizeXhtmlBodyHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, XHTML_SANITIZE_CONFIG);
}
