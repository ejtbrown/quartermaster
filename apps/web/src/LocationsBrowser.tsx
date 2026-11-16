import { useEffect, useState } from 'react';
import type { EstateRecord } from '@quartermaster/contracts';
import { api, messageFor } from './api';
import { destination, useNavigation } from './navigation';

export function LocationsBrowser({ base }: { base: string }) {
  const { go } = useNavigation();
  const [locations, setLocations] = useState<EstateRecord[]>([]);
  const [busy, setBusy] = useState(true),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError('');
    // Hierarchy is only presented after all pages resolve. Never mistake the
    // first page for the complete set of parents or children.
    void (async () => {
      const all: EstateRecord[] = [];
      let cursor: string | null = null;
      do {
        const page: { items: EstateRecord[]; nextCursor: string | null } =
          await api(
            base + 'records/locations' + (cursor ? '?cursor=' + cursor : ''),
            { signal: controller.signal },
          );
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor && !controller.signal.aborted);
      if (!controller.signal.aborted) setLocations(all);
    })()
      .catch((e) => {
        if (!controller.signal.aborted) setError(messageFor(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [base, revision]);
  const byId = new Map(locations.map((r) => [r.id, r]));
  const breadcrumb = (record: EstateRecord) => {
    const names = [String(record.content.name)],
      seen = new Set([record.id]);
    let parent = record.content.parentId;
    while (typeof parent === 'string' && !seen.has(parent)) {
      seen.add(parent);
      const entry = byId.get(parent);
      if (!entry) {
        names.unshift('Unavailable parent');
        break;
      }
      names.unshift(String(entry.content.name));
      parent = entry.content.parentId;
    }
    return names.join(' / ');
  };
  return (
    <section className="panel location-browser">
      <h1>Browse locations</h1>
      <p>
        Find a site, building, floor or area, then view assets recorded at that
        exact location. Parent locations do not include their descendants.
      </p>
      <button onClick={() => setRevision((n) => n + 1)} disabled={busy}>
        Refresh location hierarchy
      </button>
      {busy && <p role="status">Loading the location hierarchy…</p>}
      {error && (
        <p role="alert">{error} Retry with Refresh location hierarchy.</p>
      )}
      {!busy &&
        !error &&
        (!locations.length ? (
          <p>No locations yet. Add a location below to organize your estate.</p>
        ) : (
          <ul className="location-list">
            {[...locations]
              .sort((a, b) => breadcrumb(a).localeCompare(breadcrumb(b)))
              .map((record) => (
                <li key={record.id}>
                  <span>{String(record.content.kind)}</span>
                  <a
                    href={destination('Assets', { locationId: record.id })}
                    onClick={(event) => {
                      event.preventDefault();
                      void go(destination('Assets', { locationId: record.id }));
                    }}
                  >
                    {breadcrumb(record)}
                  </a>
                </li>
              ))}
          </ul>
        ))}
    </section>
  );
}
