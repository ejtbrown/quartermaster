import { useState } from 'react';
import { filterEstate } from '@quartermaster/domain';
import { demoAssets, demoTenantId } from './fixtures';

const statusLabels = {
  in_service: 'In service',
  needs_attention: 'Needs attention',
  out_of_service: 'Out of service',
} as const;

export function App() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(demoAssets[0]?.id);
  const assets = filterEstate(demoAssets, demoTenantId, query);
  const selected = assets.find((asset) => asset.id === selectedId) ?? assets[0];
  return (
    <div className="app-layout">
      <aside className="sidebar" aria-label="Workspace">
        <a className="brand" href="#main">
          <span className="brand-mark" aria-hidden="true">
            Q
          </span>{' '}
          Quartermaster
        </a>
        <div className="workspace">
          <span className="eyebrow">DEVELOPMENT WORKSPACE</span>
          <strong>Sample church</strong>
          <span>Synthetic data only</span>
        </div>
        <nav aria-label="Main navigation">
          <a className="nav-active" href="#estate" aria-current="page">
            Asset estate <span>04</span>
          </a>
        </nav>
        <div className="sidebar-note">
          <span className="eyebrow">BUILT FOR THE WHOLE ESTATE</span>
          <p>
            A clear picture of what you have, where it lives, and what needs
            your attention.
          </p>
        </div>
        <div className="environment">
          <span className="status-dot" /> Development preview · Ohio
        </div>
      </aside>
      <main id="main">
        <div className="notice" role="note">
          Foundation preview — sample records, no sign-in or asset persistence.
          Changes cannot be saved yet.
        </div>
        <header>
          <div>
            <p className="eyebrow">WORKSPACE / OVERVIEW</p>
            <h1>Your asset estate</h1>
            <p className="subtitle">
              Know what you have. See what needs attention.
            </p>
          </div>
          <span className="preview-label">Development</span>
        </header>
        <section className="summary-grid" aria-label="Estate summary">
          <article>
            <span>Assets recorded</span>
            <strong>4</strong>
            <small>Across two buildings</small>
          </article>
          <article>
            <span>Needs attention</span>
            <strong>2</strong>
            <small>Includes one out of service</small>
          </article>
          <article>
            <span>Asset classes</span>
            <strong>2</strong>
            <small>Air conditioners & appliances</small>
          </article>
        </section>
        <section
          id="estate"
          className="estate-panel"
          aria-label="Asset register"
        >
          <div className="register-heading">
            <div>
              <h2>Asset register</h2>
              <p>
                {assets.length} of {demoAssets.length} sample assets
              </p>
            </div>
            <label className="search">
              <span className="sr-only">
                Search assets by name, location, or nameplate data
              </span>
              <input
                type="search"
                placeholder="Search assets, locations, model…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <div className="register-layout">
            <div className="table-wrap">
              <table>
                <caption className="sr-only">
                  Synthetic asset register. Select an asset to inspect its
                  recorded details.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Asset / Location</th>
                    <th scope="col">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((asset) => (
                    <tr
                      key={asset.id}
                      className={selected?.id === asset.id ? 'selected' : ''}
                    >
                      <td>
                        <button
                          className="asset-button"
                          onClick={() => setSelectedId(asset.id)}
                          aria-pressed={selected?.id === asset.id}
                        >
                          {asset.name}
                        </button>
                        <span className="asset-location">{asset.location}</span>
                      </td>
                      <td>
                        <span className={`badge ${asset.status}`}>
                          {statusLabels[asset.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {assets.length === 0 && (
                <p className="empty" role="status">
                  No assets match “{query}”. Try a location or a shorter name.
                </p>
              )}
            </div>
            <aside className="detail" aria-label="Selected asset details">
              {selected ? (
                <>
                  <span className="eyebrow">ASSET DETAILS · SAMPLE</span>
                  <h2>{selected.name}</h2>
                  <dl>
                    <dt>Class</dt>
                    <dd>
                      {selected.assetClass === 'air_conditioner'
                        ? 'Air conditioner'
                        : 'Appliance'}
                    </dd>
                    <dt>Manufacturer</dt>
                    <dd>{selected.manufacturer ?? 'Not recorded'}</dd>
                    <dt>Model / serial</dt>
                    <dd>
                      {selected.model ?? 'Not recorded'} /{' '}
                      {selected.serialNumber ?? 'Not recorded'}
                    </dd>
                  </dl>
                  <h3>Field notes</h3>
                  <p>{selected.notes}</p>
                  <div className="detail-footer">
                    Human observations stay distinct from AI suggestions. No AI
                    interpretation is running in this preview.
                  </div>
                </>
              ) : (
                <p>Select a matching asset to view its details.</p>
              )}
            </aside>
          </div>
        </section>
        <footer>
          Quartermaster · Development foundation{' '}
          <span>qm.ejtbrown.com · Synthetic data only</span>
        </footer>
      </main>
    </div>
  );
}
