import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('disposable CI toolchain installation', () => {
  it('installs build tools locally without overwriting the image Node executable', () => {
    const installer = readFileSync('tools/ci-install.sh', 'utf8');
    const buildspec = readFileSync('buildspec.yml', 'utf8');
    expect(installer).toContain('${CODEBUILD_SRC_DIR:?');
    expect(installer).toContain(
      '--prefix "$CODEBUILD_SRC_DIR/.local/toolchain"',
    );
    expect(installer).toContain('node@24.20.0 pnpm@10.34.5');
    expect(installer).not.toContain('npm install --global');
    expect(buildspec).toContain(
      '$CODEBUILD_SRC_DIR/.local/toolchain/node_modules/.bin:',
    );
  });

  it('uses the same isolated Node path in the Terraform-managed deployment job', () => {
    const pipeline = readFileSync(
      'infra/environments/delivery/pipeline.tf',
      'utf8',
    );
    expect(pipeline).toContain(
      'npm install --prefix .local/toolchain --no-save --package-lock=false node@24.20.0',
    );
    expect(pipeline).toContain(
      '$CODEBUILD_SRC_DIR/.local/toolchain/node_modules/.bin:$PATH',
    );
    expect(pipeline).not.toContain('npm install --global');
  });
});
