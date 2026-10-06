// Explicit development acceptance test, not part of CI and never a warm-up.
// Creates one suppressed-email, membership-free Cognito test identity. Exercises
// first-login/password/TOTP setup and a subsequent password+TOTP sign-in using
// the public browser UI. Finally deletes only its own identity and auth state.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';

assert.equal(process.env.QM_AUTH_LIVE_CHECK, 'development-only');
const region = 'us-east-2',
  pool = 'us-east-2_yxPPA4BB1',
  origin = 'https://qm.ejtbrown.com';
function aws(args, input) {
  // Secrets go through stdin, never command-line arguments, logs or files.
  const output = execFileSync(
    'aws',
    [
      ...args,
      '--profile',
      'default',
      '--region',
      region,
      '--output',
      'json',
      ...(input ? ['--cli-input-json', 'file:///dev/stdin'] : []),
    ],
    {
      encoding: 'utf8',
      ...(input ? { input: JSON.stringify(input) } : {}),
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
  return output.trim() ? JSON.parse(output) : {};
}
assert.equal(aws(['sts', 'get-caller-identity']).Account, '264702148921');
assert.equal(
  (await (await fetch(origin + '/api/health')).json()).release,
  process.env.QM_EXPECTED_RELEASE,
);
const email = `qm-auth-check-${randomUUID()}@example.invalid`,
  temporary = `Qm1!${randomBytes(24).toString('base64url')}`,
  permanent = `Qm2!${randomBytes(24).toString('base64url')}`;
function totp(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of secret.toUpperCase().replaceAll('=', ''))
    bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const key = Buffer.from(
      bits.match(/.{8}/g).map((value) => parseInt(value, 2)),
    ),
    counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac('sha1', key).update(counter).digest(),
    offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(
    6,
    '0',
  );
}
let stage = 'initialization';
let created = false,
  browser;
const authKeys = new Set();
try {
  aws(['cognito-idp', 'admin-create-user'], {
    UserPoolId: pool,
    Username: email,
    TemporaryPassword: temporary,
    MessageAction: 'SUPPRESS',
    UserAttributes: [{ Name: 'email', Value: email }],
  });
  created = true;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.name));
  page.on('response', async (response) => {
    if (!response.url().startsWith(origin + '/api/auth/')) return;
    for (const { name, value } of await response.headersArray()) {
      if (name.toLowerCase() !== 'set-cookie') continue;
      const match = value.match(
        /^__Host-qm_(session|signin)=([A-Za-z0-9_-]{43});/,
      );
      if (match)
        authKeys.add(
          `${match[1] === 'session' ? 'SESSION' : 'LOGIN'}#${createHash('sha256').update(match[2]).digest('hex')}`,
        );
    }
  });
  page.setDefaultTimeout(65000);
  await page.goto(origin + '/sign-in?reauth=1');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(temporary);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  stage = 'invitation password change';
  await page.getByLabel('New password', { exact: true }).fill(permanent);
  await page
    .getByLabel('Confirm new password', { exact: true })
    .fill(permanent);
  await page
    .getByRole('button', { name: 'Save password and continue' })
    .click();
  await page.locator('.setup-key').waitFor();
  stage = 'authenticator enrollment';
  const secret = (await page.locator('.setup-key').textContent()).trim();
  assert.match(secret, /^[A-Z2-7]+$/);
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(secret));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign-in verified' }).waitFor();
  assert.equal(new URL(page.url()).origin, origin);
  stage = 'authenticated session and cold workspace resume';
  const session = await page.evaluate(async () => {
    const deadline = Date.now() + 60000;
    while (true) {
      const response = await fetch('/api/auth/session', {
        cache: 'no-store',
        signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
      });
      if (response.ok) return response.json();
      if (![502, 503, 504].includes(response.status) || Date.now() >= deadline)
        throw new Error('Session check failed');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  });
  assert.equal(session.authenticated, true);
  assert.deepEqual(session.memberships, []);
  console.log(
    'Real Cognito invitation password and TOTP enrollment passed on the Quartermaster origin; no membership or estate records created.',
  );
  await page.evaluate(async (csrf) => {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(''),
    );
    const response = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: {
        'x-csrf-token': csrf,
        'x-amz-content-sha256': [...new Uint8Array(digest)]
          .map((n) => n.toString(16).padStart(2, '0'))
          .join(''),
      },
    });
    if (!response.ok) throw new Error('Logout failed');
  }, session.csrfToken);
  // Do not reuse an enrollment code in the subsequent challenge.
  await new Promise((resolve) =>
    setTimeout(resolve, 31000 - (Date.now() % 30000)),
  );
  stage = 'subsequent password and authenticator verification';
  await page.goto(origin + '/sign-in?reauth=1');
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(permanent);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page
    .getByLabel('Authenticator code', { exact: true })
    .fill(totp(secret));
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await page.getByRole('heading', { name: 'Sign-in verified' }).waitFor();
  assert.equal(new URL(page.url()).origin, origin);
  assert.deepEqual(errors, []);
  assert.deepEqual(
    await page.evaluate(() => [localStorage.length, sessionStorage.length]),
    [0, 0],
  );
  console.log(
    'Subsequent real Cognito password/TOTP sign-in and same-origin reauthentication passed; browser persistent token storage remains empty.',
  );
} catch {
  // Playwright error call logs can include fill() values. Never print those.
  throw new Error(
    `Live auth acceptance failed during ${stage}; inspect redacted API logs if needed.`,
  );
} finally {
  const cleanupFailures = [];
  try {
    await browser?.close();
  } catch {
    cleanupFailures.push('browser');
  }
  if (created) {
    assert.match(email, /^qm-auth-check-[0-9a-f-]+@example\.invalid$/);
    try {
      aws(['cognito-idp', 'admin-delete-user'], {
        UserPoolId: pool,
        Username: email,
      });
    } catch {
      cleanupFailures.push(`test identity ${email}`);
    }
  }
  for (const pk of authKeys) {
    try {
      aws(['dynamodb', 'delete-item'], {
        TableName: 'quartermaster-dev-sessions',
        Key: { pk: { S: pk }, sk: { S: 'AUTH' } },
      });
    } catch {
      cleanupFailures.push(`auth row ${pk}`);
    }
  }
  if (cleanupFailures.length)
    throw new Error('Cleanup still required: ' + cleanupFailures.join(', '));
  if (created) {
    console.log(
      'Deleted the probe-only identity and challenge/session rows. Existing users and workspaces were not modified.',
    );
  }
}
