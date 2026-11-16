import { confirmAction } from './ConfirmDialog';
import {
  EstateNavigation,
  allowLeaving,
  destination,
  useNavigation,
} from './navigation';
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
import { EstateTools } from './EstateTools';
import { AssetExtras } from './AssetExtras';
import { PhotoGallery } from './PhotoGallery';
import { AssetDetailsEditor, AssetClassSelect } from './AssetDetailsEditor';
import { RecordSelect, title } from './estate-ui';
import { Brand, EmptyState, Icon, InfoDisclosure } from './ui';

const labels = {
  in_service: 'In service',
  needs_attention: 'Needs attention',
  out_of_service: 'Out of service',
  retired: 'Retired',
  disposed: 'Disposed',
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
    details: source?.details ?? {},
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
export function useSave(base: string, csrf: string, after: () => void) {
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
    const scope = document.activeElement?.closest('form,[data-editing-scope]');
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
      scope?.removeAttribute('data-dirty');
      scope?.removeAttribute('data-uncertain-save');
      after();
      return result;
    } catch (error) {
      uncertain.current =
        !(error instanceof ApiError) || [502, 503, 504].includes(error.status);
      if (uncertain.current) scope?.setAttribute('data-uncertain-save', 'true');
      setError(messageFor(error));
      throw error;
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { save, busy, error, success };
}
export function Feedback({
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
        <p role="status" className="loading-message">
          Saving… Waiting for server confirmation (up to a minute after idling).
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="success-message">
          <Icon name="check" />
          {success}
        </p>
      )}
    </>
  );
}
export function Workspace({ session: initial }: { session: SessionInfo }) {
  const [session, setSession] = useState(initial),
    [tenantId, setTenantId] = useState(
      initial.memberships?.[0]?.tenantId ?? '',
    );
  const [error, setError] = useState('');
  const [navigationTarget, setNavigationTarget] = useState<HTMLElement | null>(
    null,
  );
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let fullHeight = viewport.height;
    const resize = () => {
      if (viewport.height > fullHeight) fullHeight = viewport.height;
      document.body.classList.toggle(
        'keyboard-open',
        viewport.height < fullHeight * 0.75,
      );
    };
    const orient = () => {
      fullHeight = viewport.height;
      resize();
    };
    viewport.addEventListener('resize', resize);
    window.addEventListener('orientationchange', orient);
    return () => {
      viewport.removeEventListener('resize', resize);
      window.removeEventListener('orientationchange', orient);
      document.body.classList.remove('keyboard-open');
    };
  }, []);
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
      if (next.actorId !== session.actorId)
        window.history.replaceState(null, '', '#assets');
      setSession(next);
      setError('');
    } catch (error) {
      setError(messageFor(error));
    }
  }
  async function logout() {
    if (
      !(await confirmAction(
        'Sign out? Any input not saved on the server will be lost.',
      ))
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
    <div
      className="app-layout operational"
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest('main')) return;
        // Native keyboard focus can leave a partly visible textarea beneath
        // the fixed mobile navigation. Respect the browser's first scroll,
        // then reveal the entire focused control if it is still occluded.
        requestAnimationFrame(() => {
          if (document.activeElement !== target) return;
          const navigation =
            document.querySelector<HTMLElement>('.mobile-bottom-nav');
          if (!navigation || !navigation.getClientRects().length) return;
          const control = target.getBoundingClientRect();
          const boundary = navigation.getBoundingClientRect();
          if (control.bottom > boundary.top || control.top < 0)
            target.scrollIntoView({ block: 'center', behavior: 'auto' });
        });
      }}
      onChangeCapture={(event) => {
        const target = event.target as HTMLElement;
        target
          .closest(
            'form:not(.register-heading):not([data-managed-dirty]),[data-editing-scope]',
          )
          ?.setAttribute('data-dirty', 'true');
      }}
    >
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to main content
      </a>
      <aside className="sidebar" aria-label="Workspace">
        <Brand />
        <label className="workspace-picker">
          Organization
          <select
            aria-label="Organization"
            value={tenantId}
            onChange={async (e) => {
              const nextTenant = e.target.value;
              if (
                await allowLeaving(
                  'Switch workspaces? Unsaved input will be lost.',
                )
              ) {
                window.history.replaceState(null, '', '#assets');
                setTenantId(nextTenant);
              }
            }}
          >
            {session.memberships?.map((m) => (
              <option key={m.tenantId} value={m.tenantId}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <div className="navigation-slot" ref={setNavigationTarget} />
        <details className="session-tools">
          <summary>
            <Icon name="shield" />
            Account &amp; session
          </summary>
          <p>Online only. Save before leaving this tab.</p>
          <button onClick={() => void refreshSession()}>Refresh session</button>
          <a
            className="action quiet"
            href="/sign-in?reauth=1"
            target="_blank"
            rel="noopener noreferrer"
          >
            Sign in again in a new tab
          </a>
          <button onClick={() => void logout()}>Sign out</button>
          <p>
            Sessions last up to one hour. Refresh this tab’s session after
            signing in again.
          </p>
        </details>
        <span className="environment-badge">Development workspace</span>
      </aside>
      <main id="main" tabIndex={-1}>
        {!online && (
          <p role="alert" className="error">
            You are offline. Nothing will be queued or saved until you reconnect
            and explicitly retry. Keep this tab open to preserve unsaved input.
          </p>
        )}
        {error && <p role="alert">{error}</p>}
        {membership ? (
          <EstateNavigation
            key={`${session.actorId}:${tenantId}`}
            membership={membership}
          >
            <EstateTools
              membership={membership}
              csrf={session.csrfToken!}
              actorId={session.actorId!}
              navigationTarget={navigationTarget}
            >
              <Register membership={membership} csrf={session.csrfToken!} />
            </EstateTools>
          </EstateNavigation>
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
  const { route, go } = useNavigation();
  const assetUrl = (values: Record<string, string> = {}) =>
    destination('Assets', { ...Object.fromEntries(route.params), ...values });
  const base = `/api/v1/tenants/${membership.tenantId}/`;
  const [summaryError, setSummaryError] = useState(''),
    [draftError, setDraftError] = useState(''),
    [detailError, setDetailError] = useState(''),
    [detailBusy, setDetailBusy] = useState(false),
    [notice, setNotice] = useState('');
  const [assets, setAssets] = useState<Asset[]>([]),
    [next, setNext] = useState<string | null>(null),
    [summary, setSummary] = useState<EstateSummary>();
  const [query, setQuery] = useState(''),
    [filter, setFilter] = useState(''),
    [classFilter, setClassFilter] = useState(''),
    [locationFilter, setLocationFilter] = useState(''),
    [view, setView] = useState(''),
    [search, setSearch] = useState({
      q: '',
      status: '',
      assetClass: '',
      locationId: '',
    });
  const [selected, setSelected] = useState<Asset | null>(null),
    [creating, setCreating] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null);
  const [detailTab, setDetailTab] = useState('Overview');
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
  const loadedCount = useRef(0),
    previousSearch = useRef('');
  loadedCount.current = assets.length;
  useEffect(() => {
    const controller = new AbortController();
    const searchKey = JSON.stringify(search);
    const desired =
      previousSearch.current === searchKey ? loadedCount.current : 0;
    previousSearch.current = searchKey;
    if (!desired) {
      setAssets([]);
      setNext(null);
    }
    setBusy(true);
    setError('');
    void (async () => {
      const items: Asset[] = [];
      let cursor: string | null = null;
      do {
        const page: AssetPage = await api(
          base +
            'assets?' +
            new URLSearchParams({ ...search, ...(cursor ? { cursor } : {}) }),
          { signal: controller.signal },
        );
        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && items.length < desired && !controller.signal.aborted);
      return { items, nextCursor: cursor };
    })()
      .then((page) => {
        if (!controller.signal.aborted) {
          setAssets(page.items);
          setNext(page.nextCursor);
        }
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setError(messageFor(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [base, search, revision, canWrite]);
  useEffect(() => {
    const controller = new AbortController();
    setSummaryError('');
    setDraftError('');
    void api<EstateSummary>(base + 'summary', { signal: controller.signal })
      .then(setSummary)
      .catch((e) => {
        if (!controller.signal.aborted) setSummaryError(messageFor(e));
      });
    if (canWrite)
      void api<Page<Draft>>(base + 'drafts', { signal: controller.signal })
        .then(setDrafts)
        .catch((e) => {
          if (!controller.signal.aborted) setDraftError(messageFor(e));
        });
    return () => controller.abort();
  }, [base, revision, canWrite]);
  const routeKey = route.params.toString();
  useEffect(() => {
    if (route.section !== 'Assets') {
      setSelected(null);
      setCreating(false);
      setDraft(null);
      return;
    }
    const nextSearch = {
      q: route.params.get('q') ?? '',
      status: route.params.get('status') ?? '',
      assetClass: route.params.get('assetClass') ?? '',
      locationId: route.params.get('locationId') ?? '',
    };
    setQuery(nextSearch.q);
    setFilter(nextSearch.status);
    setClassFilter(nextSearch.assetClass);
    setLocationFilter(nextSearch.locationId);
    setSearch((old) =>
      JSON.stringify(old) === JSON.stringify(nextSearch) ? old : nextSearch,
    );
    const detail = route.params.get('detail') ?? 'Overview';
    setCreating(route.params.get('asset') === 'new' && canWrite);
    setDetailTab(
      ['Overview', 'Photos', 'Maintenance', 'Related records'].includes(detail)
        ? detail
        : 'Overview',
    );
  }, [route.section, routeKey]);
  const selectedId =
    route.section === 'Assets' && route.params.get('asset') !== 'new'
      ? route.params.get('asset')
      : null;
  useEffect(() => {
    setDetailError('');
    if (!selectedId) {
      setSelected(null);
      setDetailBusy(false);
      return;
    }
    const controller = new AbortController();
    setCreating(false);
    setDraft(null);
    setSelected(null);
    setNotice('');
    setDetailBusy(true);
    void api<Asset>(base + 'assets/' + encodeURIComponent(selectedId), {
      signal: controller.signal,
    })
      .then(setSelected)
      .catch((e) => {
        if (!controller.signal.aborted) setDetailError(messageFor(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailBusy(false);
      });
    return () => controller.abort();
  }, [base, selectedId]);
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
    void go(assetUrl({ asset: '', detail: '' }), {
      discard: false,
      replace: true,
    });
    setCreating(false);
    setSelected(null);
    setDraft(null);
    if (draft)
      requestAnimationFrame(() =>
        document
          .getElementById('draft-' + draft.id)
          ?.focus({ preventScroll: true }),
      );
  };
  const cancel = async () => {
    if (await allowLeaving('Close this editor? Unsaved input will be lost.'))
      close();
  };
  return (
    <div
      className={`register-view ${creating || selectedId || draft ? 'has-editor' : ''}`}
    >
      <header>
        <div>
          <p className="eyebrow">{membership.name}</p>
          <h1>Your asset estate</h1>
          <p
            className={`subtitle ${notice ? 'register-confirmation' : ''}`}
            role={notice ? 'status' : undefined}
          >
            {notice || 'Equipment, observations, and the work ahead.'}
          </p>
        </div>
        {canWrite && (
          <button
            className="primary"
            id="add-asset"
            onClick={async () => {
              if (
                !(await allowLeaving(
                  'Open a new asset? Unsaved input will be lost.',
                ))
              )
                return;
              await go(assetUrl({ asset: 'new', detail: '' }), {
                discard: false,
              });
              setNotice('');
              setSelected(null);
              setDraft(null);
              setCreating(true);
            }}
          >
            <Icon name="plus" /> Add asset
          </button>
        )}
      </header>
      {!canWrite && (
        <p className="notice">
          You have read-only access to assets in this workspace.
        </p>
      )}
      {summaryError && (
        <p role="alert">
          Estate summary unavailable: {summaryError}{' '}
          <button onClick={changed}>Retry summary</button>
        </p>
      )}
      <section className="summary-grid" aria-label="Estate summary">
        <article>
          <span>Assets recorded</span>
          <strong>{summary?.assets ?? '—'}</strong>
        </article>
        <article>
          <span className="label-text">
            Needs attention{' '}
            <InfoDisclosure label="Needs attention">
              Assets explicitly marked as needing attention. Open or overdue
              maintenance is counted separately.
            </InfoDisclosure>
          </span>
          <a
            href={assetUrl({
              status: 'needs_attention',
              q: '',
              assetClass: '',
              locationId: '',
              asset: '',
              detail: '',
            })}
            onClick={(e) => {
              e.preventDefault();
              void go(
                assetUrl({
                  status: 'needs_attention',
                  q: '',
                  assetClass: '',
                  locationId: '',
                  asset: '',
                  detail: '',
                }),
              );
            }}
            aria-label="View assets needing attention"
          >
            {summary?.needsAttention ?? '—'}
          </a>
        </article>
        <article>
          <span className="label-text">
            Open maintenance{' '}
            <InfoDisclosure label="Open maintenance">
              Tasks that have not been completed. The overdue count compares
              their due dates with the current date in UTC.
            </InfoDisclosure>
          </span>
          <strong>{summary?.openTasks ?? '—'}</strong>
          <small>{summary?.overdueTasks ?? '—'} overdue (UTC dates)</small>
        </article>
      </section>
      <div
        className={`register-workspace ${creating || selectedId || draft ? 'has-detail' : ''}`}
      >
        {detailBusy && (
          <p role="status" className="detail-panel">
            Loading asset details…
          </p>
        )}
        {detailError && (
          <div role="alert" className="detail-panel">
            {detailError}
            <button onClick={close}>Return to assets</button>
          </div>
        )}
        {(creating || selected || draft) && (
          <section
            className="editor-panel detail-panel"
            aria-label="Asset workspace"
          >
            <button onClick={() => void cancel()}>Close editor</button>
            {selected && (
              <>
                <div className="asset-identity">
                  <span className={`badge ${selected.status}`}>
                    {labels[selected.status]}
                  </span>
                  <h2>{selected.name}</h2>
                  <p className="muted">
                    <Icon name="location" /> {selected.location}
                  </p>
                </div>
                <nav className="local-tabs" aria-label="Asset sections">
                  {['Overview', 'Photos', 'Maintenance', 'Related records'].map(
                    (name) => (
                      <button
                        key={name}
                        type="button"
                        aria-current={detailTab === name ? 'page' : undefined}
                        onClick={() =>
                          void go(assetUrl({ detail: name }), {
                            discard: false,
                          })
                        }
                      >
                        {name}
                      </button>
                    ),
                  )}
                </nav>
              </>
            )}
            <div hidden={Boolean(selected && detailTab !== 'Overview')}>
              <AssetEditor
                key={draft?.id ?? selected?.id ?? 'new'}
                base={base}
                csrf={csrf}
                asset={selected}
                draft={draft}
                readOnly={!canWrite}
                canFinance={membership.capabilities.includes('finance:write')}
                after={(removedDraft) => {
                  if (removedDraft)
                    setDrafts((old) => ({
                      ...old,
                      items: old.items.filter(
                        (item) => item.id !== removedDraft,
                      ),
                    }));
                  setNotice('Saved on the server.');
                  changed();
                  close();
                }}
                onCancel={() => void cancel()}
                onDraftSaved={changed}
              />
            </div>
            {selected && (
              <div hidden={detailTab !== 'Photos'}>
                <PhotoGallery
                  base={base}
                  csrf={csrf}
                  assetId={selected.id}
                  canWrite={canWrite}
                  canDelete={membership.capabilities.includes('assets:delete')}
                />
              </div>
            )}
            {selected && (
              <div hidden={detailTab !== 'Maintenance'}>
                <Observations
                  key={selected.id}
                  asset={selected}
                  base={base}
                  csrf={csrf}
                  capabilities={membership.capabilities}
                  after={changed}
                />
              </div>
            )}
            {selected && (
              <div hidden={detailTab !== 'Related records'}>
                <AssetExtras
                  key={selected.id}
                  base={base}
                  csrf={csrf}
                  asset={selected}
                  membership={membership}
                  after={close}
                />
              </div>
            )}
          </section>
        )}
        <section className="estate-panel" aria-label="Asset register">
          <form
            className="register-heading"
            onSubmit={(e) => {
              e.preventDefault();
              void go(
                assetUrl({
                  q: query,
                  status: filter,
                  assetClass: classFilter,
                  locationId: locationFilter,
                }),
                { discard: false },
              );
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
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
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
            <div className="filter-extras wide">
              <AssetClassSelect
                base={base}
                value={classFilter}
                onChange={setClassFilter}
                allowAll
                label="Asset type"
              />
              <RecordSelect
                base={base}
                kind="locations"
                label="Location filter"
                value={locationFilter}
                onChange={setLocationFilter}
              />
              <RecordSelect
                base={base}
                kind="views"
                label="Saved search"
                value={view}
                onChange={(id) => {
                  setView(id);
                  if (id)
                    void api<{
                      content: {
                        query: string;
                        status: string;
                        assetClass: string;
                        locationId: string | null;
                      };
                    }>(base + 'records/views/' + id)
                      .then(({ content: v }) => {
                        setQuery(v.query);
                        setFilter(v.status);
                        setClassFilter(v.assetClass);
                        setLocationFilter(v.locationId ?? '');
                        void go(
                          assetUrl({
                            q: v.query,
                            status: v.status,
                            assetClass: v.assetClass,
                            locationId: v.locationId ?? '',
                          }),
                          { discard: false },
                        );
                      })
                      .catch((e) => setError(messageFor(e)));
                }}
              />
            </div>
          </form>
          {locationFilter && (
            <p className="field-hint">
              Exact location only; descendant locations are not included.
            </p>
          )}
          {Object.values(search).some(Boolean) && (
            <button
              onClick={() =>
                void go(
                  assetUrl({
                    q: '',
                    status: '',
                    assetClass: '',
                    locationId: '',
                  }),
                  { discard: false },
                )
              }
            >
              Clear filters
            </button>
          )}
          {error && (
            <p role="alert" className="empty error">
              {error} <button onClick={changed}>Retry loading</button>
            </p>
          )}
          {busy && !assets.length && (
            <p role="status" className="empty">
              Loading… The database may take up to a minute to wake.
            </p>
          )}
          <div
            className="table-wrap"
            role="region"
            aria-label="Asset results"
            tabIndex={0}
          >
            <table>
              <caption className="sr-only">
                Recorded assets matching your search
              </caption>
              <thead>
                <tr>
                  <th scope="col">Asset / Location</th>
                  <th scope="col">Type</th>
                  <th scope="col">Status</th>
                  <th scope="col">Model / Serial</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      <button
                        className="asset-button"
                        id={'asset-' + asset.id}
                        onClick={() =>
                          void go(
                            assetUrl({ asset: asset.id, detail: 'Overview' }),
                          )
                        }
                      >
                        {asset.name}
                      </button>
                      <span className="asset-location">{asset.location}</span>
                    </td>
                    <td>{title(asset.assetClass)}</td>
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
          {!busy && !error && !assets.length && (
            <EmptyState
              title={
                Object.values(search).some(Boolean)
                  ? 'No matching assets'
                  : 'Your estate starts here'
              }
            >
              {Object.values(search).some(Boolean)
                ? 'Try a different search or clear a filter.'
                : canWrite
                  ? 'Add your first asset above to start your estate register.'
                  : 'Assets will appear here when your team adds them.'}
            </EmptyState>
          )}
          {busy && assets.length > 0 && (
            <p role="status" className="empty">
              Refreshing assets… Your current results remain available.
            </p>
          )}
          {next && (
            <button disabled={busy} onClick={() => void more('assets', next)}>
              Load more assets
            </button>
          )}
        </section>
      </div>
      {canWrite && (
        <section className="editor-panel" aria-label="Saved drafts">
          <h2>Your server-saved drafts</h2>
          <p>
            Only you can see these drafts. They survive signing out; unsaved
            edits in this tab do not.
          </p>
          {draftError && (
            <p role="alert">
              Drafts unavailable: {draftError}{' '}
              <button onClick={changed}>Retry drafts</button>
            </p>
          )}
          {!draftError && !drafts.items.length && (
            <p className="muted">
              No saved drafts yet. Use “Save draft” when adding an asset to pick
              it up later.
            </p>
          )}
          {drafts.items.map((item) => (
            <p key={item.id}>
              <button
                id={'draft-' + item.id}
                onClick={async () => {
                  if (
                    !(await allowLeaving(
                      'Open this draft? Unsaved input will be lost.',
                    ))
                  )
                    return;
                  await go(assetUrl({ asset: '', detail: '' }), {
                    discard: false,
                  });
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
            onClick={async () => {
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
    </div>
  );
}
function AssetEditor({
  base,
  csrf,
  asset,
  draft,
  readOnly,
  canFinance,
  after,
  onCancel,
  onDraftSaved,
}: {
  base: string;
  csrf: string;
  asset: Asset | null;
  draft: Draft | null;
  readOnly: boolean;
  canFinance: boolean;
  after: (removedDraft?: string) => void;
  onCancel: () => void;
  onDraftSaved: () => void;
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
      after(savedDraft?.id);
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
      onDraftSaved();
    } catch {
      /* Keep input. */
    }
  }
  return (
    <form
      data-managed-dirty
      data-dirty={dirty ? 'true' : undefined}
      onSubmit={(e) => void submit(e)}
    >
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
        <AssetClassSelect
          base={base}
          value={input.assetClass}
          onChange={(v) => change('assetClass', v)}
        />
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
        <AssetDetailsEditor
          base={base}
          value={input.details ?? {}}
          assetClass={input.assetClass}
          canFinance={canFinance}
          onChange={(details) => {
            setDirty(true);
            setInput((old) => ({ ...old, details }));
          }}
        />
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
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            {!asset && (
              <button type="button" onClick={() => void saveDraft()}>
                Save draft
              </button>
            )}
            {savedDraft && dirty && (
              <p>Save your draft changes before creating the asset.</p>
            )}
            {savedDraft && (
              <button
                type="button"
                onClick={async () => {
                  if (
                    await confirmAction('Permanently delete this saved draft?')
                  )
                    void mutation
                      .save(
                        'drafts/' + savedDraft.id,
                        'DELETE',
                        {},
                        savedDraft.version,
                      )
                      .then(() => after(savedDraft.id))
                      .catch(() => {});
                }}
              >
                Delete draft
              </button>
            )}
          </div>
        )}
      </fieldset>
      <Feedback {...mutation} />
      {asset && mutation.error && (
        <button
          type="button"
          onClick={async () => {
            if (
              await confirmAction(
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
                      onClick={async () => {
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
