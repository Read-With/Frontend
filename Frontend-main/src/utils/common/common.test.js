import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  toNumberOrNull,
  toFiniteNumber,
  toPositiveInt,
  toPositiveNumberOrNull,
  toPositiveNumberFromId,
  clampPercent,
  normalizeTitle,
  resolveChapterIndex,
} from './valueUtils.js';
import { hasGraphPanelLocationHint } from './locatorUtils.js';
import {
  resolveApiArtifactUrl,
  resolveAssetFetchUrl,
  sanitizeAssetUrl,
} from './urlUtils';

vi.mock('../api/authApi', () => ({
  authenticatedFetch: vi.fn(),
}));

describe('valueUtils', () => {
  it('toNumberOrNull', () => {
    expect(toNumberOrNull(null)).toBeNull();
    expect(toNumberOrNull(undefined)).toBeNull();
    expect(toNumberOrNull('12')).toBe(12);
    expect(toNumberOrNull('x')).toBeNull();
  });

  it('toPositiveNumberOrNull', () => {
    expect(toPositiveNumberOrNull(0)).toBeNull();
    expect(toPositiveNumberOrNull(3)).toBe(3);
  });

  it('toFiniteNumber', () => {
    expect(Number.isNaN(toFiniteNumber(undefined))).toBe(true);
    expect(toFiniteNumber(3)).toBe(3);
    expect(toFiniteNumber('4')).toBe(4);
  });

  it('toPositiveInt', () => {
    expect(toPositiveInt(0)).toBeNull();
    expect(toPositiveInt(2.9)).toBe(2);
    expect(toPositiveInt('bad', 1)).toBe(1);
  });

  it('toPositiveNumberFromId', () => {
    expect(toPositiveNumberFromId('e12')).toBe(12);
    expect(toPositiveNumberFromId('chapter-3-event-7')).toBe(7);
    expect(toPositiveNumberFromId('none')).toBeNull();
  });

  it('clampPercent', () => {
    expect(clampPercent(50.4)).toBe(50);
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(120)).toBe(100);
    expect(clampPercent('x')).toBeNull();
  });

  it('normalizeTitle', () => {
    expect(normalizeTitle('  Hello, World!  ')).toBe('helloworld');
    expect(normalizeTitle('한글 제목')).toBe('한글제목');
  });

  it('resolveChapterIndex', () => {
    expect(resolveChapterIndex({ chapterIndex: 2 })).toBe(2);
    expect(resolveChapterIndex({ chapterIdx: 3 })).toBe(3);
    expect(resolveChapterIndex({ idx: 4 })).toBe(4);
    expect(resolveChapterIndex({})).toBeNull();
  });
});

describe('hasGraphPanelLocationHint', () => {
  it('resume: startLocator에 유효 챕터면 true', () => {
    expect(
      hasGraphPanelLocationHint({ startLocator: { chapterIndex: 1, blockIndex: 0, offset: 0 } })
    ).toBe(true);
  });

  it('resume: start만 있고 chapterIdx면 true', () => {
    expect(hasGraphPanelLocationHint({ start: { chapterIdx: 2 } })).toBe(true);
  });

  it('resume: 앵커 없으면 false', () => {
    expect(hasGraphPanelLocationHint(null)).toBe(false);
    expect(hasGraphPanelLocationHint({})).toBe(false);
  });

  it('cached: locator 객체에 유효 챕터면 true', () => {
    expect(
      hasGraphPanelLocationHint(
        { locator: { chapterIndex: 1, blockIndex: 0, offset: 0 } },
        { requireEventNum: true }
      )
    ).toBe(true);
  });

  it('cached: anchor.start에 chapterIdx면 true', () => {
    expect(
      hasGraphPanelLocationHint({ anchor: { start: { chapterIdx: 3 } } }, { requireEventNum: true })
    ).toBe(true);
  });

  it('cached: chapterIdx+eventNum만 있어도 true', () => {
    expect(hasGraphPanelLocationHint({ chapterIdx: 1, eventNum: 1 }, { requireEventNum: true })).toBe(
      true
    );
  });

  it('cached: payload 없거나 힌트 없으면 false', () => {
    expect(hasGraphPanelLocationHint(null, { requireEventNum: true })).toBe(false);
    expect(hasGraphPanelLocationHint({ chapterIdx: 1, eventNum: 0 }, { requireEventNum: true })).toBe(
      false
    );
    expect(
      hasGraphPanelLocationHint({ locator: { chapterIndex: 0 } }, { requireEventNum: true })
    ).toBe(false);
  });
});

describe('urlUtils asset URLs', () => {
  describe('sanitizeAssetUrl', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('passes through CDN URLs unchanged', () => {
      vi.stubEnv('DEV', true);
      const input =
        'https://cdn.readwith.cloud/public/books/13/normalizations/x/combined.xhtml';
      expect(sanitizeAssetUrl(input)).toBe(input);
    });

    it('normalizes protocol-relative URLs', () => {
      const input = '//cdn.readwith.cloud/public/books/17/covers/x/cover.jpg';
      expect(sanitizeAssetUrl(input)).toBe(
        'https://cdn.readwith.cloud/public/books/17/covers/x/cover.jpg'
      );
    });

    it('fixes mistaken /api/public paths', () => {
      expect(sanitizeAssetUrl('/api/public/books/1/x.html')).toBe('/public/books/1/x.html');
      expect(sanitizeAssetUrl('/api/public/books/13/covers/x/cover.jpg')).toBe(
        '/public/books/13/covers/x/cover.jpg'
      );
    });
  });

  describe('resolveAssetFetchUrl', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('dev: uses /public proxy path', () => {
      vi.stubEnv('DEV', true);
      vi.stubEnv('VITE_CDN_BASE_URL', 'https://cdn.readwith.cloud');
      const input =
        'https://cdn.readwith.cloud/public/books/13/normalizations/x/combined.xhtml';
      expect(resolveAssetFetchUrl(input)).toBe(
        '/public/books/13/normalizations/x/combined.xhtml'
      );
    });

    it('repairs stale /api/public cache paths in dev', () => {
      vi.stubEnv('DEV', true);
      expect(resolveAssetFetchUrl('/api/public/books/13/x/combined.xhtml')).toBe(
        '/public/books/13/x/combined.xhtml'
      );
    });

    it('production: routes CDN public assets to same-origin /public proxy', () => {
      vi.stubEnv('DEV', false);
      const input =
        'https://cdn.readwith.cloud/public/books/13/normalizations/x/combined.xhtml';
      expect(resolveAssetFetchUrl(input)).toBe(
        '/public/books/13/normalizations/x/combined.xhtml'
      );
    });
  });

  describe('resolveApiArtifactUrl', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('uses fetch URL pipeline', () => {
      vi.stubEnv('DEV', true);
      vi.stubEnv('VITE_CDN_BASE_URL', 'https://cdn.readwith.cloud');
      expect(
        resolveApiArtifactUrl(
          'https://cdn.readwith.cloud/public/books/13/normalizations/x/combined.xhtml'
        )
      ).toBe('/public/books/13/normalizations/x/combined.xhtml');
    });

    it('resolves /public relative path with API base in dev', () => {
      vi.stubEnv('DEV', true);
      vi.stubEnv('VITE_CDN_BASE_URL', 'https://dev.readwith.cloud');
      expect(
        resolveApiArtifactUrl('/public/books/13/normalizations/x/combined.xhtml')
      ).toBe('/public/books/13/normalizations/x/combined.xhtml');
    });

    it('resolves path without leading slash via API base', () => {
      vi.stubEnv('DEV', false);
      vi.stubEnv('VITE_API_BASE_URL', 'https://dev.readwith.cloud');
      expect(
        resolveApiArtifactUrl('public/books/13/normalizations/x/combined.xhtml')
      ).toBe('https://dev.readwith.cloud/public/books/13/normalizations/x/combined.xhtml');
    });
  });
});
