import { useCallback, useEffect, useState } from 'react';
import type { EstateRecord } from '@quartermaster/contracts';
import { api, messageFor } from './api';
export type Page<T> = { items: T[]; nextCursor: string | null };
export function usePage<T>(path: string) {
  const [items, setItems] = useState<T[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const load = useCallback(
    async (more?: string) => {
      setBusy(true);
      try {
        const data = await api<Page<T>>(
          path +
            (more ? `${path.includes('?') ? '&' : '?'}cursor=${more}` : ''),
        );
        setItems((old) => (more ? [...old, ...data.items] : data.items));
        setCursor(data.nextCursor);
        setError('');
      } catch (e) {
        setError(messageFor(e));
      } finally {
        setBusy(false);
      }
    },
    [path],
  );
  useEffect(() => {
    setItems([]);
    void load();
  }, [load]);
  return {
    items,
    cursor,
    error,
    busy,
    reload: () => void load(),
    more: () => cursor && void load(cursor),
  };
}
export function PageControls({
  data,
}: {
  data: {
    cursor: string | null;
    busy: boolean;
    error: string;
    reload: () => void;
    more: () => unknown;
  };
}) {
  return (
    <div className="actions">
      <button type="button" onClick={data.reload} disabled={data.busy}>
        Refresh
      </button>
      {data.cursor && (
        <button type="button" onClick={data.more} disabled={data.busy}>
          Load more
        </button>
      )}
      {data.busy && <span role="status">Loading…</span>}
      {data.error && <p role="alert">{data.error}</p>}
    </div>
  );
}
export const title = (text: string) =>
  text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replaceAll('_', ' ')
    .replace(/^./, (c) => c.toUpperCase());
export function RecordSelect({
  base,
  kind,
  value,
  onChange,
  label,
}: {
  base: string;
  kind: string;
  value: string;
  onChange: (v: string) => void;
  label: string;
}) {
  const data = usePage<EstateRecord>(`${base}records/${kind}`);
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">None</option>
        {data.items.map((r) => (
          <option key={r.id} value={r.id}>
            {String(r.content.name ?? r.content.code ?? r.id)}
          </option>
        ))}
      </select>
      <PageControls data={data} />
    </label>
  );
}
export function downloadBlob(
  value: string | Blob,
  name: string,
  type = 'text/csv',
) {
  const url = URL.createObjectURL(
    typeof value === 'string' ? new Blob([value], { type }) : value,
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function toCsv(rows: Record<string, unknown>[]) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (v: unknown) => {
    let text = typeof v === 'object' ? JSON.stringify(v) : String(v ?? '');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return [keys, ...rows.map((r) => keys.map((k) => r[k]))]
    .map((row) => row.map(cell).join(','))
    .join('\r\n');
}
