import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { AssetInput } from '@quartermaster/contracts';
import type {
  Asset,
  AssetPage,
  Draft,
  EstateSummary,
  Maintenance,
  Membership,
  Reading,
  SessionInfo,
} from '@quartermaster/contracts';
import { api, ApiError, messageFor } from './api';

const labels = {
  in_service: 'In service',
  needs_attention: 'Needs attention',
  out_of_service: 'Out of service',
};
const empty: AssetInput = {
  name: '',
  assetClass: 'air_conditioner',
  status: 'in_service',
  location: '',
  manufacturer: null,
  model: null,
  serialNumber: null,
  notes: '',
};
function initialInput(asset: Asset | null, draft: Draft | null): AssetInput {
  const source = asset ?? draft?.content;
  return {
    name: source?.name ?? empty.name,
    assetClass: source?.assetClass ?? empty.assetClass,
    status: source?.status ?? empty.status,
    location: source?.location ?? empty.location,
    manufacturer: source?.manufacturer ?? null,
    model: source?.model ?? null,
    serialNumber: source?.serialNumber ?? null,
    notes: source?.notes ?? '',
  };
}
type Page<T> = { items: T[]; nextCursor: string | null };
type Save = (
  route: string,
  method: string,
  body: unknown,
  version?: number,
) => Promise<unknown>;

// Keys survive a failed/uncertain save only in this mounted component. There is
// deliberately no localStorage, IndexedDB, offline queue or background retry.
function useSave(base: string, csrf: string, after: () => void) {
  const key = useRef<{ fingerprint: string; id: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState('');
  const inFlight = useRef(false);
  const uncertain = useRef(false);
  const save: Save = async (route, method, body, version) => {
    if (inFlight.current) throw new Error('Save already in progress');
    const fingerprint = JSON.stringify([base, route, method, body, version]);
    if (uncertain.current && key.current?.fingerprint !== fingerprint) {
      setError(
        'The previous save has not been confirmed. Restore its original input and retry it before starting a different save in this editor.',
      );
      throw new Error('Previous save outcome unknown');
    }
    if (key.current?.fingerprint !== fingerprint)
      key.current = { fingerprint, id: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const result = await api(base + route, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': csrf,
          'idempotency-key': key.current.id,
          ...(version ? { 'if-match': `"${version}"` } : {}),
        },
        body: JSON.stringify(body),
      });
      key.current = null;
      uncertain.current = false;
      setSuccess('Saved on the server.');
      after();
      return result;
    } catch (error) {
      uncertain.current =
        !(error instanceof ApiError) || [502, 503, 504].includes(error.status);
      setError(messageFor(error));
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { save, busy, error, success };
}
function Feedback({
  busy,
  error,
  success,
}: {
  busy: boolean;
  error: string;
  success: string;
}) {
  return (
    <>
      {busy && (
        <p role="status">
          Saving… Waiting for server confirmation (up to a minute after idling).
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {success && <p role="status">{success}</p>}
    </>
  );
}
export function Workspace({ session: initial }: { session: SessionInfo }) {
  const [session, setSession] = useState(initial),
    [tenantId, setTenantId] = useState(
      initial.memberships?.[0]?.tenantId ?? '',
    );
  const [error, setError] = useState('');
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  const membership = session.memberships?.find(
    (item) => item.tenantId === tenantId,
  );
  async function refreshSession() {
    try {
      const next = await api<SessionInfo>('/api/auth/session');
      if (!next.authenticated) throw new Error('Not signed in');
      setSession(next);
      setError('');
    } catch (error) {
      setError(messageFor(error));
    }
  }
  async function logout() {
    if (
      !window.confirm(
        'Sign out? Any input not saved on the server will be lost.',
      )
    )
      return;
    try {
      await api('/api/auth/logout', {
        method: 'POST',
        headers: { 'x-csrf-token': session.csrfToken! },
      });
      window.location.assign('/');
    } catch (error) {
      setError(messageFor(error));
    }
  }
  return (
    <div className="app-layout operational">
      <aside className="sidebar" aria-label="Workspace">
        <a className="brand" href="#main">
          <span className="brand-mark">Q</span> Quartermaster
        </a>
        <p>Development workspace</p>
        <label>
          Organization
          <select
            aria-label="Organization"
            value={tenantId}
            onChange={(e) => {
              if (
                window.confirm('Switch workspaces? Unsaved input will be lost.')
              )
                setTenantId(e.target.value);
            }}
          >
            {session.memberships?.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <p>Online only. Save before leaving this tab.</p>
        <button onClick={() => void refreshSession()}>Refresh session</button>
        <a href="/api/auth/login" target="_blank" rel="noopener noreferrer">
          Sign in again in a new tab
        </a>
        <button onClick={() => void logout()}>Sign out</button>
        <p>
          Sessions last up to one hour. Refresh this tab’s session after signing
          in again.
        </p>
      </aside>
      <main id="main">
        <div className="notice" role="note">
          Synthetic records only. No real church data yet. Photo/voice capture
          and deletion remain disabled.
        </div>
        {!online && (
          <p role="alert" className="error">
            You are offline. Nothing will be queued or saved until you reconnect
            and explicitly retry. Keep this tab open to preserve unsaved input.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {membership ? (
          <Register
            key={`${session.actorId}:${tenantId}`}
            membership={membership}
            csrf={session.csrfToken!}
          />
        ) : (
          <>
            <h1>No workspace access</h1>
            <p>
              Ask the operator to provision your membership, then refresh your
              session.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
function Register({
  membership,
  csrf,
}: {
  membership: Membership;
  csrf: string;
}) {
  const base = `/api/v1/tenants/${membership.tenantId}/`;
  const [assets, setAssets] = useState<Asset[]>([]),
    [next, setNext] = useState<string | null>(null),
    [summary, setSummary] = useState<EstateSummary>();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [search, setSearch] = useState({ q: '', status: '' });
  const [selected, setSelected] = useState<Asset | null>(null),
    [creating, setCreating] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null);
  const [drafts, setDrafts] = useState<Page<Draft>>({
      items: [],
      nextCursor: null,
    }),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const changed = useCallback(() => setRevision((value) => value + 1), []);
  const canWrite = membership.capabilities.includes('assets:write');
  const [audit, setAudit] =
    useState<
      Page<{ id: string; action: string; occurredAt: string; entityId: string }>
    >();
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    Promise.all([
      api<AssetPage>(base + 'assets?' + new URLSearchParams(search), {
        signal: controller.signal,
      }),
      api<EstateSummary>(base + 'summary', { signal: controller.signal }),
      canWrite
        ? api<Page<Draft>>(base + 'drafts', { signal: controller.signal })
        : Promise.resolve({ items: [], nextCursor: null }),
    ])
      .then(([page, totals, drafts]) => {
        setAssets(page.items);
        setNext(page.nextCursor);
        setSummary(totals);
        setDrafts(drafts);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(messageFor(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [base, search, revision, canWrite]);
  async function more(
    kind: 'assets' | 'drafts' | 'audit',
    cursor: string | null,
  ) {
    if (!cursor) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ ...search, cursor });
      if (kind === 'assets') {
        const page = await api<AssetPage>(base + kind + '?' + params);
        setAssets((old) => [...old, ...page.items]);
        setNext(page.nextCursor);
      }
      if (kind === 'drafts') {
        const page = await api<Page<Draft>>(base + kind + '?' + params);
        setDrafts((old) => ({
          items: [...old.items, ...page.items],
          nextCursor: page.nextCursor,
        }));
      }
      if (kind === 'audit') {
        const page = await api<NonNullable<typeof audit>>(
          base + kind + '?' + params,
        );
        setAudit((old) => ({
          items: [...(old?.items ?? []), ...page.items],
          nextCursor: page.nextCursor,
        }));
      }
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(false);
    }
  }
  const close = () => {
    setCreating(false);
    setSelected(null);
    setDraft(null);
    changed();
  };
  return (
    <>
      <header>
        <div>
          <p className="eyebrow">{membership.name}</p>
          <h1>Your asset estate</h1>
          <p className="subtitle">
            Equipment, observations, and the work ahead.
          </p>
        </div>
        {canWrite && (
          <button
            className="primary"
            onClick={() => {
              if (
                (creating || selected || draft) &&
                !window.confirm('Open a new asset? Unsaved input will be lost.')
              )
                return;
              setSelected(null);
              setDraft(null);
              setCreating(true);
            }}
          >
            Add asset
          </button>
        )}
      </header>
      <section className="summary-grid" aria-label="Estate summary">
        <article>
          <span>Assets recorded</span>
          <strong>{summary?.assets ?? '—'}</strong>
        </article>
        <article>
          <span>Needs attention</span>
          <strong>{summary?.needsAttention ?? '—'}</strong>
        </article>
        <article>
          <span>Open maintenance</span>
          <strong>{summary?.openTasks ?? '—'}</strong>
          <small>{summary?.overdueTasks ?? '—'} overdue (UTC dates)</small>
        </article>
      </section>
      {(creating || selected || draft) && (
        <section className="editor-panel" aria-label="Asset workspace">
          <button
            onClick={() => {
              if (
                window.confirm('Close this editor? Unsaved input will be lost.')
              )
                close();
            }}
          >
            Close editor
          </button>
          <AssetEditor
            key={draft?.id ?? selected?.id ?? 'new'}
            base={base}
            csrf={csrf}
            asset={selected}
            draft={draft}
            readOnly={!canWrite}
            after={close}
          />
          {selected && (
            <Observations
              key={selected.id}
              asset={selected}
              base={base}
              csrf={csrf}
              capabilities={membership.capabilities}
              after={changed}
            />
          )}
        </section>
      )}
      <section className="estate-panel" aria-label="Asset register">
        <form
          className="register-heading"
          onSubmit={(e) => {
            e.preventDefault();
            setSearch({ q: query, status: filter });
          }}
        >
          <label className="search">
            Search assets
            <input
              type="search"
              maxLength={160}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, location, model, serial, notes…"
            />
          </label>
          <label>
            Status
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All statuses</option>
              {Object.entries(labels).map(([key, label]) => (
                <option value={key} key={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy}>
            Search
          </button>
        </form>
        {error && (
          <p role="alert" className="empty error">
            {error} <button onClick={changed}>Retry loading</button>
          </p>
        )}
        {busy && (
          <p role="status" className="empty">
            Loading… The database may take up to a minute to wake.
          </p>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset / Location</th>
                <th>Status</th>
                <th>Model / Serial</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id}>
                  <td>
                    <button
                      className="asset-button"
                      onClick={() => {
                        if (
                          (creating || selected || draft) &&
                          !window.confirm(
                            'Open another asset? Unsaved input will be lost.',
                          )
                        )
                          return;
                        setCreating(false);
                        setDraft(null);
                        setSelected(asset);
                      }}
                    >
                      {asset.name}
                    </button>
                    <span className="asset-location">{asset.location}</span>
                  </td>
                  <td>
                    <span className={`badge ${asset.status}`}>
                      {labels[asset.status]}
                    </span>
                  </td>
                  <td>
                    {asset.model ?? '—'} / {asset.serialNumber ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!busy && !assets.length && (
          <p className="empty">
            No matching assets. {canWrite ? 'Add an asset to get started.' : ''}
          </p>
        )}
        {next && (
          <button disabled={busy} onClick={() => void more('assets', next)}>
            Load more assets
          </button>
        )}
      </section>
      {canWrite && (
        <section className="editor-panel" aria-label="Saved drafts">
          <h2>Your server-saved drafts</h2>
          <p>
            Only you can see these drafts. They survive signing out; unsaved
            edits in this tab do not.
          </p>
          {drafts.items.map((item) => (
            <p key={item.id}>
              <button
                onClick={() => {
                  if (
                    (creating || selected || draft) &&
                    !window.confirm(
                      'Open this draft? Unsaved input will be lost.',
                    )
                  )
                    return;
                  setSelected(null);
                  setCreating(false);
                  setDraft(item);
                }}
              >
                {item.content.name || 'Untitled draft'}
              </button>{' '}
              · {new Date(item.updatedAt).toLocaleString()}
            </p>
          ))}
          {drafts.nextCursor && (
            <button
              disabled={busy}
              onClick={() => void more('drafts', drafts.nextCursor)}
            >
              Load more drafts
            </button>
          )}
        </section>
      )}
      {membership.capabilities.includes('audit:read') && (
        <section className="editor-panel">
          <button
            onClick={() => {
              void api<NonNullable<typeof audit>>(base + 'audit')
                .then(setAudit)
                .catch((error: unknown) => setError(messageFor(error)));
            }}
          >
            View audit history
          </button>
          {audit && (
            <>
              <h2>Content-free audit history</h2>
              <p>
                Action, timestamp and record IDs only. Retained for one year.
              </p>
              <ul>
                {audit.items.map((event) => (
                  <li key={event.id}>
                    {event.action} ·{' '}
                    {new Date(event.occurredAt).toLocaleString()} ·{' '}
                    <code>{event.entityId}</code>
                  </li>
                ))}
              </ul>
              {audit.nextCursor && (
                <button
                  disabled={busy}
                  onClick={() => void more('audit', audit.nextCursor)}
                >
                  Load more audit events
                </button>
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
function AssetEditor({
  base,
  csrf,
  asset,
  draft,
  readOnly,
  after,
}: {
  base: string;
  csrf: string;
  asset: Asset | null;
  draft: Draft | null;
  readOnly: boolean;
  after: () => void;
}) {
  const [input, setInput] = useState<AssetInput>(() =>
    initialInput(asset, draft),
  );
  const [dirty, setDirty] = useState(false),
    [savedDraft, setSavedDraft] = useState(draft);
  const mutation = useSave(base, csrf, () => {});
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (key: keyof AssetInput, value: string) => {
    setDirty(true);
    setInput((old) => ({
      ...old,
      [key]: ['manufacturer', 'model', 'serialNumber'].includes(key)
        ? value || null
        : value,
    }));
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      if (savedDraft) {
        if (dirty) return;
        await mutation.save(
          `drafts/${savedDraft.id}/commit`,
          'POST',
          {},
          savedDraft.version,
        );
      } else
        await mutation.save(
          asset ? `assets/${asset.id}` : 'assets',
          asset ? 'PATCH' : 'POST',
          input,
          asset?.version,
        );
      setDirty(false);
      after();
    } catch {
      /* Feedback keeps the form and retry key in this tab. */
    }
  }
  async function saveDraft() {
    const content = { ...input } as Partial<AssetInput>;
    if (!content.name?.trim()) delete content.name;
    if (!content.location?.trim()) delete content.location;
    try {
      const saved = (await mutation.save(
        savedDraft ? `drafts/${savedDraft.id}` : 'drafts',
        savedDraft ? 'PATCH' : 'POST',
        content,
        savedDraft?.version,
      )) as { item: Draft };
      setSavedDraft(saved.item);
      setDirty(false);
    } catch {
      /* Keep input. */
    }
  }
  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2>
        {asset ? 'Asset details' : savedDraft ? 'Resume draft' : 'Add an asset'}
      </h2>
      <p>
        {dirty
          ? 'Unsaved input — held only in this tab.'
          : asset
            ? `Version ${asset.version}`
            : savedDraft
              ? 'Draft saved on the server.'
              : 'Fill in what you know. Save a draft if you need to come back.'}
      </p>
      <fieldset disabled={readOnly || mutation.busy} className="form-grid">
        <legend className="sr-only">Asset information</legend>
        <label>
          Name
          <input
            required
            maxLength={160}
            value={input.name}
            onChange={(e) => change('name', e.target.value)}
          />
        </label>
        <label>
          Class
          <select
            value={input.assetClass}
            onChange={(e) => change('assetClass', e.target.value)}
          >
            <option value="air_conditioner">Air conditioner</option>
            <option value="appliance">Appliance</option>
          </select>
        </label>
        <label>
          Location
          <input
            required
            maxLength={240}
            value={input.location}
            onChange={(e) => change('location', e.target.value)}
            placeholder="Main building / roof / northwest corner"
          />
        </label>
        <label>
          Asset status
          <select
            value={input.status}
            onChange={(e) => change('status', e.target.value)}
          >
            {Object.entries(labels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {(['manufacturer', 'model', 'serialNumber'] as const).map((key) => (
          <label key={key}>
            {key === 'serialNumber'
              ? 'Serial number'
              : key === 'model'
                ? 'Model'
                : 'Manufacturer'}
            <input
              maxLength={120}
              value={input[key] ?? ''}
              onChange={(e) => change(key, e.target.value)}
            />
          </label>
        ))}
        <label className="wide">
          Field notes
          <textarea
            maxLength={4000}
            value={input.notes}
            onChange={(e) => change('notes', e.target.value)}
            placeholder="Access constraints, weathering, observations…"
          />
        </label>
        {!readOnly && (
          <div className="actions wide">
            <button
              className="primary"
              type="submit"
              disabled={Boolean(savedDraft && dirty)}
            >
              {savedDraft
                ? 'Create asset from draft'
                : asset
                  ? 'Save asset'
                  : 'Create asset'}
            </button>
            {!asset && (
              <button type="button" onClick={() => void saveDraft()}>
                Save draft
              </button>
            )}
            {savedDraft && dirty && (
              <p>Save your draft changes before creating the asset.</p>
            )}
          </div>
        )}
      </fieldset>
      <Feedback {...mutation} />
      {asset && mutation.error && (
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                'Discard these edits and reload the current record?',
              )
            )
              after();
          }}
        >
          Close and reload register
        </button>
      )}
    </form>
  );
}
function Observations({
  base,
  csrf,
  asset,
  capabilities,
  after,
}: {
  base: string;
  csrf: string;
  asset: Asset;
  capabilities: Membership['capabilities'];
  after: () => void;
}) {
  const [tasks, setTasks] = useState<Page<Maintenance>>({
      items: [],
      nextCursor: null,
    }),
    [readings, setReadings] = useState<Page<Reading>>({
      items: [],
      nextCursor: null,
    }),
    [revision, setRevision] = useState(0),
    [error, setError] = useState('');
  const changed = () => {
    setRevision((n) => n + 1);
    after();
  };
  const mutation = useSave(base, csrf, changed);
  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<Page<Maintenance>>(base + `assets/${asset.id}/maintenance`, {
        signal: controller.signal,
      }),
      api<Page<Reading>>(base + `assets/${asset.id}/readings`, {
        signal: controller.signal,
      }),
    ])
      .then(([tasks, readings]) => {
        setTasks(tasks);
        setReadings(readings);
        setError('');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(messageFor(error));
      });
    return () => controller.abort();
  }, [base, asset.id, revision]);
  async function more(kind: 'maintenance' | 'readings', cursor: string) {
    try {
      if (kind === 'maintenance') {
        const page = await api<Page<Maintenance>>(
          base + `assets/${asset.id}/${kind}?cursor=${cursor}`,
        );
        setTasks((old) => ({
          items: [...old.items, ...page.items],
          nextCursor: page.nextCursor,
        }));
      } else {
        const page = await api<Page<Reading>>(
          base + `assets/${asset.id}/${kind}?cursor=${cursor}`,
        );
        setReadings((old) => ({
          items: [...old.items, ...page.items],
          nextCursor: page.nextCursor,
        }));
      }
    } catch (error) {
      setError(messageFor(error));
    }
  }
  async function add(
    event: FormEvent<HTMLFormElement>,
    kind: 'maintenance' | 'readings',
  ) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    const input =
      kind === 'maintenance'
        ? {
            title: data.get('title'),
            dueDate: data.get('dueDate') || null,
            status: 'open',
            notes: data.get('notes') ?? '',
          }
        : {
            label: data.get('label'),
            value: Number(data.get('value')),
            unit: data.get('unit'),
            observedAt: new Date(String(data.get('observedAt'))).toISOString(),
            notes: data.get('notes') ?? '',
          };
    try {
      await mutation.save(`assets/${asset.id}/${kind}`, 'POST', input);
      form.reset();
    } catch {
      /* Keep inputs on failure. */
    }
  }
  return (
    <section className="observations" aria-label="Maintenance and readings">
      <h2>Maintenance</h2>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setRevision((n) => n + 1)}>
            Retry details
          </button>
        </p>
      )}
      <ul>
        {tasks.items.map((task) => (
          <li key={task.id}>
            <strong>{task.title}</strong> — {task.status.replaceAll('_', ' ')} ·
            due {task.dueDate ?? 'not set'}
            <p>{task.notes}</p>
            {capabilities.includes('maintenance:write') && (
              <div className="actions">
                {(['open', 'in_progress', 'completed'] as const)
                  .filter((s) => s !== task.status)
                  .map((status) => (
                    <button
                      key={status}
                      disabled={mutation.busy}
                      onClick={() => {
                        void mutation
                          .save(
                            `maintenance/${task.id}`,
                            'PATCH',
                            {
                              title: task.title,
                              dueDate: task.dueDate,
                              status,
                              notes: task.notes,
                            },
                            task.version,
                          )
                          .catch(() => {});
                      }}
                    >
                      Mark {status.replaceAll('_', ' ')}
                    </button>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {tasks.nextCursor && (
        <button onClick={() => void more('maintenance', tasks.nextCursor!)}>
          Load more maintenance
        </button>
      )}
      {capabilities.includes('maintenance:write') && (
        <form onSubmit={(e) => void add(e, 'maintenance')}>
          <fieldset disabled={mutation.busy} className="form-grid">
            <legend>Add maintenance task</legend>
            <label>
              Task
              <input name="title" required maxLength={240} />
            </label>
            <label>
              Due date
              <input type="date" name="dueDate" />
            </label>
            <label className="wide">
              Task notes
              <textarea name="notes" maxLength={4000} />
            </label>
            <button type="submit">Add task</button>
          </fieldset>
        </form>
      )}
      <h2>Human-reported readings</h2>
      <p>
        Record observations only when safe. A software role is not a
        qualification to perform physical work.
      </p>
      <ul>
        {readings.items.map((reading) => (
          <li key={reading.id}>
            <strong>
              {reading.label}: {reading.value} {reading.unit}
            </strong>{' '}
            · {new Date(reading.observedAt).toLocaleString()}
            <p>{reading.notes}</p>
          </li>
        ))}
      </ul>
      {readings.nextCursor && (
        <button onClick={() => void more('readings', readings.nextCursor!)}>
          Load more readings
        </button>
      )}
      {capabilities.includes('assets:write') && (
        <form onSubmit={(e) => void add(e, 'readings')}>
          <fieldset disabled={mutation.busy} className="form-grid">
            <legend>Add a reading</legend>
            <label>
              Measurement
              <input
                name="label"
                required
                maxLength={120}
                placeholder="Compressor current"
              />
            </label>
            <label>
              Value
              <input
                type="number"
                name="value"
                required
                step="any"
                min={-1e12}
                max={1e12}
              />
            </label>
            <label>
              Unit
              <input name="unit" required maxLength={40} placeholder="A" />
            </label>
            <label>
              Observed at (local time)
              <input type="datetime-local" name="observedAt" required />
            </label>
            <label className="wide">
              Reading notes
              <textarea name="notes" maxLength={2000} />
            </label>
            <button type="submit">Add reading</button>
          </fieldset>
        </form>
      )}
      <Feedback {...mutation} />
    </section>
  );
}
