import { useEffect, useRef, useState } from 'react';
import type { Job, Media } from '@quartermaster/contracts';
import { MediaIntent } from '@quartermaster/contracts';
import { api, messageFor, ApiError } from './api';
import { useSave, Feedback } from './Workspace';
import { PageControls, title, usePage } from './estate-ui';
export function JobStatus({
  base,
  job: initial,
  onDone,
}: {
  base: string;
  job: Job;
  onDone: () => void;
}) {
  const [job, setJob] = useState(initial),
    [error, setError] = useState('');
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    const until = Date.now() + 180000;
    const poll = async () => {
      try {
        const next = await api<Job>(base + 'jobs/' + initial.id);
        if (cancelled) return;
        setJob(next);
        setError('');
        if (next.state === 'complete' || next.state === 'failed')
          done.current();
        else if (Date.now() < until)
          timer = setTimeout(() => void poll(), 3000);
        else setError('Still processing. Use Refresh to check again.');
      } catch (e) {
        if (!cancelled) setError(messageFor(e));
      }
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, initial.id]);
  return (
    <p role="status">
      {title(job.kind)}: {job.state}
      {job.errorCode ? ` — ${title(job.errorCode)}` : ''}
      {error && ` — ${error}`}
    </p>
  );
}
function Photo({
  base,
  csrf,
  media,
  canWrite,
  canDelete,
  after,
}: {
  base: string;
  csrf: string;
  media: Media;
  canWrite: boolean;
  canDelete: boolean;
  after: () => void;
}) {
  const [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [job, setJob] = useState<Job | null>(null);
  const mutation = useSave(base, csrf, after);
  useEffect(() => {
    let active = true;
    if (media.state === 'ready')
      void api<{ url: string }>(`${base}media/${media.id}/url`)
        .then((r) => {
          if (active) setUrl(r.url);
        })
        .catch((e) => {
          if (active) setError(messageFor(e));
        });
    return () => {
      active = false;
    };
  }, [base, media.id, media.version, media.state]);
  return (
    <article className="photo-card">
      {url && (
        <a href={url} target="_blank" rel="noreferrer">
          <img
            src={url}
            alt={title(media.intent)}
            loading="lazy"
            onError={() =>
              setError(
                'The private photo link may have expired. Refresh the photo to load it again.',
              )
            }
          />
        </a>
      )}
      {media.state === 'ready' && (
        <button
          onClick={() =>
            void api<{ url: string }>(`${base}media/${media.id}/url`)
              .then((r) => {
                setUrl(r.url);
                setError('');
              })
              .catch((e) => setError(messageFor(e)))
          }
        >
          Refresh photo
        </button>
      )}
      <p>
        {title(media.intent)} · {media.state}
      </p>
      {error && <p role="alert">{error}</p>}
      {media.observation && (
        <details>
          <summary>AI observation — verify before use</summary>
          <dl>
            {Object.entries(media.observation)
              .filter(([k]) =>
                [
                  'kind',
                  'confidence',
                  'manufacturer',
                  'model',
                  'serialNumber',
                  'description',
                ].includes(k),
              )
              .map(([k, v]) => (
                <div key={k}>
                  <dt>{title(k)}</dt>
                  <dd>{String(v ?? 'Not readable')}</dd>
                </div>
              ))}
          </dl>
        </details>
      )}
      {canWrite && (
        <>
          <label>
            Photo purpose
            <select
              value={media.intent}
              onChange={(e) =>
                void mutation
                  .save(
                    `media/${media.id}/intent`,
                    'PATCH',
                    { intent: e.target.value },
                    media.version,
                  )
                  .catch(() => {})
              }
            >
              {MediaIntent.options.map((v) => (
                <option key={v} value={v}>
                  {title(v)}
                </option>
              ))}
            </select>
          </label>
          {media.state === 'ready' && (
            <button
              disabled={mutation.busy}
              onClick={() =>
                void mutation
                  .save(`media/${media.id}/analyze`, 'POST', {})
                  .then((r) => setJob((r as { item: Job }).item))
                  .catch(() => {})
              }
            >
              Analyze image
            </button>
          )}
        </>
      )}
      {canDelete && (
        <button
          disabled={mutation.busy}
          onClick={() => {
            if (
              window.confirm(
                'Delete this photo and its live originals? Isolated backups expire within 90 days.',
              )
            )
              void mutation
                .save(`media/${media.id}`, 'DELETE', {}, media.version)
                .then((r) => setJob((r as { item: Job }).item))
                .catch(() => {});
          }}
        >
          Delete photo
        </button>
      )}
      {job && <JobStatus base={base} job={job} onDone={after} />}
      <Feedback {...mutation} />
    </article>
  );
}
export function PhotoGallery({
  base,
  csrf,
  assetId,
  conversationId,
  canWrite,
  canDelete,
}: {
  base: string;
  csrf: string;
  assetId?: string;
  conversationId?: string;
  canWrite: boolean;
  canDelete: boolean;
}) {
  const data = usePage<Media>(
    `${base}media?${assetId ? 'assetId=' + assetId : 'conversationId=' + conversationId}`,
  );
  const [file, setFile] = useState<File | null>(null),
    [intent, setIntent] = useState('whole_unit'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [job, setJob] = useState<Job | null>(null);
  const pending = useRef<{
    file: File;
    intent: string;
    grant: { id: string; url: string; fields: Record<string, string> };
    uploaded: boolean;
    expiresAt: number;
  } | null>(null);
  const mutation = useSave(base, csrf, () => {});
  async function upload() {
    if (!file || busy) return;
    setBusy(true);
    setError('');
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
        file.size > 12 * 1024 * 1024
      )
        throw new Error(
          'Choose a JPEG, PNG or WebP photo up to 12 MB. On iPhone, use the camera or export HEIC as JPEG.',
        );
      const sha256 = [
        ...new Uint8Array(
          await crypto.subtle.digest('SHA-256', await file.arrayBuffer()),
        ),
      ]
        .map((n) => n.toString(16).padStart(2, '0'))
        .join('');
      // Reuse the granted object identity through upload/completion failures.
      if (!pending.current) {
        const response = (await mutation.save('media/uploads', 'POST', {
          assetId: assetId ?? null,
          conversationId: conversationId ?? null,
          intent,
          contentType: file.type,
          bytes: file.size,
          sha256,
        })) as {
          item: { id: string; url: string; fields: Record<string, string> };
        };
        pending.current = {
          file,
          intent,
          grant: response.item,
          uploaded: false,
          expiresAt: Date.now() + 50000,
        };
      }
      if (pending.current.file !== file || pending.current.intent !== intent)
        throw new Error(
          'Retry the previous photo first, or reload to abandon that upload.',
        );
      if (!pending.current.uploaded && Date.now() > pending.current.expiresAt) {
        pending.current.grant = await api<typeof pending.current.grant>(
          `${base}media/${pending.current.grant.id}/renew`,
          { method: 'POST', headers: { 'x-csrf-token': csrf } },
        );
        pending.current.expiresAt = Date.now() + 50000;
      }
      const grant = pending.current.grant;
      if (!pending.current.uploaded) {
        const form = new FormData();
        Object.entries(grant.fields).forEach(([k, v]) => form.append(k, v));
        form.append('file', file);
        const response = await fetch(grant.url, {
          method: 'POST',
          body: form,
          credentials: 'omit',
          signal: AbortSignal.timeout(60000),
        });
        if (!response.ok)
          throw new Error(
            'The private upload was not accepted. Retry the same photo to renew its upload permission.',
          );
        pending.current.uploaded = true;
      }
      const result = (await mutation.save(
        `media/${grant.id}/complete`,
        'POST',
        {},
      )) as { item: Job };
      setJob(result.item);
      pending.current = null;
      setFile(null);
      data.reload();
    } catch (e) {
      setError(
        e instanceof Error && !(e instanceof ApiError)
          ? e.message
          : messageFor(e),
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Photos</h2>
      <p>
        Resized photos stay with the asset until deleted. Originals expire after
        15 days. Image suggestions never overwrite your data.
      </p>
      {canWrite && (
        <div className="form-grid">
          <label>
            Take or choose a photo
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
              }}
            />
          </label>
          <label>
            Purpose
            <select
              value={intent}
              disabled={busy}
              onChange={(e) => setIntent(e.target.value)}
            >
              {MediaIntent.options.map((v) => (
                <option key={v} value={v}>
                  {title(v)}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!file || busy} onClick={() => void upload()}>
            {busy ? 'Uploading…' : 'Upload photo'}
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <Feedback {...mutation} />
      {job && <JobStatus base={base} job={job} onDone={data.reload} />}
      <PageControls data={data} />
      {!data.busy && !data.items.length && <p>No photos yet.</p>}
      <div className="photo-grid">
        {data.items.map((media) => (
          <Photo
            key={media.id}
            base={base}
            csrf={csrf}
            media={media}
            canWrite={canWrite}
            canDelete={canDelete}
            after={data.reload}
          />
        ))}
      </div>
    </section>
  );
}
