import { spawnSync } from 'node:child_process';

function run(args) {
  const result = spawnSync('terraform', args, {
    stdio: 'inherit',
    env: { ...process.env, TF_IN_AUTOMATION: '1' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(['fmt', '-check', '-recursive', 'infra']);
for (const directory of [
  'infra/bootstrap',
  'infra/modules/foundation',
  'infra/environments/dev',
  'infra/environments/delivery',
]) {
  run([`-chdir=${directory}`, 'init', '-backend=false', '-input=false']);
  run([`-chdir=${directory}`, 'validate', '-no-color']);
  run([`-chdir=${directory}`, 'test', '-no-color']);
}
console.log(
  'Terraform formatting, validation and mock-provider tests passed. No cloud resources were created.',
);
