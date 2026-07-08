import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  rewriteLegacyAssetUrl,
  stripWrongApiPublicPrefix,
  preferDevPublicProxyPath,
  resolveApiArtifactUrl,
  resolveAssetFetchUrl,
  sanitizeAssetUrl,
  extractBookIdFromPublicAssetUrl,
  isPublicCoverAssetPath,
} from './artifactUrlUtils';

vi.mock('./authUtils', () => ({
  getApiBaseUrl: () => 'https://dev.readwith.cloud',
}));

describe('stripWrongApiPublicPrefix', () => {
  it('fixes mistaken /api/public paths', () => {
    expect(stripWrongApiPublicPrefix('/api/public/books/1/x.html')).toBe(
      '/public/books/1/x.html'
    );
  });
});

describe('rewriteLegacyAssetUrl', () => {
  it('keeps cdn.readwith.cloud URLs unchanged', () => {
    const input =
      'https://cdn.readwith.cloud/public/books/17/normalizations/x/combined.xhtml';
    expect(rewriteLegacyAssetUrl(input)).toBe(input);
  });

  it('normalizes protocol-relative URLs', () => {
    const input =
      '//cdn.readwith.cloud/public/books/17/covers/x/cover.jpg';
    expect(rewriteLegacyAssetUrl(input)).toBe(
      'https://cdn.readwith.cloud/public/books/17/covers/x/cover.jpg'
    );
  });
});

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

  it('production: routes CDN public assets through API (CORS)', () => {
    vi.stubEnv('DEV', false);
    const input =
      'https://cdn.readwith.cloud/public/books/13/normalizations/x/combined.xhtml';
    expect(resolveAssetFetchUrl(input)).toBe(
      'https://dev.readwith.cloud/public/books/13/normalizations/x/combined.xhtml'
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
    expect(
      resolveApiArtifactUrl('public/books/13/normalizations/x/combined.xhtml')
    ).toBe(
      'https://dev.readwith.cloud/public/books/13/normalizations/x/combined.xhtml'
    );
  });
});

describe('preferDevPublicProxyPath', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns /public relative path in dev', () => {
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_CDN_BASE_URL', 'https://dev.readwith.cloud');
    const input =
      'https://dev.readwith.cloud/public/books/13/normalizations/x/combined.xhtml';
    expect(preferDevPublicProxyPath(input)).toBe(
      '/public/books/13/normalizations/x/combined.xhtml'
    );
  });
});

describe('extractBookIdFromPublicAssetUrl', () => {
  it('extracts book id from public asset paths', () => {
    expect(
      extractBookIdFromPublicAssetUrl(
        'https://dev.readwith.cloud/public/books/13/covers/x/cover.jpg'
      )
    ).toBe(13);
    expect(extractBookIdFromPublicAssetUrl('/public/books/7/normalizations/x/combined.xhtml')).toBe(
      7
    );
    expect(extractBookIdFromPublicAssetUrl('https://example.com/x')).toBeNull();
  });
});

describe('isPublicCoverAssetPath', () => {
  it('detects cover asset paths', () => {
    expect(
      isPublicCoverAssetPath('https://dev.readwith.cloud/public/books/1/covers/x/cover.jpg')
    ).toBe(true);
    expect(
      isPublicCoverAssetPath('https://dev.readwith.cloud/public/books/1/normalizations/x/combined.xhtml')
    ).toBe(false);
  });
});
