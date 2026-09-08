import { expect, it } from 'vitest';
// @ts-expect-error The deploy helper deliberately has no build-time dependencies.
import { validReleasePath } from '../tools/release-files.mjs';

it.each(['api.zip', 'web/index.html', 'web/assets/main-123.js'])(
  'accepts release artifact %s',
  (path) => expect(validReleasePath(path)).toBe(true),
);
it.each([
  '../api.zip',
  'web/../secret',
  '/web/a',
  'web//a',
  'web/./a',
  'web/a;sh',
  'manifest.json',
])('rejects unsafe artifact path %s', (path) =>
  expect(validReleasePath(path)).toBe(false),
);
