import DOMPurify from 'isomorphic-dompurify';

const CONFIG = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ['data-chapter-index', 'data-block-index', 'epub:type'],
  FORBID_TAGS: ['iframe', 'object', 'embed', 'form', 'template'],
  ALLOW_UNKNOWN_PROTOCOLS: false,
};

/**
 * EPUB `<style>` 내부 CSS 텍스트 살균. @import·레거시 스크립트형 CSS·위험 url() 완화.
 * (http(s) 원격 font·이미지 url() 은 EPUB 호환을 위해 그대로 둠 — CSP와 함께 검토)
 * @param {string} css
 * @returns {string}
 */
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

/**
 * parseFromString 결과 문서의 모든 `<style>` 텍스트를 합쳐 살균한다.
 * @param {Document} doc
 * @returns {string}
 */
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

/**
 * combined.xhtml body innerHTML용 살균. 스크립트·이벤트 핸들러·위험 태그 제거,
 * 블록 로케이터용 data-* 는 유지.
 * @param {string} html
 * @returns {string}
 */
export function sanitizeXhtmlBodyHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return DOMPurify.sanitize(html, CONFIG);
}
