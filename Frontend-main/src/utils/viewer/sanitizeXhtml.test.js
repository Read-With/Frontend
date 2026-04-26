import { describe, it, expect } from 'vitest';
import {
  sanitizeXhtmlBodyHtml,
  sanitizeEpubStyleCss,
  collectSanitizedStyleCssFromDocument,
} from './sanitizeXhtml.js';

describe('sanitizeXhtmlBodyHtml', () => {
  it('removes script tags', () => {
    const out = sanitizeXhtmlBodyHtml('<p>a</p><script>alert(1)</script><p>b</p>');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).toContain('a');
    expect(out).toContain('b');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeXhtmlBodyHtml('<p onclick="alert(1)">x</p>');
    expect(out.toLowerCase()).not.toContain('onclick');
  });

  it('keeps block locator data attributes', () => {
    const out = sanitizeXhtmlBodyHtml(
      '<div data-chapter-index="3" data-block-index="7"><span>text</span></div>'
    );
    expect(out).toContain('data-chapter-index="3"');
    expect(out).toContain('data-block-index="7"');
  });

  it('removes iframe', () => {
    const out = sanitizeXhtmlBodyHtml('<p>x</p><iframe src="https://evil"></iframe>');
    expect(out.toLowerCase()).not.toContain('iframe');
  });
});

describe('sanitizeEpubStyleCss', () => {
  it('strips @import', () => {
    const out = sanitizeEpubStyleCss('p{color:red} @import url("https://x.com/a.css"); h1{font-size:2em}');
    expect(out.toLowerCase()).not.toContain('@import');
    expect(out).toContain('color:red');
    expect(out).toContain('h1');
  });

  it('neutralizes javascript: url()', () => {
    const out = sanitizeEpubStyleCss('a{background:url(javascript:alert(1))}');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });
});

describe('collectSanitizedStyleCssFromDocument', () => {
  it('merges multiple style blocks (node 환경용 최소 mock)', () => {
    const doc = {
      querySelectorAll: () => [
        { textContent: 'p{a:1}' },
        { textContent: 'h1{b:2}' },
      ],
    };
    const out = collectSanitizedStyleCssFromDocument(doc);
    expect(out).toContain('p{a:1}');
    expect(out).toContain('h1{b:2}');
  });
});
