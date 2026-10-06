import { confirmAction } from './ConfirmDialog';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Capability } from '@quartermaster/contracts';
import type {
  Job,
  Maintenance,
  Membership,
  RecordKind,
} from '@quartermaster/contracts';
import { api, messageFor } from './api';
import { Feedback, useSave } from './Workspace';
import { RecordsPanel } from './RecordsPanel';
import { CapturePanel } from './CapturePanel';
import { JobStatus } from './PhotoGallery';
import { Icon, Field } from './ui';
const capabilityLabels: Record<string, string> = {
  'assets:read': 'View assets and estate records',
  'assets:write': 'Add and edit assets',
  'maintenance:write': 'Manage maintenance tasks',
  'audit:read': 'View audit history',
  'assets:delete': 'Delete assets and photos',
  'records:write': 'Manage locations, types and related records',
  'finance:write': 'Manage financial and insurance records',
  'rules:write': 'Manage business rules',
  'exports:read': 'Run reports and export data',
  'workspace:admin': 'Administer workspace and team access',
};
import {
  PageControls,
  RecordSelect,
  downloadBlob,
  title,
  toCsv,
  usePage,
} from './estate-ui';
export function EstateTools({
  membership,
  csrf,
  children,
  navigationTarget,
}: {
  membership: Membership;
  csrf: string;
  actorId: string;
  children: ReactNode;
  navigationTarget: HTMLElement | null;
}) {
  const [tab, setTab] = useState('Assets');
  const activeTab = useRef(tab);
  activeTab.current = tab;
  const [menuOpen, setMenuOpen] = useState(false);
  const base = `/api/v1/tenants/${membership.tenantId}/`;
  const tabs = [
    'Assets',
    ...(membership.capabilities.includes('assets:write') ? ['Capture'] : []),
    'Maintenance',
    'Locations',
    'Asset types',
    'Insurance',
    'Incidents',
    'Accounting',
    'Rules',
    ...(membership.capabilities.includes('exports:read') ? ['Reports'] : []),
    'Activity',
    ...(membership.capabilities.includes('workspace:admin')
      ? ['Team', 'Settings']
      : []),
  ];
  const groups: Record<string, RecordKind[]> = {
    Locations: ['locations'],
    'Asset types': ['types'],
    Insurance: ['policies'],
    Incidents: ['incidents', 'assessments'],
    Accounting: ['books', 'transactions', 'valuations'],
    Rules: ['rules', 'views'],
  };
  const slug = (name: string) => name.toLowerCase().replaceAll(' ', '-');
  useEffect(() => {
    const change = async (guard = false) => {
      const name =
        tabs.find((t) => '#' + slug(t) === window.location.hash) ?? 'Assets';
      if (
        guard &&
        name !== activeTab.current &&
        document.querySelector('[data-dirty="true"],[data-unsaved-editor]') &&
        !(await confirmAction('Change section? Unsaved input will be lost.'))
      ) {
        window.history.pushState(null, '', '#' + slug(activeTab.current));
        return;
      }
      setTab(name);
    };
    void change();
    const back = () => void change(true);
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, [membership.tenantId]);
  const icons: Record<string, string> = {
    Assets: 'assets',
    Capture: 'mic',
    Maintenance: 'work',
    Locations: 'location',
    Insurance: 'shield',
    Incidents: 'alert',
    Accounting: 'report',
    Reports: 'report',
    'Asset types': 'assets',
    Rules: 'settings',
    Activity: 'clock',
    Team: 'team',
    Settings: 'settings',
  };
  const navigate = async (name: string) => {
    if (
      tab !== name &&
      document.querySelector('[data-dirty="true"],[data-unsaved-editor]') &&
      !(await confirmAction(
        'Change section? Unsaved input in this form will be lost.',
      ))
    )
      return;
    setTab(name);
    setMenuOpen(false);
    window.history.pushState(null, '', '#' + slug(name));
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('#main')?.focus(),
    );
  };
  const link = (name: string) => (
    <a
      key={name}
      href={'#' + slug(name)}
      aria-current={tab === name ? 'page' : undefined}
      onClick={(event) => {
        event.preventDefault();
        navigate(name);
      }}
    >
      <Icon name={icons[name] ?? 'assets'} />
      <span>{name}</span>
    </a>
  );
  const navigation = (
    <>
      <button
        type="button"
        className="mobile-menu-toggle"
        aria-expanded={menuOpen}
        aria-controls="estate-navigation"
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <Icon name={menuOpen ? 'close' : 'menu'} />
        {menuOpen ? 'Close menu' : 'Menu'}
      </button>
      <nav
        id="estate-navigation"
        className={`estate-nav ${menuOpen ? 'is-open' : ''}`}
        aria-label="Estate tools"
      >
        {Object.entries({
          Everyday: ['Assets', 'Capture', 'Maintenance', 'Locations'],
          Planning: ['Insurance', 'Incidents', 'Accounting', 'Reports'],
          Manage: ['Asset types', 'Rules', 'Activity', 'Team', 'Settings'],
        }).map(([group, names]) => (
          <div className="nav-group" key={group}>
            <p className="nav-group-label">{group}</p>
            {names.filter((name) => tabs.includes(name)).map(link)}
          </div>
        ))}
      </nav>
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        {['Assets', 'Capture', 'Maintenance']
          .filter((name) => tabs.includes(name))
          .map(link)}
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="estate-navigation"
          onClick={async () => {
            setMenuOpen(!menuOpen);
            window.scrollTo({ top: 0 });
          }}
        >
          <Icon name="menu" />
          <span>More</span>
        </button>
      </nav>
    </>
  );
  return (
    <>
      {navigationTarget ? createPortal(navigation, navigationTarget) : null}
      {tab !== 'Assets' && (
        <div className="section-context">
          <span className="eyebrow">{membership.name}</span>
          <span className="section-context-label">
            <Icon name={icons[tab] ?? 'assets'} />
            {tab}
          </span>
        </div>
      )}
      {tab === 'Assets' ? (
        children
      ) : tab === 'Capture' ? (
        <CapturePanel base={base} csrf={csrf} membership={membership} />
      ) : tab === 'Maintenance' ? (
        <>
          <WorkPanel base={base} csrf={csrf} membership={membership} />
          <RecordsPanel
            base={base}
            csrf={csrf}
            membership={membership}
            kind="plans"
          />
          <RecordsPanel
            base={base}
            csrf={csrf}
            membership={membership}
            kind="work_logs"
          />
        </>
      ) : tab === 'Reports' ? (
        <Reports base={base} csrf={csrf} />
      ) : tab === 'Team' ? (
        <Team base={base} csrf={csrf} />
      ) : tab === 'Settings' ? (
        <Settings base={base} csrf={csrf} />
      ) : tab === 'Activity' ? (
        <Activity base={base} csrf={csrf} membership={membership} />
      ) : (
        groups[tab]?.map((kind) => (
          <RecordsPanel
            key={kind}
            kind={kind}
            base={base}
            csrf={csrf}
            membership={membership}
          />
        ))
      )}
    </>
  );
}
function WorkPanel({
  base,
  csrf,
  membership,
}: {
  base: string;
  csrf: string;
  membership: Membership;
}) {
  const data = usePage<Maintenance>(base + 'maintenance');
  const mutation = useSave(base, csrf, data.reload);
  return (
    <section className="panel">
      <h1>Maintenance work</h1>
      <p>
        Add tasks from an asset, or use recurring plans below. Logging work does
        not automatically complete a task.
      </p>
      <PageControls data={data} />
      {!data.items.length && !data.busy && <p>No maintenance tasks.</p>}
      {data.items.map((task) => (
        <article key={task.id}>
          <h3>{task.title}</h3>
          <p>
            {task.status} · due {task.dueDate ?? 'not set'}
          </p>
          <p>{task.notes}</p>
          <small>
            Task ID: {task.id} · Asset: {task.assetId}
          </small>
          {membership.capabilities.includes('maintenance:write') && (
            <div className="actions">
              {(['open', 'in_progress', 'completed'] as const)
                .filter((s) => s !== task.status)
                .map((status) => (
                  <button
                    key={status}
                    disabled={mutation.busy}
                    onClick={() =>
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
                        .catch(() => {})
                    }
                  >
                    {title(status)}
                  </button>
                ))}
            </div>
          )}
        </article>
      ))}
      <Feedback {...mutation} />
    </section>
  );
}
function Reports({ base, csrf }: { base: string; csrf: string }) {
  const [kind, setKind] = useState('estate'),
    [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10)),
    [query, setQuery] = useState(''),
    [incidentId, setIncident] = useState(''),
    [rows, setRows] = useState<Record<string, unknown>[]>([]),
    [totals, setTotals] = useState<Record<string, number>>({}),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Job | null>(null),
    [exportCursor, setExportCursor] = useState<string | null>(null);
  const mutation = useSave(base, csrf, () => {});
  async function report(more = false) {
    setBusy(true);
    try {
      const result = await api<{
        items: Record<string, unknown>[];
        nextCursor: string | null;
        pageTotals?: Record<string, number>;
      }>(base + 'reports' + (more && cursor ? '?cursor=' + cursor : ''), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          kind,
          asOf,
          query,
          incidentId: incidentId || null,
        }),
      });
      setRows((old) => (more ? [...old, ...result.items] : result.items));
      setCursor(result.nextCursor);
      setTotals((old) =>
        Object.fromEntries(
          Object.entries(result.pageTotals ?? {}).map(([k, v]) => [
            k,
            v + (more ? (old[k] ?? 0) : 0),
          ]),
        ),
      );
      setError('');
    } catch (e) {
      setError(messageFor(e));
    } finally {
      setBusy(false);
    }
  }
  const columns = [...new Set(rows.flatMap(Object.keys))];
  return (
    <section className="panel">
      <h1>Reports and portable exports</h1>
      <p>
        Financial amounts are shown in US dollars. Accounting uses
        completed-month straight-line estimates; confirm your accounting policy
        before filing.
      </p>
      <div className="form-grid">
        <label>
          Report
          <select
            value={kind}
            onChange={async (e) => {
              setKind(e.target.value);
              setRows([]);
              setCursor(null);
            }}
          >
            {[
              'estate',
              'maintenance',
              'insurance',
              'accounting',
              'quality',
              'incident',
            ].map((k) => (
              <option key={k} value={k}>
                {title(k)}
              </option>
            ))}
          </select>
        </label>
        <Field label="As of" help="asOf">
          <input
            type="date"
            value={asOf}
            onChange={async (e) => {
              setAsOf(e.target.value);
              setCursor(null);
              setRows([]);
              setTotals({});
            }}
          />
        </Field>
        <label>
          Asset search
          <input
            value={query}
            onChange={async (e) => {
              setQuery(e.target.value);
              setCursor(null);
              setRows([]);
              setTotals({});
            }}
          />
        </label>
        {kind === 'incident' && (
          <RecordSelect
            base={base}
            kind="incidents"
            label="Incident"
            value={incidentId}
            onChange={(value) => {
              setIncident(value);
              setCursor(null);
              setRows([]);
              setTotals({});
            }}
          />
        )}
      </div>
      <div className="actions">
        <button
          className="primary"
          disabled={busy}
          onClick={() => void report()}
        >
          Run report
        </button>
        {cursor && (
          <button disabled={busy} onClick={() => void report(true)}>
            Load next 100 rows
          </button>
        )}
        {rows.length > 0 && (
          <>
            <button
              onClick={() =>
                downloadBlob(toCsv(rows), `quartermaster-${kind}-${asOf}.csv`)
              }
            >
              Download loaded rows as CSV
            </button>
            <button onClick={() => window.print()}>Print / save PDF</button>
          </>
        )}
      </div>
      {cursor && (
        <p>
          More rows remain. CSV and printing include only the rows currently
          loaded.
        </p>
      )}
      {busy && <p role="status">Preparing report…</p>}
      {Object.keys(totals).length > 0 && (
        <p>
          Loaded-row totals:{' '}
          {Object.entries(totals)
            .map(
              ([k, v]) =>
                `${title(k.replace('Minor', ''))}: ${k.endsWith('Minor') ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v / 100) : v.toLocaleString()}`,
            )
            .join(' · ')}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((k) => (
                <th key={k} scope="col">
                  {title(k.replace('Minor', ''))}
                  {k.endsWith('Minor') ? ' (USD)' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={String(r.id ?? i)}>
                {columns.map((k) => (
                  <td key={k}>
                    {k.endsWith('Minor') && typeof r[k] === 'number'
                      ? new Intl.NumberFormat('en-US', {
                          style: 'currency',
                          currency: 'USD',
                        }).format(r[k] / 100)
                      : typeof r[k] === 'object'
                        ? JSON.stringify(r[k])
                        : String(r[k] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Portable estate package</h2>
      <p>
        Each ZIP contains up to 100 assets, associated records, normalized
        photos and a checksum manifest. Large estates use consecutive parts.
        Packages expire after 15 days and are invalidated when live content is
        deleted.
      </p>
      <button
        disabled={mutation.busy}
        onClick={() =>
          void mutation
            .save('exports', 'POST', {
              after: exportCursor,
              includePhotos: true,
            })
            .then((r) => setJob((r as { item: Job }).item))
            .catch(() => {})
        }
      >
        {exportCursor ? 'Build next export part' : 'Build estate export'}
      </button>
      {job && (
        <>
          <JobStatus
            key={job.id}
            base={base}
            job={job}
            onDone={() =>
              void api<Job>(base + 'jobs/' + job.id)
                .then((next) => {
                  setJob(next);
                  setExportCursor(
                    typeof next.result.nextCursor === 'string'
                      ? next.result.nextCursor
                      : null,
                  );
                })
                .catch((e) => setError(messageFor(e)))
            }
          />
          {job.state === 'complete' && (
            <button
              onClick={() =>
                void api<{ url: string }>(`${base}jobs/${job.id}/download`)
                  .then((r) => window.location.assign(r.url))
                  .catch((e) => setError(messageFor(e)))
              }
            >
              Download this ZIP part
            </button>
          )}
        </>
      )}
      <Feedback {...mutation} />
    </section>
  );
}
type Member = {
  id: string;
  email: string | null;
  capabilities: string[];
  active: boolean;
};
function Team({ base, csrf }: { base: string; csrf: string }) {
  const data = usePage<Member>(base + 'members'),
    [email, setEmail] = useState(''),
    [caps, setCaps] = useState<string[]>([
      'assets:read',
      'assets:write',
      'maintenance:write',
      'records:write',
    ]);
  const mutation = useSave(base, csrf, data.reload);
  const choose = (list: string[], key: string, on: boolean) =>
    on ? [...new Set([...list, key])] : list.filter((v) => v !== key);
  return (
    <section className="panel">
      <h1>Team access</h1>
      <p>
        Invitations are sent by email. Each person sets their own password and
        multifactor authentication. Administrative actions require a sign-in
        within the last 15 minutes.
      </p>
      <PageControls data={data} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutation
            .save('members', 'POST', { email, capabilities: caps })
            .then(() => setEmail(''))
            .catch(() => {});
        }}
      >
        <label>
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <fieldset>
          <legend>Invitation permissions</legend>
          {Capability.options.map((c) => (
            <label key={c}>
              <input
                type="checkbox"
                checked={caps.includes(c)}
                onChange={(e) =>
                  setCaps((old) => choose(old, c, e.target.checked))
                }
              />
              {capabilityLabels[c] ?? c}
            </label>
          ))}
        </fieldset>
        <button className="primary" disabled={mutation.busy}>
          Send invitation
        </button>
      </form>
      {data.items.map((member) => (
        <MemberEditor
          key={member.id + JSON.stringify(member.capabilities) + member.active}
          member={member}
          base={base}
          csrf={csrf}
          after={data.reload}
        />
      ))}
      <Feedback {...mutation} />
    </section>
  );
}
function MemberEditor({
  member,
  base,
  csrf,
  after,
}: {
  member: Member;
  base: string;
  csrf: string;
  after: () => void;
}) {
  const [caps, setCaps] = useState(member.capabilities),
    [active, setActive] = useState(member.active);
  const mutation = useSave(base, csrf, after);
  return (
    <details data-editing-scope>
      <summary>
        {member.email ?? member.id} — {member.active ? 'active' : 'revoked'}
      </summary>
      <label>
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Access active
      </label>
      {Capability.options.map((c) => (
        <label key={c}>
          <input
            type="checkbox"
            checked={caps.includes(c)}
            onChange={(e) =>
              setCaps((old) =>
                e.target.checked ? [...old, c] : old.filter((v) => v !== c),
              )
            }
          />
          {capabilityLabels[c] ?? c}
        </label>
      ))}
      <button
        disabled={mutation.busy}
        onClick={() =>
          void mutation
            .save('members/' + member.id, 'PATCH', {
              capabilities: caps,
              active,
            })
            .catch(() => {})
        }
      >
        Save access
      </button>
      <Feedback {...mutation} />
    </details>
  );
}
function Settings({ base, csrf }: { base: string; csrf: string }) {
  const [settings, setSettings] = useState<{
      name: string;
      timeZone: string;
      version: number;
    } | null>(null),
    [error, setError] = useState(''),
    [confirmation, setConfirmation] = useState(''),
    [closed, setClosed] = useState(false);
  const mutation = useSave(base, csrf, () => {});
  const load = () =>
    void api<NonNullable<typeof settings>>(base + 'settings')
      .then(setSettings)
      .catch((e) => setError(messageFor(e)));
  if (closed)
    return (
      <p role="status">
        Workspace closed. Access has been revoked and live data purge is queued.
        Isolated backups expire within 90 days; deletion replay protects
        restores.
      </p>
    );
  return (
    <section className="panel">
      <h1>Workspace settings</h1>
      <button onClick={load}>Load / refresh settings</button>
      {settings && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void mutation
              .save(
                'settings',
                'PATCH',
                { name: settings.name, timeZone: settings.timeZone },
                settings.version,
              )
              .then((r) =>
                setSettings((r as { item: NonNullable<typeof settings> }).item),
              )
              .catch(() => {});
          }}
        >
          <label>
            Workspace name
            <input
              required
              value={settings.name}
              onChange={(e) =>
                setSettings({ ...settings, name: e.target.value })
              }
            />
          </label>
          <label>
            Time zone
            <input
              required
              value={settings.timeZone}
              onChange={(e) =>
                setSettings({ ...settings, timeZone: e.target.value })
              }
            />
          </label>
          <button disabled={mutation.busy}>Save settings</button>
        </form>
      )}
      <h2>Retention</h2>
      <p>
        Original images and transcript text: 15 days. Resized photos and asset
        facts: until you delete them. Audit records: one year. Backups and
        deletion metadata: up to 90 days. Retained backups are inaccessible
        during normal operation and must have deletions replayed before restored
        access.
      </p>
      <p>
        AI request limit: 100 per day; voice transcription: 15 minutes per day,
        subject to the shared development allowance. No offline storage or
        synchronization.
      </p>
      <details>
        <summary>Delete this workspace</summary>
        <p>
          This closes access and purges live records, photos and export
          packages. Deletion metadata remains for the backup horizon. Type the
          exact workspace name to confirm.
        </p>
        <input
          aria-label="Workspace deletion confirmation"
          value={confirmation}
          onChange={(e) => setConfirmation(e.target.value)}
        />
        <button
          disabled={
            mutation.busy || !settings || confirmation !== settings.name
          }
          onClick={async () => {
            if (
              await confirmAction(
                'Permanently close this workspace and purge its live data?',
              )
            )
              void mutation
                .save('tenant/delete', 'POST', { confirmName: confirmation })
                .then(() => setClosed(true))
                .catch(() => {});
          }}
        >
          Delete workspace and live data
        </button>
      </details>
      {error && <p role="alert">{error}</p>}
      <Feedback {...mutation} />
    </section>
  );
}
function Activity({
  base,
  csrf,
  membership,
}: {
  base: string;
  csrf: string;
  membership: Membership;
}) {
  const data = usePage<Job>(base + 'jobs');
  const mutation = useSave(base, csrf, data.reload);
  return (
    <section className="panel">
      <h1>Your background jobs</h1>
      <PageControls data={data} />
      {data.items.map((j) => (
        <article key={j.id}>
          <p>
            {title(j.kind)} — {j.state} · {j.createdAt}
          </p>
          {j.errorCode && <p>{title(j.errorCode)}</p>}
          {['queued', 'running'].includes(j.state) && (
            <JobStatus base={base} job={j} onDone={data.reload} />
          )}
          <pre>{JSON.stringify(j.result, null, 2)}</pre>
          {j.state === 'failed' &&
            membership.capabilities.includes('assets:write') && (
              <button
                onClick={() =>
                  void mutation
                    .save(`jobs/${j.id}/retry`, 'POST', {})
                    .catch(() => {})
                }
              >
                Retry job
              </button>
            )}
          {j.kind === 'export' &&
            j.state === 'complete' &&
            membership.capabilities.includes('exports:read') && (
              <button
                onClick={() =>
                  void api<{ url: string }>(`${base}jobs/${j.id}/download`)
                    .then((r) => window.location.assign(r.url))
                    .catch(() => {})
                }
              >
                Download export
              </button>
            )}
        </article>
      ))}
      <Feedback {...mutation} />
    </section>
  );
}
