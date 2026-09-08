import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, it } from 'vitest';

function edge(name: string, event: unknown) {
  return runInNewContext(
    readFileSync(`services/edge/${name}.js`, 'utf8') + '\nhandler(event)',
    { event },
  );
}
it('rewrites navigation but not assets or unknown API paths', () => {
  expect(edge('navigation', { request: { uri: '/estate' } }).uri).toBe(
    '/index.html',
  );
  expect(edge('navigation', { request: { uri: '/assets/file.js' } }).uri).toBe(
    '/assets/file.js',
  );
  expect(edge('navigation', { request: { uri: '/api' } }).statusCode).toBe(404);
});
it('locks down the preview without enabling camera or microphone', () => {
  const result = edge('security', { response: { headers: {} } });
  expect(result.headers['content-security-policy'].value).toContain(
    "frame-ancestors 'none'",
  );
  expect(result.headers['permissions-policy'].value).toContain('microphone=()');
});
