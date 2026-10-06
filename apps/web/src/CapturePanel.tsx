import { useEffect, useRef, useState } from 'react';
import type {
  AssetInput,
  CaptureProposal,
  Job,
  MaintenanceInput,
  Membership,
  ReadingInput,
} from '@quartermaster/contracts';
import { api, messageFor } from './api';
import { useSave, Feedback } from './Workspace';
import { AssetClassSelect, AssetDetailsEditor } from './AssetDetailsEditor';
import { JobStatus, PhotoGallery } from './PhotoGallery';
import { PageControls, usePage, title } from './estate-ui';
type Conversation = {
  id: string;
  version: number;
  draft: Partial<AssetInput>;
  proposal: CaptureProposal | null;
  review?: {
    maintenance: MaintenanceInput[];
    readings: ReadingInput[];
    components?: CaptureProposal['components'];
  };
  assetId: string | null;
  turns?: { id: string; role: string; content: string; createdAt: string }[];
};
const blank: AssetInput = {
  name: '',
  assetClass: 'air_conditioner',
  status: 'in_service',
  location: '',
  manufacturer: null,
  model: null,
  serialNumber: null,
  notes: '',
};
function VoiceInput({
  onAudio,
  onError,
}: {
  onAudio: (audio: string) => void;
  onError: (error: string) => void;
}) {
  const [recording, setRecording] = useState(false),
    [starting, setStarting] = useState(false);
  const current = useRef<{
      stream: MediaStream;
      context: AudioContext;
      node: AudioWorkletNode;
      source: MediaStreamAudioSourceNode;
      timer: ReturnType<typeof setTimeout>;
      chunks: Float32Array[];
      samples: number;
    } | null>(null),
    alive = useRef(true);
  const stop = (send: boolean) => {
    const value = current.current;
    if (!value) return;
    current.current = null;
    clearTimeout(value.timer);
    value.node.port.onmessage = null;
    value.stream.getTracks().forEach((t) => t.stop());
    value.source.disconnect();
    value.node.disconnect();
    void value.context.close();
    setRecording(false);
    if (!send) return;
    const joined = new Float32Array(value.samples);
    let offset = 0;
    for (const c of value.chunks) {
      joined.set(c, offset);
      offset += c.length;
    }
    const ratio = value.context.sampleRate / 16000,
      bytes = new Uint8Array(Math.floor(joined.length / ratio) * 2),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < bytes.length / 2; i++) {
      const position = i * ratio,
        index = Math.floor(position),
        fraction = position - index,
        sample =
          (joined[index] ?? 0) * (1 - fraction) +
          (joined[index + 1] ?? 0) * fraction;
      view.setInt16(
        i * 2,
        Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
        true,
      );
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 8192)
      binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    onAudio(btoa(binary));
  };
  useEffect(() => {
    alive.current = true;
    const interrupted = () => {
      if (document.hidden || !navigator.onLine) {
        stop(false);
        onError(
          'Recording discarded after an interruption. Tap Record when ready.',
        );
      }
    };
    document.addEventListener('visibilitychange', interrupted);
    window.addEventListener('offline', interrupted);
    return () => {
      alive.current = false;
      stop(false);
      document.removeEventListener('visibilitychange', interrupted);
      window.removeEventListener('offline', interrupted);
    };
  }, []);
  async function start() {
    setStarting(true);
    let stream: MediaStream | undefined, context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      context = new AudioContext();
      await context.audioWorklet.addModule(
        new URL('./capture-worklet.js', import.meta.url),
      );
      await context.resume();
      if (!alive.current) {
        stream.getTracks().forEach((t) => t.stop());
        await context.close();
        return;
      }
      const node = new AudioWorkletNode(context, 'foreground-capture'),
        source = context.createMediaStreamSource(stream);
      source.connect(node);
      node.connect(context.destination);
      const value = {
        stream,
        context,
        node,
        source,
        timer: setTimeout(() => stop(true), 20000),
        chunks: [] as Float32Array[],
        samples: 0,
      };
      current.current = value;
      node.port.onmessage = (e) => {
        if (current.current !== value) return;
        const remaining = Math.max(
            0,
            Math.floor(value.context.sampleRate * 20) - value.samples,
          ),
          chunk = (e.data as Float32Array).slice(0, remaining);
        value.chunks.push(chunk);
        value.samples += chunk.length;
      };
      setRecording(true);
    } catch {
      stream?.getTracks().forEach((t) => t.stop());
      if (context) void context.close();
      onError(
        'Microphone permission or recording is unavailable. You can type every answer.',
      );
    } finally {
      if (alive.current) setStarting(false);
    }
  }
  return (
    <div className="actions">
      {recording ? (
        <>
          <button onClick={() => stop(true)}>Stop and transcribe</button>
          <button onClick={() => stop(false)}>Discard recording</button>
          <span role="status">Recording — stops at 20 seconds</span>
        </>
      ) : (
        <button disabled={starting} onClick={() => void start()}>
          {starting ? 'Opening microphone…' : 'Record a voice answer'}
        </button>
      )}
    </div>
  );
}
export function CapturePanel({
  base,
  csrf,
  membership,
}: {
  base: string;
  csrf: string;
  membership: Membership;
}) {
  const list = usePage<Conversation>(base + 'conversations');
  const [selected, setSelected] = useState<Conversation | null>(null),
    [error, setError] = useState('');
  const mutation = useSave(base, csrf, list.reload);
  return (
    <section className="panel">
      <h1>Assisted asset capture</h1>
      <p>
        Stay online. AI organizes volunteered observations; it does not
        authorize work or direct hazardous inspections. People are responsible
        for safe work. Skip any question or photo you cannot safely answer.
      </p>
      {!selected && (
        <>
          <button
            className="primary"
            onClick={() =>
              void mutation
                .save('conversations', 'POST', { draft: {} })
                .then((r) => setSelected((r as { item: Conversation }).item))
                .catch(() => {})
            }
          >
            Start capture
          </button>
          <h2>Saved capture sessions</h2>
          <PageControls data={list} />
          {list.items.map((c) => (
            <div key={c.id}>
              <button
                key={c.id}
                onClick={() =>
                  void api<Conversation>(base + 'conversations/' + c.id)
                    .then(setSelected)
                    .catch((e) => setError(messageFor(e)))
                }
              >
                {c.draft.name || 'Unfinished capture'} · {c.id.slice(0, 8)}
              </button>
              <button
                onClick={() => {
                  if (
                    window.confirm(
                      'Delete this private capture and all its photos?',
                    )
                  )
                    void mutation
                      .save('conversations/' + c.id, 'DELETE', {}, c.version)
                      .catch(() => {});
                }}
              >
                Delete capture
              </button>
            </div>
          ))}
        </>
      )}
      {selected && (
        <>
          <CaptureSession
            key={selected.id}
            base={base}
            csrf={csrf}
            membership={membership}
            initial={selected}
          />
          <button
            onClick={() => {
              if (
                window.confirm(
                  'Leave capture? Only server-saved input will remain.',
                )
              ) {
                setSelected(null);
                list.reload();
              }
            }}
          >
            Back to saved captures
          </button>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {!selected && <Feedback {...mutation} />}
    </section>
  );
}
function CaptureSession({
  base,
  csrf,
  membership,
  initial,
}: {
  base: string;
  csrf: string;
  membership: Membership;
  initial: Conversation;
}) {
  const [conversation, setConversation] = useState(initial),
    [draft, setDraft] = useState<AssetInput>({ ...blank, ...initial.draft }),
    [text, setText] = useState(''),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(''),
    [speech, setSpeech] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [committed, setCommitted] = useState('');
  const [tasks, setTasks] = useState<MaintenanceInput[]>(
      initial.review?.maintenance ?? [],
    ),
    [readings, setReadings] = useState<ReadingInput[]>(
      initial.review?.readings ?? [],
    );
  const [components, setComponents] = useState<CaptureProposal['components']>(
    initial.review?.components ?? [],
  );
  const mutation = useSave(base, csrf, () => {});
  const route = 'conversations/' + initial.id;
  async function reload() {
    try {
      const next = await api<Conversation>(base + route);
      setConversation(next);
      if (next.proposal) {
        setConfirmed(false);
        if (speech && 'speechSynthesis' in window) {
          speechSynthesis.cancel();
          speechSynthesis.speak(
            new SpeechSynthesisUtterance(next.proposal.reply),
          );
        }
      }
      setError('');
    } catch (e) {
      setError(messageFor(e));
    }
  }
  useEffect(
    () => () => {
      if ('speechSynthesis' in window) speechSynthesis.cancel();
    },
    [],
  );
  const send = async () => {
    try {
      const r = (await mutation.save(
        route + '/turns',
        'POST',
        { text, draft },
        conversation.version,
      )) as { item: Job };
      setJob(r.item);
      setText('');
    } catch {
      /* Show feedback. */
    }
  };
  if (committed)
    return (
      <p role="status">
        Asset saved with the confirmed tasks, readings and photos. Asset ID:{' '}
        {committed}. It is now in your register.
      </p>
    );
  return (
    <div>
      <p>
        Capture session {conversation.id.slice(0, 8)} · version{' '}
        {conversation.version}
      </p>
      <button onClick={() => void reload()}>Refresh saved capture</button>
      <label>
        <input
          type="checkbox"
          checked={speech}
          onChange={(e) => {
            setSpeech(e.target.checked);
            if (!e.target.checked && 'speechSynthesis' in window)
              speechSynthesis.cancel();
          }}
        />
        Read assistant replies aloud (your device’s speech service may process
        text)
      </label>
      <div className="transcript" aria-live="polite">
        {[...(conversation.turns ?? [])].reverse().map((t) => (
          <p key={t.id}>
            <strong>{t.role === 'user' ? 'You' : 'Quartermaster'}:</strong>{' '}
            {t.content}
          </p>
        ))}
        {!conversation.turns?.length && (
          <p>
            What asset would you like to add? Tell me what you know, or fill in
            the details below.
          </p>
        )}
      </div>
      {conversation.proposal?.requestedPhoto && (
        <p>
          Suggested next photo: {title(conversation.proposal.requestedPhoto)}.
          Choose that purpose in Photos, or tell the assistant you need to skip
          it.
        </p>
      )}
      <p>
        Voice clips stay in memory until sent, then are transcribed without
        storing the recording. Transcript text expires after 15 days. Review the
        text before sending it to the assistant.
      </p>
      <VoiceInput
        onError={setError}
        onAudio={(pcm) =>
          void mutation
            .save(route + '/transcribe', 'POST', { pcm })
            .then((r) => {
              setText((r as { item: { transcript: string } }).item.transcript);
            })
            .catch(() => {})
        }
      />
      <label>
        Your answer
        <textarea
          maxLength={8000}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <button
        disabled={mutation.busy || !text.trim()}
        onClick={() => void send()}
      >
        Send answer
      </button>
      {job && (
        <JobStatus
          key={job.id}
          base={base}
          job={job}
          onDone={() => void reload()}
        />
      )}
      <PhotoGallery
        base={base}
        csrf={csrf}
        conversationId={initial.id}
        canWrite
        canDelete={membership.capabilities.includes('assets:delete')}
      />
      <h2>Review before saving</h2>
      {conversation.proposal && (
        <>
          <details>
            <summary>Latest AI proposal</summary>
            <pre>{JSON.stringify(conversation.proposal, null, 2)}</pre>
          </details>
          <button
            onClick={() => {
              if (
                !window.confirm(
                  'Apply the latest proposed fields, tasks and readings to the review form? This replaces the corresponding unsaved edits.',
                )
              )
                return;
              const p = conversation.proposal!;
              setComponents(p.components ?? []);
              setDraft((old) => ({
                ...old,
                ...Object.fromEntries(
                  Object.entries(p.fields).filter(([, v]) => v !== undefined),
                ),
              }));
              setTasks(p.maintenance.map((t) => ({ ...t, status: 'open' })));
              setReadings(
                p.readings.map((r) => ({
                  ...r,
                  observedAt: new Date().toISOString(),
                })),
              );
              setConfirmed(false);
            }}
          >
            Apply proposal to review form
          </button>
        </>
      )}
      <p>
        Correct uncertain nameplate text, dates, observations and units. You can
        finish manually without AI.
      </p>
      <div className="form-grid">
        {(
          [
            'name',
            'location',
            'manufacturer',
            'model',
            'serialNumber',
            'notes',
          ] as const
        ).map((k) => (
          <label key={k}>
            {title(k)}
            <input
              value={draft[k] ?? ''}
              maxLength={
                k === 'notes'
                  ? 4000
                  : k === 'location'
                    ? 240
                    : k === 'name'
                      ? 160
                      : 120
              }
              onChange={(e) => {
                setDraft((old) => ({ ...old, [k]: e.target.value }));
                setConfirmed(false);
              }}
            />
          </label>
        ))}
        <AssetClassSelect
          base={base}
          value={draft.assetClass}
          onChange={(assetClass) => {
            setDraft((old) => ({ ...old, assetClass }));
            setConfirmed(false);
          }}
        />
        <AssetDetailsEditor
          base={base}
          value={draft.details ?? {}}
          assetClass={draft.assetClass}
          canFinance={membership.capabilities.includes('finance:write')}
          onChange={(details) => {
            setDraft((old) => ({ ...old, details }));
            setConfirmed(false);
          }}
        />
      </div>
      <h3>Maintenance proposals</h3>
      {tasks.map((t, i) => (
        <div className="form-grid" key={i}>
          <label>
            Task
            <input
              value={t.title}
              onChange={(e) => {
                setTasks((old) =>
                  old.map((v, j) =>
                    j === i ? { ...v, title: e.target.value } : v,
                  ),
                );
                setConfirmed(false);
              }}
            />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={t.dueDate ?? ''}
              onChange={(e) => {
                setTasks((old) =>
                  old.map((v, j) =>
                    j === i ? { ...v, dueDate: e.target.value || null } : v,
                  ),
                );
                setConfirmed(false);
              }}
            />
          </label>
          <label>
            Task notes
            <textarea
              value={t.notes}
              onChange={(e) => {
                setTasks((old) =>
                  old.map((v, j) =>
                    j === i ? { ...v, notes: e.target.value } : v,
                  ),
                );
                setConfirmed(false);
              }}
            />
          </label>
          <button
            onClick={() => {
              setTasks((old) => old.filter((_, j) => j !== i));
              setConfirmed(false);
            }}
          >
            Remove proposal
          </button>
        </div>
      ))}
      {membership.capabilities.includes('maintenance:write') && (
        <button
          onClick={() => {
            setTasks((old) => [
              ...old,
              { title: '', dueDate: null, status: 'open', notes: '' },
            ]);
            setConfirmed(false);
          }}
        >
          Add maintenance task
        </button>
      )}
      <h3>Readings</h3>
      {readings.map((r, i) => (
        <div className="form-grid" key={i}>
          {(['label', 'value', 'unit', 'observedAt', 'notes'] as const).map(
            (k) => (
              <label key={k}>
                {title(k)}
                <input
                  type={k === 'value' ? 'number' : 'text'}
                  value={r[k]}
                  onChange={(e) => {
                    setReadings((old) =>
                      old.map((v, j) =>
                        i === j
                          ? {
                              ...v,
                              [k]:
                                k === 'value'
                                  ? Number(e.target.value)
                                  : e.target.value,
                            }
                          : v,
                      ),
                    );
                    setConfirmed(false);
                  }}
                />
              </label>
            ),
          )}
          <button
            onClick={() => {
              setReadings((old) => old.filter((_, j) => j !== i));
              setConfirmed(false);
            }}
          >
            Remove reading
          </button>
        </div>
      ))}
      <button
        onClick={() => {
          setReadings((old) => [
            ...old,
            {
              label: '',
              value: 0,
              unit: '',
              observedAt: new Date().toISOString(),
              notes: '',
            },
          ]);
          setConfirmed(false);
        }}
      >
        Add reading
      </button>
      <h3>Components and access constraints</h3>
      {components.map((component, i) => (
        <fieldset key={i}>
          <legend>Component {i + 1}</legend>
          {(['name', 'kind', 'accessConstraints', 'notes'] as const).map(
            (key) => (
              <label key={key}>
                {title(key)}
                <input
                  value={component[key]}
                  onChange={(e) => {
                    setComponents((old) =>
                      old.map((v, j) =>
                        j === i ? { ...v, [key]: e.target.value } : v,
                      ),
                    );
                    setConfirmed(false);
                  }}
                />
              </label>
            ),
          )}
          <button
            onClick={() => {
              setComponents((old) => old.filter((_, j) => j !== i));
              setConfirmed(false);
            }}
          >
            Remove component
          </button>
        </fieldset>
      ))}
      {membership.capabilities.includes('records:write') && (
        <button
          onClick={() => {
            setComponents((old) => [
              ...old,
              { name: '', kind: '', accessConstraints: '', notes: '' },
            ]);
            setConfirmed(false);
          }}
        >
          Add component
        </button>
      )}
      <div className="actions">
        <button
          disabled={mutation.busy}
          onClick={() =>
            void mutation
              .save(
                route,
                'PATCH',
                { draft, review: { maintenance: tasks, readings, components } },
                conversation.version,
              )
              .then((r) => setConversation((r as { item: Conversation }).item))
              .catch(() => {})
          }
        >
          Save draft details
        </button>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          I have reviewed the asset, photos, components, tasks and readings.
        </label>
        <button
          className="primary"
          disabled={!confirmed || mutation.busy}
          onClick={() =>
            void mutation
              .save(
                route + '/commit',
                'POST',
                {
                  asset: draft,
                  maintenance: tasks,
                  readings,
                  components,
                  confirmed: true,
                },
                conversation.version,
              )
              .then((r) =>
                setCommitted((r as { item: { id: string } }).item.id),
              )
              .catch(() => {})
          }
        >
          Create reviewed asset
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
      <Feedback {...mutation} />
    </div>
  );
}
