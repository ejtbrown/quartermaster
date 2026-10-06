import { useEffect, useRef, useState } from 'react';
import { Brand, Icon, InfoDisclosure } from './ui';

type Flow = {
  step:
    | 'credentials'
    | 'new_password'
    | 'totp'
    | 'setup_totp'
    | 'reset_code'
    | 'complete';
  csrfToken?: string;
  secret?: string;
  code?: string;
  notice?: string;
};
const messages: Record<string, string> = {
  login_failed:
    'We could not sign you in. Check your email and password. If this was an authenticator step, start again.',
  incorrect_code:
    'That code did not match. Check your authenticator and try its current six-digit code.',
  password_policy:
    'Use at least 14 characters, including uppercase, lowercase, a number, and a symbol.',
  password_reset_required:
    'Your password needs to be reset. Choose “Forgot password?” to request a recovery code.',
  auth_rate_limited:
    'Too many attempts. Wait a few minutes before trying again.',
  code_expired: 'This code has expired. Start again to request a new one.',
  login_expired:
    'This sign-in attempt expired. Start again; your account is unchanged.',
  login_attempts_exhausted:
    'This sign-in attempt has reached its limit. Wait a few minutes, then start again.',
  invalid_fields:
    'Check the required fields. Verification codes contain six digits.',
  auth_unavailable:
    'Sign-in is temporarily unavailable. Your password has not been saved. Please try again shortly.',
  csrf_failed:
    'This sign-in attempt changed or expired. Start again in this tab.',
};
// Authentication writes are deliberately not automatically retried: Cognito
// challenges are single-use. Passwords/codes stay in the submitted form only.
async function requestFlow(body?: unknown, csrf?: string): Promise<Flow> {
  const payload = body ? JSON.stringify(body) : undefined;
  const headers: Record<string, string> = {};
  if (payload) {
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(payload),
    );
    headers['x-amz-content-sha256'] = Array.from(new Uint8Array(digest), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join('');
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = csrf ?? '';
  }
  const response = await fetch('/api/auth/flow', {
    method: payload ? 'POST' : 'GET',
    headers,
    ...(payload ? { body: payload } : {}),
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(60000),
  });
  const data = (await response.json()) as Flow;
  if (!data.step) throw new Error(data.code ?? 'auth_unavailable');
  return data;
}
export function SignIn() {
  const [flow, setFlow] = useState<Flow>(),
    [email, setEmail] = useState(''),
    [recover, setRecover] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [secret, setSecret] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const reauth =
    new URLSearchParams(window.location.search).get('reauth') === '1';
  async function begin() {
    setBusy(true);
    setError('');
    setSecret('');
    setRecover(false);
    try {
      setFlow(await requestFlow());
    } catch {
      setError(messages.auth_unavailable!);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void begin();
  }, []);
  useEffect(() => {
    heading.current?.focus();
  }, [flow?.step, recover]);
  const step = flow?.step ?? 'credentials';
  const title =
    step === 'complete'
      ? reauth
        ? 'Sign-in verified'
        : 'You’re signed in'
      : step === 'new_password'
        ? 'Make this account yours'
        : step === 'setup_totp'
          ? 'Set up your authenticator'
          : step === 'totp'
            ? 'One more check'
            : step === 'reset_code'
              ? 'Choose a new password'
              : recover
                ? 'Reset your password'
                : reauth
                  ? 'Verify your sign-in'
                  : 'Welcome back';
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !flow?.csrfToken) return;
    const form = event.currentTarget,
      data = new FormData(form);
    const password = String(data.get('password') ?? ''),
      confirmation = data.get('confirmation');
    if (confirmation !== null && password !== confirmation) {
      setError(
        'The passwords do not match. Enter the same password in both fields.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const next = await requestFlow(
        {
          action:
            step === 'credentials'
              ? recover
                ? 'reset_request'
                : 'sign_in'
              : step === 'new_password'
                ? 'new_password'
                : step === 'reset_code'
                  ? 'reset_confirm'
                  : 'totp',
          ...(step === 'credentials' ? { email: email.trim() } : {}),
          ...(password ? { password } : {}),
          ...(data.get('code')
            ? { code: String(data.get('code')).trim() }
            : {}),
        },
        flow.csrfToken,
      );
      setFlow(next);
      if (next.secret) setSecret(next.secret);
      if (next.code)
        setError(messages[next.code] ?? messages.auth_unavailable!);
      if (next.notice === 'password_changed') setRecover(false);
      if (!next.code) form.reset();
      if (next.step === 'complete') {
        setSecret('');
        if (!reauth) window.location.assign('/');
      }
    } catch (e) {
      setError(
        messages[e instanceof Error ? e.message : ''] ??
          messages.auth_unavailable!,
      );
      setFlow(undefined);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <header className="auth-header">
        <Brand />
        <span className="environment-badge">Development</span>
      </header>
      <main className="auth-layout" id="main">
        <section className="auth-story">
          <p className="eyebrow">YOUR ESTATE, UNDERSTOOD</p>
          <h1>
            A clear view.
            <br />A confident next step.
          </h1>
          <p>
            A welcoming workspace for the people who care for buildings,
            equipment, and communities.
          </p>
          <div className="auth-promises">
            <p>
              <Icon name="assets" />
              <span>
                <strong>Know what you own</strong>One place for your assets,
                photos, and observations.
              </span>
            </p>
            <p>
              <Icon name="work" />
              <span>
                <strong>Stay ahead of the work</strong>Make maintenance and
                replacement planning clearer.
              </span>
            </p>
            <p>
              <Icon name="shield" />
              <span>
                <strong>Your workspace stays private</strong>Invitation-only
                access with an authenticator check.
              </span>
            </p>
          </div>
        </section>
        <section className="auth-card" aria-label="Sign in">
          <p className="eyebrow">QUARTERMASTER ACCOUNT</p>
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          {step === 'complete' ? (
            <>
              <p>
                {reauth
                  ? 'Return to your original tab and choose “Refresh session.” Your unsaved work can stay there.'
                  : 'Opening your workspace…'}
              </p>
              <a className="action primary" href="/">
                Open workspace
              </a>
            </>
          ) : (
            <>
              <p className="muted">
                {step === 'credentials'
                  ? recover
                    ? 'We’ll email a recovery code if this address has an eligible account.'
                    : 'Use the email address associated with your invitation.'
                  : step === 'new_password'
                    ? 'Replace the temporary password from your invitation.'
                    : step === 'reset_code'
                      ? 'If your account is eligible, a code has been sent to your email. Enter it below.'
                      : step === 'setup_totp'
                        ? 'Add Quartermaster to your authenticator app using this setup key, then enter its current code.'
                        : 'Enter the current six-digit code from your authenticator app.'}
              </p>
              {flow?.notice === 'password_changed' && (
                <p role="status" className="success-message">
                  Your password was changed. Sign in with your new password.
                </p>
              )}
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              {!flow ? (
                <>
                  {busy ? (
                    <p role="status">Connecting securely…</p>
                  ) : (
                    <button onClick={() => void begin()}>Start again</button>
                  )}
                </>
              ) : (
                <form onSubmit={(e) => void submit(e)}>
                  {step === 'credentials' && (
                    <label>
                      Email address
                      <input
                        type="email"
                        autoComplete="username"
                        name="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        maxLength={254}
                      />
                    </label>
                  )}
                  {step === 'setup_totp' && (
                    <div className="auth-setup">
                      <strong>Authenticator setup key</strong>
                      <code className="setup-key">{secret}</code>
                      <p>
                        Choose “Enter a setup key” in your authenticator, name
                        it Quartermaster, and select time-based codes. Keep this
                        key private.
                      </p>
                      <InfoDisclosure label="Authenticator apps">
                        An authenticator app generates a new code about every 30
                        seconds. Use an app you already trust or your
                        organization recommends. If you lose access, contact the
                        operator; password recovery does not bypass this check.
                      </InfoDisclosure>
                    </div>
                  )}
                  {['totp', 'setup_totp', 'reset_code'].includes(step) && (
                    <label>
                      {step === 'reset_code'
                        ? 'Email recovery code'
                        : 'Authenticator code'}
                      <input
                        name="code"
                        type="text"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        required
                        placeholder="6-digit code"
                      />
                    </label>
                  )}
                  {((step === 'credentials' && !recover) ||
                    ['new_password', 'reset_code'].includes(step)) && (
                    <label>
                      {step === 'credentials' ? 'Password' : 'New password'}
                      <input
                        name="password"
                        type="password"
                        autoComplete={
                          step === 'credentials'
                            ? 'current-password'
                            : 'new-password'
                        }
                        required
                        maxLength={256}
                        minLength={step === 'credentials' ? 1 : 14}
                        aria-describedby={
                          step === 'credentials' ? undefined : 'password-help'
                        }
                      />
                    </label>
                  )}
                  {['new_password', 'reset_code'].includes(step) && (
                    <>
                      <p className="field-hint" id="password-help">
                        At least 14 characters, including uppercase, lowercase,
                        a number, and a symbol. Password managers and pasted
                        passwords are welcome.
                      </p>
                      <label>
                        Confirm new password
                        <input
                          name="confirmation"
                          type="password"
                          autoComplete="new-password"
                          required
                          maxLength={256}
                          minLength={14}
                        />
                      </label>
                    </>
                  )}
                  <button
                    className="primary auth-submit"
                    type="submit"
                    disabled={busy}
                  >
                    {busy
                      ? 'Please wait…'
                      : step === 'credentials'
                        ? recover
                          ? 'Send recovery code'
                          : 'Sign in'
                        : step === 'new_password'
                          ? 'Save password and continue'
                          : step === 'reset_code'
                            ? 'Reset password'
                            : 'Verify code'}
                    {!busy && <Icon name="arrow" />}
                  </button>
                  {busy && (
                    <p role="status" className="field-hint">
                      Confirming securely. Please keep this tab open.
                    </p>
                  )}
                  {step === 'credentials' && (
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy}
                      onClick={() => {
                        setRecover(!recover);
                        setError('');
                      }}
                    >
                      {recover ? 'Back to sign in' : 'Forgot password?'}
                    </button>
                  )}
                  {step !== 'credentials' && (
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy}
                      onClick={() => void begin()}
                    >
                      Start again
                    </button>
                  )}
                </form>
              )}
              <div className="auth-footnote">
                <Icon name="shield" />
                <span>
                  Cognito verifies your account. You stay on Quartermaster
                  throughout sign-in. No account? Ask your organization for an
                  invitation.
                </span>
              </div>
            </>
          )}
        </section>
      </main>
      <footer className="auth-footer">
        Online when you need it. Private by design.{' '}
        <a href="/#privacy">Privacy and data retention</a>
      </footer>
    </div>
  );
}
