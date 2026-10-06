import { confirmAction } from './ConfirmDialog';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { RecordSchemas } from '@quartermaster/contracts';
import type {
  Asset,
  EstateRecord,
  RecordKind,
  Membership,
} from '@quartermaster/contracts';
import { api, messageFor } from './api';
import { Feedback, useSave } from './Workspace';
import { PageControls, RecordSelect, title, usePage } from './estate-ui';
import { Field, InfoDisclosure, EmptyState, fieldHelp } from './ui';
const names: Record<string, [string, string]> = {
  locations: ['Location', 'Locations'],
  types: ['Asset type', 'Asset types'],
  components: ['Component', 'Components'],
  valuations: ['Valuation', 'Valuations'],
  policies: ['Insurance policy', 'Insurance policies'],
  incidents: ['Incident', 'Incidents'],
  assessments: ['Damage assessment', 'Damage assessments'],
  books: ['Accounting book', 'Accounting books'],
  transactions: ['Transaction', 'Transactions'],
  plans: ['Maintenance plan', 'Maintenance plans'],
  work_logs: ['Work log', 'Work logs'],
  rules: ['Business rule', 'Business rules'],
  views: ['Saved search', 'Saved searches'],
};
const today = () => new Date().toISOString().slice(0, 10);
export function recordDefaults(kind: RecordKind): Record<string, unknown> {
  const date = today();
  return {
    locations: {
      name: '',
      kind: 'building',
      parentId: null,
      address: '',
      notes: '',
    },
    types: {
      name: '',
      code: '',
      description: '',
      fields: [],
      captureIntents: [],
    },
    components: { name: '', kind: '', accessConstraints: '', notes: '' },
    valuations: {
      basis: 'replacement',
      amountMinor: 0,
      currency: 'USD',
      effectiveOn: date,
      notes: '',
    },
    policies: {
      name: '',
      carrier: '',
      reference: '',
      startsOn: date,
      endsOn: date,
      limitMinor: 0,
      deductibleMinor: 0,
      locationId: null,
      assetClass: '',
      notes: '',
    },
    incidents: {
      name: '',
      kind: 'other',
      occurredOn: date,
      locationId: null,
      reference: '',
      notes: '',
    },
    assessments: {
      incidentId: '',
      condition: 'damaged',
      operable: false,
      repairMinor: 0,
      replacementMinor: 0,
      notes: '',
    },
    books: { name: '', method: 'straight_line', asOf: date, notes: '' },
    transactions: {
      kind: 'acquisition',
      effectiveOn: date,
      amountMinor: 0,
      notes: '',
    },
    plans: {
      name: '',
      nextDueOn: date,
      intervalMonths: 12,
      procedure: '',
      assigneeId: null,
      estimatedMinor: 0,
    },
    work_logs: {
      maintenanceId: '',
      workedOn: date,
      minutes: 0,
      partsMinor: 0,
      laborMinor: 0,
      vendor: '',
      notes: '',
    },
    rules: {
      name: '',
      field: 'status',
      operator: 'equals',
      value: 'needs_attention',
      action: 'maintenance',
      title: '',
      dueOn: null,
      enabled: false,
    },
    views: {
      name: '',
      query: '',
      status: '',
      assetClass: '',
      locationId: null,
    },
  }[kind];
}
const choices: Record<string, Record<string, string[]>> = {
  locations: { kind: ['site', 'building', 'floor', 'area'] },
  valuations: { basis: ['replacement', 'market', 'appraised'] },
  incidents: { kind: ['storm', 'fire', 'flood', 'theft', 'other'] },
  assessments: { condition: ['unaffected', 'damaged', 'destroyed', 'missing'] },
  transactions: { kind: ['acquisition', 'transfer', 'impairment', 'disposal'] },
  rules: {
    field: [
      'status',
      'assetClass',
      'location',
      'replacementOn',
      'warrantyUntil',
    ],
    operator: ['equals', 'contains', 'before'],
    action: ['flag', 'maintenance'],
  },
  views: {
    status: [
      '',
      'in_service',
      'needs_attention',
      'out_of_service',
      'retired',
      'disposed',
    ],
  },
};
export function AssetSelect({
  base,
  value,
  onChange,
}: {
  base: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const assets = usePage<Asset>(base + 'assets');
  return (
    <label>
      Asset
      <select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose an asset</option>
        {assets.items.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name} — {a.location}
          </option>
        ))}
      </select>
      <PageControls data={assets} />
    </label>
  );
}
function RecordEditor({
  base,
  csrf,
  kind,
  record,
  assetId,
  after,
}: {
  base: string;
  csrf: string;
  kind: RecordKind;
  record: EstateRecord | null;
  assetId: string | null;
  after: () => void;
}) {
  const [content, setContent] = useState(
      record
        ? { ...record.content, ...(kind === 'rules' ? { enabled: false } : {}) }
        : recordDefaults(kind),
    ),
    [parent, setParent] = useState(record?.assetId ?? assetId ?? ''),
    [error, setError] = useState('');
  const mutation = useSave(base, csrf, after);
  const assetKinds = [
    'components',
    'valuations',
    'assessments',
    'transactions',
    'plans',
    'work_logs',
  ];
  const change = (key: string, value: unknown) =>
    setContent((old) => ({ ...old, [key]: value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const checked = RecordSchemas[kind].safeParse(content);
    if (!checked.success) {
      setError(
        checked.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      );
      return;
    }
    try {
      await mutation.save(
        `records/${kind}${record ? '/' + record.id : ''}`,
        record ? 'PATCH' : 'POST',
        {
          assetId: assetKinds.includes(kind) ? parent : null,
          content: checked.data,
        },
        record?.version,
      );
    } catch {
      /* Retain input. */
    }
  }
  return (
    <form className="panel" onSubmit={(e) => void submit(e)}>
      <h3>
        {record ? 'Edit' : 'Add'} {names[kind]![0].toLowerCase()}
      </h3>
      <fieldset disabled={mutation.busy} className="form-grid">
        <legend className="sr-only">Record fields</legend>
        {assetKinds.includes(kind) && !assetId && (
          <AssetSelect base={base} value={parent} onChange={setParent} />
        )}
        {Object.entries(content).map(([key, value]) => {
          if (key === 'enabled')
            return (
              <p key={key}>
                Rules start paused. Preview and approve a run to activate a
                rule.
              </p>
            );
          if (key === 'currency' || key === 'method')
            return (
              <p key={key}>
                {title(key)}: {String(value)}
              </p>
            );
          if (['parentId', 'locationId', 'incidentId'].includes(key))
            return (
              <RecordSelect
                key={key}
                base={base}
                kind={key === 'incidentId' ? 'incidents' : 'locations'}
                value={String(value ?? '')}
                onChange={(v) => change(key, v || null)}
                label={title(key.replace('Id', ''))}
              />
            );
          const options = choices[kind]?.[key];
          if (options)
            return (
              <Field key={key} label={title(key)} help={key}>
                <select
                  value={String(value ?? '')}
                  onChange={(e) => change(key, e.target.value)}
                >
                  {options.map((v) => (
                    <option key={v} value={v}>
                      {title(v || 'Any')}
                    </option>
                  ))}
                </select>
              </Field>
            );
          if (typeof value === 'boolean')
            return (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(e) => change(key, e.target.checked)}
                />
                {title(key)}
              </label>
            );
          if (Array.isArray(value))
            return (
              <JsonField
                key={key}
                label={title(key)}
                value={value}
                onChange={(v) => change(key, v)}
              />
            );
          if (/notes|procedure|description|accessConstraints/.test(key))
            return (
              <label key={key} className="wide">
                {title(key)}
                <textarea
                  maxLength={4000}
                  value={String(value ?? '')}
                  onChange={(e) => change(key, e.target.value)}
                />
              </label>
            );
          const money = key.endsWith('Minor'),
            date = key.endsWith('On') || key === 'asOf';
          return (
            <Field
              key={key}
              label={title(key.replace('Minor', '')) + (money ? ' (USD)' : '')}
              help={key}
            >
              <input
                type={
                  money || typeof value === 'number'
                    ? 'number'
                    : date
                      ? 'date'
                      : 'text'
                }
                {...(money
                  ? { min: 0, step: 0.01 }
                  : typeof value === 'number'
                    ? { min: key === 'intervalMonths' ? 1 : 0, step: 1 }
                    : {})}
                value={money ? Number(value) / 100 : String(value ?? '')}
                required={['name', 'code', 'title', 'maintenanceId'].includes(
                  key,
                )}
                onChange={(e) =>
                  change(
                    key,
                    money
                      ? Math.round(Number(e.target.value) * 100)
                      : typeof value === 'number'
                        ? Number(e.target.value)
                        : value === null
                          ? e.target.value || null
                          : e.target.value,
                  )
                }
              />
            </Field>
          );
        })}
        <button className="primary" type="submit">
          Save {names[kind]![0].toLowerCase()}
        </button>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <Feedback {...mutation} />
    </form>
  );
}
function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown[];
  onChange: (v: unknown[]) => void;
}) {
  const fields = label === 'Fields';
  const update = (index: number, item: unknown) =>
    onChange(value.map((v, i) => (i === index ? item : v)));
  return (
    <section className="wide array-editor">
      <div className="label-text">
        <h3>{fields ? 'Additional fields' : 'Requested photo views'}</h3>
        <InfoDisclosure
          label={fields ? 'Additional fields' : 'Requested photo views'}
        >
          {fieldHelp[fields ? 'fields' : 'captureIntents']}
        </InfoDisclosure>
      </div>
      {value.map((item, i) => {
        const field = item as {
          key: string;
          label: string;
          type: string;
          required: boolean;
        };
        return (
          <div className="array-row" key={i}>
            {fields ? (
              <>
                <label>
                  Field label
                  <input
                    required
                    value={field.label}
                    maxLength={120}
                    onChange={(e) =>
                      update(i, { ...field, label: e.target.value })
                    }
                  />
                </label>
                <label>
                  Field key
                  <input
                    required
                    pattern="[a-z][a-z0-9_]{0,39}"
                    value={field.key}
                    onChange={(e) =>
                      update(i, { ...field, key: e.target.value })
                    }
                  />
                  <span className="field-hint">
                    Lowercase letters, numbers, underscores. Keep stable after
                    use.
                  </span>
                </label>
                <label>
                  Value type
                  <select
                    value={field.type}
                    onChange={(e) =>
                      update(i, { ...field, type: e.target.value })
                    }
                  >
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="boolean">Yes / No</option>
                  </select>
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) =>
                      update(i, { ...field, required: e.target.checked })
                    }
                  />
                  Required
                </label>
              </>
            ) : (
              <label>
                Photo view
                <input
                  required
                  maxLength={80}
                  value={String(item)}
                  list="photo-view-options"
                  onChange={(e) => update(i, e.target.value)}
                />
              </label>
            )}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, index) => index !== i))}
            >
              Remove {fields ? 'field' : 'view'}
            </button>
          </div>
        );
      })}
      {!fields && (
        <datalist id="photo-view-options">
          {[
            'nameplate',
            'whole_unit',
            'outdoor_coil',
            'compressor',
            'damage_detail',
            'document',
            'other',
          ].map((v) => (
            <option key={v} value={v}>
              {title(v)}
            </option>
          ))}
        </datalist>
      )}
      {value.length < (fields ? 30 : 12) && (
        <button
          type="button"
          onClick={() =>
            onChange([
              ...value,
              fields
                ? { key: '', label: '', type: 'text', required: false }
                : '',
            ])
          }
        >
          Add {fields ? 'field' : 'photo view'}
        </button>
      )}
    </section>
  );
}
export function RecordsPanel({
  base,
  csrf,
  kind,
  membership,
  assetId = null,
}: {
  base: string;
  csrf: string;
  kind: RecordKind;
  membership: Membership;
  assetId?: string | null;
}) {
  const data = usePage<EstateRecord>(
    `${base}records/${kind}${assetId ? '?assetId=' + assetId : ''}`,
  );
  const [selected, setSelected] = useState<EstateRecord | null>(null),
    [editing, setEditing] = useState(false),
    [history, setHistory] = useState<unknown[] | null>(null),
    [error, setError] = useState('');
  const mutation = useSave(base, csrf, () => {
    setEditing(false);
    setSelected(null);
    data.reload();
  });
  const capability = [
    'valuations',
    'policies',
    'books',
    'transactions',
    'assessments',
  ].includes(kind)
    ? 'finance:write'
    : kind === 'rules'
      ? 'rules:write'
      : 'records:write';
  const canWrite = membership.capabilities.includes(capability);
  return (
    <section className="panel">
      <h2>{names[kind]![1]}</h2>
      {kind === 'incidents' && (
        <p>
          Creating an incident snapshots the currently recorded estate in its
          scope. Enter the event date; the snapshot is captured now, not
          reconstructed historically.
        </p>
      )}
      {kind === 'books' && (
        <p>
          Save reporting dates for straight-line management accounting. Reports
          are estimates, not tax filings.
        </p>
      )}
      <PageControls data={data} />
      {canWrite && (
        <button
          className="primary"
          onClick={async () => {
            setSelected(null);
            setEditing(true);
          }}
        >
          Add {names[kind]![0].toLowerCase()}
        </button>
      )}
      {!data.busy && !data.items.length && (
        <EmptyState title={`No ${names[kind]![1].toLowerCase()} yet`}>
          {canWrite
            ? `Add a ${names[kind]![0].toLowerCase()} to organize this part of your estate.`
            : 'Records will appear here when your team adds them.'}
        </EmptyState>
      )}
      <div className="record-list">
        {data.items.map((r) => (
          <article key={r.id}>
            <h3>
              {String(
                r.content.name ??
                  r.content.title ??
                  r.content.kind ??
                  r.content.basis ??
                  title(kind),
              )}{' '}
              <small>v{r.version}</small>
            </h3>
            <dl>
              {Object.entries(r.content).map(([k, v]) => (
                <div key={k}>
                  <dt>{title(k.replace('Minor', ''))}</dt>
                  <dd>
                    {k.endsWith('Minor')
                      ? `$${(Number(v) / 100).toFixed(2)}`
                      : v === null
                        ? '—'
                        : typeof v === 'object'
                          ? JSON.stringify(v)
                          : String(v)}
                  </dd>
                </div>
              ))}
            </dl>
            <small>
              ID: {r.id}
              {r.assetId && ` · Asset: ${r.assetId}`}
            </small>
            <div className="actions">
              {canWrite && (
                <>
                  <button
                    onClick={async () => {
                      setSelected(r);
                      setEditing(true);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      if (
                        await confirmAction(
                          `Delete this ${title(kind)} record?`,
                        )
                      )
                        void mutation
                          .save(
                            `records/${kind}/${r.id}`,
                            'DELETE',
                            {},
                            r.version,
                          )
                          .catch(() => {});
                    }}
                  >
                    Delete
                  </button>
                </>
              )}
              <button
                onClick={() =>
                  void api<{ items: unknown[] }>(
                    `${base}records/${kind}/${r.id}/history`,
                  )
                    .then((v) => {
                      setHistory(v.items);
                      setError('');
                    })
                    .catch((e) => setError(messageFor(e)))
                }
              >
                Revision history
              </button>
            </div>
            {kind === 'rules' && canWrite && (
              <RuleReview
                base={base}
                csrf={csrf}
                record={r}
                after={data.reload}
              />
            )}
          </article>
        ))}
      </div>
      {history && (
        <details open>
          <summary>Previous revisions</summary>
          <pre>{JSON.stringify(history, null, 2)}</pre>
          <button onClick={() => setHistory(null)}>Close history</button>
        </details>
      )}
      {error && <p role="alert">{error}</p>}
      {editing && (
        <>
          <RecordEditor
            key={selected?.id ?? 'new'}
            base={base}
            csrf={csrf}
            kind={kind}
            record={selected}
            assetId={assetId}
            after={() => {
              setEditing(false);
              data.reload();
            }}
          />
          <button
            onClick={async () => {
              if (
                await confirmAction(
                  'Close the editor and discard unsaved input?',
                )
              )
                setEditing(false);
            }}
          >
            Close editor
          </button>
        </>
      )}
      <Feedback {...mutation} />
    </section>
  );
}
function RuleReview({
  base,
  csrf,
  record,
  after,
}: {
  base: string;
  csrf: string;
  record: EstateRecord;
  after: () => void;
}) {
  const [preview, setPreview] = useState<{
      previewHash: string;
      count: number;
      items: { id: string; name: string }[];
    } | null>(null),
    [error, setError] = useState('');
  const mutation = useSave(base, csrf, () => {
    setPreview(null);
    after();
  });
  return (
    <div>
      <button
        onClick={() =>
          void api<typeof preview>(`${base}rules/${record.id}/preview`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': csrf,
            },
            body: '{}',
          })
            .then(setPreview)
            .catch((e) => setError(messageFor(e)))
        }
      >
        Preview affected assets
      </button>
      {preview && (
        <>
          <p>
            {preview.count} matching assets. Review this list before approval.
          </p>
          <ul>
            {preview.items.map((a) => (
              <li key={a.id}>{a.name}</li>
            ))}
          </ul>
          {['run', 'activate'].map((action) => (
            <button
              key={action}
              disabled={mutation.busy}
              onClick={() =>
                void mutation
                  .save(
                    `rules/${record.id}/${action}`,
                    'POST',
                    { previewHash: preview.previewHash },
                    record.version,
                  )
                  .catch(() => {})
              }
            >
              {action === 'run'
                ? 'Approve one-time run'
                : 'Approve and enable automatic rule'}
            </button>
          ))}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      <Feedback {...mutation} />
    </div>
  );
}
