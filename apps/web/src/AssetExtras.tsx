import { useState } from 'react';
import type { Asset, Membership, RecordKind } from '@quartermaster/contracts';
import { RecordsPanel } from './RecordsPanel';
import { useSave, Feedback } from './Workspace';
import { title } from './estate-ui';
export function AssetExtras({
  base,
  csrf,
  asset,
  membership,
  after,
}: {
  base: string;
  csrf: string;
  asset: Asset;
  membership: Membership;
  after: () => void;
}) {
  const [kind, setKind] = useState<RecordKind>('components');
  const mutation = useSave(base, csrf, after);
  return (
    <section>
      <h2>Asset records</h2>
      <p>Asset ID: {asset.id}</p>
      <label>
        Record category
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as RecordKind)}
        >
          {(
            [
              'components',
              'valuations',
              'assessments',
              'transactions',
              'plans',
              'work_logs',
            ] as const
          ).map((k) => (
            <option key={k} value={k}>
              {title(k)}
            </option>
          ))}
        </select>
      </label>
      <RecordsPanel
        key={kind}
        base={base}
        csrf={csrf}
        membership={membership}
        kind={kind}
        assetId={asset.id}
      />
      {membership.capabilities.includes('assets:delete') && (
        <details>
          <summary>Delete this asset</summary>
          <p>
            Deletion removes its live facts, photos, readings and related
            records. Content-free audit/deletion metadata remains under the
            retention policy. Retained backups expire within 90 days and are
            subject to deletion replay.
          </p>
          <button
            disabled={mutation.busy}
            onClick={() => {
              if (
                window.confirm(
                  `Permanently delete ${asset.name} and its live data?`,
                )
              )
                void mutation
                  .save('assets/' + asset.id, 'DELETE', {}, asset.version)
                  .catch(() => {});
            }}
          >
            Delete asset and photos
          </button>
        </details>
      )}
      <Feedback {...mutation} />
    </section>
  );
}
