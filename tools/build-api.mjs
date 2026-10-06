import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  cpSync,
  readFileSync,
  realpathSync,
  existsSync,
  mkdtempSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import assert from 'node:assert/strict';

const banner = {
  js: "import { createRequire as __qmCreateRequire } from 'node:module'; const require = __qmCreateRequire(import.meta.url);",
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
await build({
  entryPoints: ['services/core-api/src/restore-operator.ts'],
  outfile: 'services/core-api/dist/restore-admin.mjs',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  banner,
});
execFileSync(
  process.execPath,
  ['services/core-api/dist/restore-admin.mjs', '--help'],
  { stdio: 'pipe' },
);
assert.equal(artifactHealth.statusCode, 200);
assert.equal(JSON.parse(artifactHealth.body).assetApiReady, false);
execFileSync(
  process.execPath,
  ['services/core-api/dist/workspace-admin.mjs', '--help'],
  { stdio: 'pipe' },
);
// Native image decoding is external to the JS bundle. Include the lockfile's
// Linux ARM64 packages for Lambda plus x64 for an actual local artifact smoke.
const workerDir = mkdtempSync('services/core-api/dist/worker-');
await build({
  entryPoints: ['services/core-api/src/worker.ts'],
  outfile: workerDir + '/index.mjs',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  external: ['sharp'],
  banner,
  define: {
    'process.env.QM_RELEASE_SHA': JSON.stringify(
      process.env.QM_RELEASE_SHA ?? 'local-preview',
    ),
  },
});
const nativeNames = new Set([
  'sharp',
  '@img/sharp-linux-arm64',
  '@img/sharp-libvips-linux-arm64',
  '@img/sharp-linux-x64',
  '@img/sharp-libvips-linux-x64',
]);
const copied = new Set();
function copyPackage(name, from) {
  if (copied.has(name)) return;
  const req = createRequire(from);
  const manifest =
    name === 'sharp'
      ? resolve(dirname(req.resolve('sharp')), '../package.json')
      : req.resolve(
          name +
            (name.startsWith('@img/sharp-') ? '/package' : '/package.json'),
        );
  const directory = dirname(realpathSync(manifest));
  const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
  const destination = resolve(workerDir, 'node_modules', name);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(directory, destination, {
    recursive: true,
    dereference: true,
    filter: (source) => !source.startsWith(join(directory, 'node_modules')),
  });
  copied.add(name);
  for (const dependency of Object.keys(metadata.dependencies ?? {}))
    copyPackage(dependency, manifest);
  for (const dependency of Object.keys(metadata.optionalDependencies ?? {}))
    if (nativeNames.has(dependency)) copyPackage(dependency, manifest);
}
copyPackage('sharp', resolve('services/core-api/package.json'));
for (const name of nativeNames)
  assert.ok(copied.has(name), `Missing native package ${name}`);
assert.ok(
  existsSync(
    resolve(
      workerDir,
      'node_modules/@img/sharp-linux-arm64/lib/sharp-linux-arm64-0.35.5.node',
    ),
  ),
);
const workerHealth = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {handler}=await import('./${workerDir}/index.mjs'); console.log(JSON.stringify(await handler({health:true})));`,
    ],
    { encoding: 'utf8' },
  ),
);
assert.equal(workerHealth.ready, true);
// Fresh ZIP avoids stale archive entries after a dependency or source removal.
execFileSync('zip', ['-q', '-r', 'worker.zip', 'index.mjs', 'node_modules'], {
  cwd: workerDir,
});
cpSync(join(workerDir, 'worker.zip'), 'services/core-api/dist/worker.zip');
mkdirSync('services/operations/dist', { recursive: true });
execFileSync('zip', [
  '-q',
  '-j',
  'services/operations/dist/operations.zip',
  'services/operations/handler.py',
]);
console.log(
  'Built API, operational worker with native image decoder, and operator tools; artifact smoke checks passed.',
);
