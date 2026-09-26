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
      pilot_not_enabled: 'Real-data workspaces are not enabled yet.',
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
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(path, {
        ...init,
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
