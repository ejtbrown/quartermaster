import { useId } from 'react';
import type { AssetDetails, EstateRecord } from '@quartermaster/contracts';
import { RecordSelect, title, usePage } from './estate-ui';
import { Field } from './ui';
export function AssetClassSelect({
  base,
  value,
  onChange,
  allowAll = false,
  label = 'Asset type',
}: {
  base: string;
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  label?: string;
}) {
  const id = useId();
  const data = usePage<EstateRecord>(base + 'records/types');
  const choices = new Map([
    ['air_conditioner', 'Air conditioner'],
    ['appliance', 'Appliance'],
    ...data.items.map(
      (r) =>
        [String(r.content.code), String(r.content.name)] as [string, string],
    ),
  ]);
  if (value && !choices.has(value)) choices.set(value, value);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAll && <option value="">All asset types</option>}
        {[...choices].map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
      {data.error && <span role="alert">{data.error}</span>}
      {data.cursor && (
        <button type="button" onClick={data.more}>
          More classes
        </button>
      )}
    </div>
  );
}
export function AssetDetailsEditor({
  base,
  value,
  onChange,
  canFinance,
  assetClass,
}: {
  base: string;
  value: AssetDetails;
  onChange: (v: AssetDetails) => void;
  canFinance: boolean;
  assetClass: string;
}) {
  const types = usePage<EstateRecord>(base + 'records/types');
  const fields = (types.items.find((t) => t.content.code === assetClass)
    ?.content.fields ?? []) as {
    key: string;
    label: string;
    type: string;
    required: boolean;
  }[];
  const update = (key: string, v: unknown) => onChange({ ...value, [key]: v });
  return (
    <details className="wide">
      <summary>Location, condition, lifecycle and financial details</summary>
      <div className="form-grid">
        <label>
          Asset tag
          <input
            maxLength={80}
            value={value.assetTag ?? ''}
            onChange={(e) => update('assetTag', e.target.value)}
          />
        </label>
        <RecordSelect
          base={base}
          kind="locations"
          label="Structured location"
          value={value.locationId ?? ''}
          onChange={(v) => update('locationId', v || null)}
        />
        <label>
          Parent asset ID (optional)
          <input
            pattern="[0-9a-fA-F-]{36}"
            value={value.parentAssetId ?? ''}
            onChange={(e) => update('parentAssetId', e.target.value || null)}
          />
        </label>
        {(['condition', 'criticality'] as const).map((key) => (
          <Field key={key} label={title(key)} help={key}>
            <select
              value={value[key] ?? (key === 'condition' ? 'unknown' : 'normal')}
              onChange={(e) => update(key, e.target.value)}
            >
              {(key === 'condition'
                ? ['unknown', 'good', 'fair', 'poor', 'failed']
                : ['low', 'normal', 'high', 'critical']
              ).map((v) => (
                <option key={v} value={v}>
                  {title(v)}
                </option>
              ))}
            </select>
          </Field>
        ))}
        {(
          [
            'acquiredOn',
            'inServiceOn',
            'warrantyUntil',
            'replacementOn',
            'disposedOn',
          ] as const
        ).map((key) => (
          <label key={key}>
            {title(key)}
            <input
              type="date"
              value={value[key] ?? ''}
              onChange={(e) => update(key, e.target.value || null)}
            />
          </label>
        ))}
        <label>
          Disposal reason
          <input
            maxLength={1000}
            value={value.disposalReason ?? ''}
            onChange={(e) => update('disposalReason', e.target.value)}
          />
        </label>
        <fieldset className="wide form-grid" disabled={!canFinance}>
          <legend>Financial basis (USD)</legend>
          {(
            [
              'costMinor',
              'replacementMinor',
              'residualMinor',
              'proceedsMinor',
            ] as const
          ).map((key) => (
            <Field
              key={key}
              label={title(key.replace('Minor', '')) + ' (USD)'}
              help={key.replace('Minor', '')}
            >
              <input
                type="number"
                min="0"
                step="0.01"
                value={(value[key] ?? 0) / 100}
                onChange={(e) =>
                  update(key, Math.round(Number(e.target.value) * 100))
                }
              />
            </Field>
          ))}
          <Field label="Useful life (months)" help="usefulLifeMonths">
            <input
              type="number"
              min="1"
              max="1200"
              value={value.usefulLifeMonths ?? ''}
              onChange={(e) => {
                const next = { ...value };
                if (e.target.value)
                  next.usefulLifeMonths = Number(e.target.value);
                else delete next.usefulLifeMonths;
                onChange(next);
              }}
            />
          </Field>
          <Field label="Cost center" help="costCenter">
            <input
              maxLength={120}
              value={value.costCenter ?? ''}
              onChange={(e) => update('costCenter', e.target.value)}
            />
          </Field>
          <Field label="Capitalized" help="capitalized">
            <input
              type="checkbox"
              checked={value.capitalized ?? false}
              onChange={(e) => update('capitalized', e.target.checked)}
            />
          </Field>
        </fieldset>
        {!canFinance && (
          <p className="field-hint wide">
            Financial fields are read-only for your workspace role.
          </p>
        )}
        {fields.map((field) => (
          <label key={field.key}>
            {field.label}
            <input
              required={field.required}
              type={
                field.type === 'boolean'
                  ? 'checkbox'
                  : field.type === 'number'
                    ? 'number'
                    : 'text'
              }
              {...(field.type === 'boolean'
                ? { checked: Boolean(value.attributes?.[field.key]) }
                : { value: String(value.attributes?.[field.key] ?? '') })}
              onChange={(e) =>
                update('attributes', {
                  ...value.attributes,
                  [field.key]:
                    field.type === 'boolean'
                      ? e.target.checked
                      : field.type === 'number'
                        ? Number(e.target.value)
                        : e.target.value,
                })
              }
            />
          </label>
        ))}
      </div>
    </details>
  );
}
