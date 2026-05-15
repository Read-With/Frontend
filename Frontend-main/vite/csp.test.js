import { describe, it, expect } from 'vitest';
import { buildContentSecurityPolicy } from './csp.js';

describe('buildContentSecurityPolicy', () => {
  it('production script-src has no unsafe-eval / script unsafe-inline', () => {
    const s = buildContentSecurityPolicy({}, { dev: false });
    expect(s).toMatch(/script-src[^;]+/);
    expect(s).not.toContain('unsafe-eval');
    expect(s).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  });

  it('development script-src allows Vite HMR', () => {
    const s = buildContentSecurityPolicy({}, { dev: true });
    expect(s).toContain('unsafe-eval');
    expect(s).toContain("'unsafe-inline'");
  });

  it('adds VITE_DEV_PROXY_TARGET origin to connect-src in dev', () => {
    const s = buildContentSecurityPolicy(
      { VITE_DEV_PROXY_TARGET: 'http://api.example.test:8080/path' },
      { dev: true }
    );
    expect(s).toContain('http://api.example.test:8080');
  });

  it('allows readwith CDN for normalized asset fetch (connect-src)', () => {
    const prod = buildContentSecurityPolicy({}, { dev: false });
    const dev = buildContentSecurityPolicy({}, { dev: true });
    expect(prod).toContain('https://cdn.readwith.store');
    expect(dev).toContain('https://cdn.readwith.store');
  });
});
