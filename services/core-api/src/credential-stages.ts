import assert from 'node:assert/strict';

// Secrets Manager labels the first version CURRENT even when PENDING was
// requested. Resume only that same unfinished version, never rotate a live one.
export function initialCredentialStages(
  versions: Record<string, string[]> = {},
) {
  const entries = Object.entries(versions);
  const current = entries.find(([, stages]) =>
    stages.includes('AWSCURRENT'),
  )?.[0];
  const pending = entries.find(([, stages]) =>
    stages.includes('AWSPENDING'),
  )?.[0];
  assert.ok(
    !current || current === pending,
    'Runtime credential already exists; use a separately reviewed rotation',
  );
  return { current, pending };
}
