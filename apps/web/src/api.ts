export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function messageFor(error: unknown): string {
  if (error instanceof ApiError) {
    const messages: Record<string, string> = {
      sign_in_required:
        'Your session expired. Sign in in another tab, then retry here to keep your unsaved input.',
      csrf_failed:
        'Your sign-in changed. Refresh the session in this tab, then retry.',
      version_conflict:
        'This record changed in another session. Reload it and review the newer version before saving.',
      capability_required: 'Your membership does not allow this action.',
      membership_required: 'You no longer have access to this workspace.',
      invalid_fields: 'Please check the field values and required fields.',
      recent_sign_in_required:
        'For this action, verify your sign-in using the sidebar link, then retry.',
      last_administrator: 'Keep at least one active workspace administrator.',
      daily_usage_limit:
        'The daily development allowance has been reached. Try again tomorrow or continue with manual entry.',
      capture_context_limit:
        'This capture has more context than the bounded AI request allows. Save the reviewed information manually, or start a shorter capture.',
      upload_mismatch:
        'The stored image does not match the upload you authorized. Please retry with the original file.',
      preview_changed:
        'The rule or matching assets changed. Preview again before approving.',
      operation_in_progress:
        'Another save is in progress. Wait a moment and retry.',
      idempotency_conflict:
        'This save key was already used for different data. Reload the record before continuing.',
    };
    if (messages[error.code]) return messages[error.code]!;
  }
  return 'The server could not confirm this request. Your input is still in this tab. Check your connection and retry; do not assume it was saved.';
}
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!navigator.onLine) throw new Error('Offline; no requests are queued');
  const deadline = AbortSignal.timeout(60000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, deadline])
    : deadline;
  const headers = new Headers(init.headers);
  if (!['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase())) {
    // CloudFront OAC needs the exact payload hash for the private Lambda URL.
    // All BFF payloads are JSON strings; direct S3 uploads use a separate path.
    if (init.body != null && typeof init.body !== 'string')
      throw new Error('API writes require a serialized JSON body');
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(init.body ?? ''),
    );
    headers.set(
      'x-amz-content-sha256',
      Array.from(new Uint8Array(digest), (n) =>
        n.toString(16).padStart(2, '0'),
      ).join(''),
    );
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(path, {
        ...init,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      });
      const value = (await response.json()) as T & { code?: string };
      if (response.ok) return value;
      throw new ApiError(response.status, value.code ?? 'request_failed');
    } catch (error) {
      if (
        signal.aborted ||
        attempt === 2 ||
        (error instanceof ApiError &&
          ![502, 503, 504].includes(error.status)) ||
        !navigator.onLine
      )
        throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new Error('Request cancelled'));
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          (attempt + 1) * 2000,
        );
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
  throw new Error('Request failed');
}
