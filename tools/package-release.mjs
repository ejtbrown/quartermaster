import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { filesUnder, digest, validReleasePath } from './release-files.mjs';

const commit = process.env.QM_RELEASE_SHA;
assert.match(
  commit ?? '',
  /^[0-9a-f]{40}$/,
  'Release must identify an exact GitHub commit',
);
mkdirSync('release', { recursive: true });
assert.equal(
  filesUnder('release').length,
  0,
  'Package into an empty release directory',
);
cpSync('apps/web/dist', 'release/web', { recursive: true });
cpSync('services/core-api/dist/api.zip', 'release/api.zip');
const files = Object.fromEntries(
  filesUnder('release').map((path) => {
    assert.ok(validReleasePath(path));
    return [path, digest('release/' + path)];
  }),
);
writeFileSync(
  'release/manifest.json',
  JSON.stringify({ version: 1, commit, files }, null, 2) + '\n',
);
cpSync('tools/deploy-release.mjs', 'release/deploy.mjs');
cpSync('tools/release-files.mjs', 'release/release-files.mjs');
await build({
  entryPoints: ['tools/check-edge-plan.mjs'],
  outfile: 'release/edge-check.mjs',
  platform: 'node',
  target: 'node24',
  format: 'esm',
  bundle: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
console.log(
  `Packaged ${Object.keys(files).length} verified build outputs from ${commit}.`,
);
