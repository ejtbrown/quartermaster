import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const banner = {
  js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
};

await build({
  entryPoints: ['services/core-api/src/handler.ts'],
  outfile: 'services/core-api/dist/index.mjs',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  banner,
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
await build({
  entryPoints: ['services/core-api/src/operator.ts'],
  outfile: 'services/core-api/dist/workspace-admin.mjs',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  sourcemap: false,
  banner,
});
const artifactHealth = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      'const {handler}=await import("./services/core-api/dist/index.mjs"); console.log(JSON.stringify(await handler({rawPath:"/api/health",requestContext:{http:{method:"GET"}}})));',
    ],
    {
      encoding: 'utf8',
      env: { ...process.env, QM_WORKSPACE_ENABLED: 'false' },
    },
  ),
);
assert.equal(artifactHealth.statusCode, 200);
assert.equal(JSON.parse(artifactHealth.body).assetApiReady, false);
execFileSync(
  process.execPath,
  ['services/core-api/dist/workspace-admin.mjs', '--help'],
  { stdio: 'pipe' },
);
mkdirSync('services/operations/dist', { recursive: true });
execFileSync('zip', [
  '-q',
  '-j',
  'services/operations/dist/operations.zip',
  'services/operations/handler.py',
]);
console.log(
  'Built Lambda API; authenticated workspace is runtime-gated and synthetic-only.',
);
