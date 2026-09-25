import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { parseDocument } from 'yaml';

const inventory = parseDocument(readFileSync('inventory.yaml', 'utf8'), {
  uniqueKeys: true,
});
assert.equal(inventory.errors.length, 0, 'inventory YAML must be valid');
const settings = inventory.toJS().accepted_infrastructure_decisions;
assert.equal(settings.development_monthly_budget_usd, 100);
assert.equal(settings.development_domain, 'qm.ejtbrown.com');
assert.equal(settings.originals_retention_days, 15);
assert.equal(settings.rto_hours, 24);
assert.equal(
  settings.deletion_metadata_retention_days,
  settings.initial_backup_retention_days,
);
const client = inventory.toJS().accepted_client_decisions;
assert.equal(client.offline_support, false);
assert.equal(client.durable_local_drafts_or_queues, false);
assert.equal(client.deferred_audio, false);
assert.equal(client.native_release_required, false);
assert.equal(client.native_apps, 'deferred');
const tasks = JSON.parse(readFileSync('codex_plan.json', 'utf8'));
const keys = [
  'id',
  'priority',
  'title',
  'description',
  'rationale',
  'files_to_change',
  'commands_to_run',
  'acceptance_criteria',
  'rollback_notes',
].sort();
for (const task of tasks) assert.deepEqual(Object.keys(task).sort(), keys);
assert.equal(new Set(tasks.map((task) => task.id)).size, tasks.length);
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
assert.ok(
  !files.includes('.codex-resume'),
  'resume state must stay private and ignored',
);
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  if (
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(text) ||
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text)
  )
    throw new Error(`Possible credential in ${file}`);
  if (file.endsWith('.yml') || file.endsWith('.yaml'))
    assert.equal(
      parseDocument(text, { uniqueKeys: true }).errors.length,
      0,
      `Invalid YAML: ${file}`,
    );
}
console.log(
  `Repository configuration and basic credential-pattern checks passed for ${files.length} public-source files. This is not a comprehensive secret scan.`,
);
