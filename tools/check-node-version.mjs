import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const expected = readFileSync(
  new URL('../.node-version', import.meta.url),
  'utf8',
).trim();
console.log(
  `Node runtime: ${process.version} (${process.execPath}); expected: v${expected}`,
);
assert.equal(
  process.versions.node,
  expected,
  'Node runtime must match .node-version',
);
