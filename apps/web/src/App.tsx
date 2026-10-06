import { useEffect, useState } from 'react';
import type { SessionInfo } from '@quartermaster/contracts';
import { Workspace } from './Workspace';
import { api, messageFor } from './api';

export function App() {
  const [session, setSession] = useState<SessionInfo>();
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    api<SessionInfo>('/api/auth/session', { signal: controller.signal })
      .then(setSession)
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setError(messageFor(e));
      });
    return () => controller.abort();
  }, []);
  if (session?.authenticated) return <Workspace session={session} />;
  return (
    <main className="welcome">
      <p className="eyebrow">QUARTERMASTER</p>
      <h1>A clearer picture of your estate.</h1>
      <p>
        Capture equipment by voice, photograph nameplates, plan maintenance, and
        understand what you own.
      </p>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button onClick={() => window.location.reload()}>Try again</button>
        </p>
      ) : !session ? (
        <p role="status">Connecting to Quartermaster…</p>
      ) : (
        <>
          <p>
            Sign in to your organization’s private workspace. Access is
            invitation-only.
          </p>
          <a className="primary action" href="/api/auth/login">
            Sign in
          </a>
          <p>
            First visit? Use the temporary password from your invitation and
            enroll an authenticator app.
          </p>
        </>
      )}
      <p className="notice">
        Online connection required. Camera and microphone access starts only
        when you choose to capture. You control the records you create.
      </p>
      <details>
        <summary>Privacy and data retention</summary>
        <p>
          Quartermaster is operated by Erick Brown. Original photos and
          conversation transcripts are kept for 15 days. Resized asset photos
          stay until you delete them or their asset/workspace. Audit records are
          kept for one year. Deleted live content is purged; inaccessible backup
          copies expire within 90 days, and restores replay the deletion ledger
          before access is restored. Minimal deletion metadata follows that
          90-day horizon.
        </p>
        <p>
          AI processing uses approved AWS US regions. AI suggestions require
          review; you remain responsible for safe physical work. Short voice
          recordings are processed in memory, not stored. Contact the operator
          through your organization for access and privacy requests.
        </p>
      </details>
    </main>
  );
}
