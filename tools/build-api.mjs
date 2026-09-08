import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

await build({
  entryPoints: ['services/core-api/src/handler.ts'],
  outfile: 'services/core-api/dist/index.mjs',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  define: {
    'process.env.QM_RELEASE_SHA': JSON.stringify(
      process.env.QM_RELEASE_SHA ?? 'local-preview',
    ),
  },
});
execFileSync('zip', [
  '-q',
  '-j',
  'services/core-api/dist/api.zip',
  'services/core-api/dist/index.mjs',
]);
mkdirSync('services/operations/dist', { recursive: true });
execFileSync('zip', [
  '-q',
  '-j',
  'services/operations/dist/operations.zip',
  'services/operations/handler.py',
]);
console.log(
  'Built health-only Lambda entry point. No authenticated asset API is exposed.',
);
