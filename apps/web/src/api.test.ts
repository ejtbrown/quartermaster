import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { api } from './api';

afterEach(() => vi.unstubAllGlobals());
describe('Private CloudFront API payload signing', () => {
  for (const method of ['POST', 'PATCH']) {
    it(`hashes the exact UTF-8 ${method} body and preserves security headers`, async () => {
      vi.stubGlobal('navigator', { onLine: true });
      const fetcher = vi.fn(
        async (_path: string, _init: RequestInit) =>
          new Response('{}', { status: 200 }),
      );
      vi.stubGlobal('fetch', fetcher);
      const body = JSON.stringify({ notes: 'Kitchen — café ❄' });
      await api('/api/v1/tenants/test/assets', {
        method,
        body,
        headers: {
          'x-csrf-token': 'csrf',
          'idempotency-key': 'stable-key',
          'if-match': '"2"',
        },
      });
      const init = fetcher.mock.calls[0]![1] as RequestInit;
      const headers = new Headers(init.headers);
      expect(init.body).toBe(body);
      expect(headers.get('x-amz-content-sha256')).toBe(
        createHash('sha256').update(body).digest('hex'),
      );
      expect(headers.get('x-csrf-token')).toBe('csrf');
      expect(headers.get('idempotency-key')).toBe('stable-key');
      expect(headers.get('if-match')).toBe('"2"');
    });
  }
  it('sends ordinary DELETE without a body and hashes that empty payload', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const fetcher = vi.fn(async (_path: string, init: RequestInit) => {
      expect(init.body).toBeNull();
      expect(new Headers(init.headers).get('x-amz-content-sha256')).toBe(
        createHash('sha256').update('').digest('hex'),
      );
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetcher);
    await api('/api/v1/tenants/test/assets/test', {
      method: 'DELETE',
      body: '{}',
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(
      api('/api/v1/tenants/test/tenant', {
        method: 'DELETE',
        body: '{"confirmName":"test"}',
      }),
    ).rejects.toThrow('DELETE cannot carry data');
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it('hashes empty logout requests too', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const fetcher = vi.fn(async (_path: string, init: RequestInit) => {
      expect(new Headers(init.headers).get('x-amz-content-sha256')).toBe(
        createHash('sha256').update('').digest('hex'),
      );
      return new Response('{}');
    });
    vi.stubGlobal('fetch', fetcher);
    await api('/api/auth/logout', { method: 'POST' });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
