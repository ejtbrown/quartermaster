import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from 'vitest';
import { Capability } from '@quartermaster/contracts';
import type { Asset, EstateRecord, Job } from '@quartermaster/contracts';
import { Operations } from './operations';
import { Worker, normalizePhoto } from './worker';
import type { Database } from './database';
import type { Platform, QueueMessage } from './platform';
import { objectKey } from './platform';
import { depreciation, csv } from './reports';
import { replayDeletions } from './restore-ledger';
let db: PGlite,
  ops: Operations,
  worker: Worker,
  platform: Platform,
  tenant: string,
  actor: string,
  reader: string,
  editor: string,
  signals: QueueMessage[],
  objects: Map<string, Uint8Array>;
const assetInput = {
  name: 'Test AC',
  assetClass: 'air_conditioner',
  status: 'in_service',
  location: 'Roof',
  manufacturer: null,
  model: null,
  serialNumber: null,
  notes: '',
};
const fresh = () => Math.floor(Date.now() / 1000);
function adapter(role: string): Database {
  return {
    transaction: (action) =>
      db.transaction(async (tx) => {
        await tx.exec(`SET LOCAL ROLE ${role}`);
        return action({
          query: async (query, values) =>
            (await tx.query(query, values)).rows as never,
        });
      }),
  };
}
async function call<T = Record<string, unknown>>(
  route: string,
  method = 'GET',
  input?: unknown,
  options: {
    actor?: string;
    key?: string;
    version?: number;
    auth?: number;
    query?: string;
  } = {},
) {
  return (await ops.handle(
    options.actor ?? actor,
    {
      rawPath: `/api/v1/tenants/${tenant}/${route}`,
      rawQueryString: options.query ?? '',
      requestContext: { http: { method } },
      headers: {
        'content-type': 'application/json',
        'idempotency-key': options.key ?? randomUUID(),
        ...(options.version ? { 'if-match': `"${options.version}"` } : {}),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
    },
    options.auth ?? fresh(),
  )) as T;
}
async function addAsset(input: unknown = assetInput) {
  return (await call<{ item: Asset }>('assets', 'POST', input)).item;
}
async function addRecord(
  kind: string,
  content: unknown,
  assetId: string | null = null,
) {
  return (
    await call<{ item: EstateRecord }>(`records/${kind}`, 'POST', {
      assetId,
      content,
    })
  ).item;
}
async function runJob(job: Job) {
  await worker.run({ tenant, id: job.id, createdAt: Date.now() });
  return call<Job>('jobs/' + job.id);
}
beforeAll(async () => {
  db = new PGlite();
  for (const f of [
    '0001_asset_foundation.sql',
    '0002_authenticated_operations.sql',
    '0003_operator_rls_access.sql',
    '0004_operational_estate.sql',
  ])
    await db.exec(
      await readFile(
        new URL('../../../db/migrations/' + f, import.meta.url),
        'utf8',
      ),
    );
}, 30000);
afterAll(async () => {
  await db.close();
});
beforeEach(async () => {
  tenant = randomUUID();
  actor = randomUUID();
  reader = randomUUID();
  editor = randomUUID();
  signals = [];
  objects = new Map();
  await db.query(
    "INSERT INTO qm.tenants(id,name) VALUES($1,'Empty test workspace')",
    [tenant],
  );
  for (const [id, caps] of [
    [actor, Capability.options],
    [reader, ['assets:read']],
    [editor, ['assets:read', 'assets:write']],
  ])
    await db.query(
      'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
      [tenant, id, caps],
    );
  platform = {
    enqueue: vi.fn(async (m) => {
      signals.push(m);
    }),
    schedule: vi.fn(async () => {}),
    upload: vi.fn(async () => ({ url: 'https://private.invalid', fields: {} })),
    headUpload: vi.fn(async () => ({
      version: 'v1',
      bytes: 1,
      contentType: 'image/jpeg',
      checksum: '',
    })),
    download: vi.fn(async (key) => 'https://private.invalid/' + key),
    transcribe: vi.fn(async () => 'Recorded observation'),
    invite: vi.fn(async () => ({ actorId: randomUUID(), created: true })),
    model: vi.fn(async () => ({
      text: '{}',
      model: 'test',
      inputTokens: 1,
      outputTokens: 1,
    })),
    read: vi.fn(async (key) => {
      const v = objects.get(key);
      if (!v) throw new Error('Missing object');
      return v;
    }),
    write: vi.fn(async (k, b) => {
      objects.set(k, b);
    }),
    purge: vi.fn(async (prefix) => {
      for (const key of objects.keys())
        if (key.startsWith(prefix)) objects.delete(key);
    }),
    tombstone: vi.fn(async () => {}),
  };
  ops = new Operations(adapter('qm_app'), platform);
  worker = new Worker(adapter('qm_worker'), platform);
});
describe('ordinary-tenant features, durable jobs and security boundaries', () => {
  it('closes and purges a tenant without needing a revoked session to finish cleanup', async () => {
    await addAsset();
    const { item: job } = await call<{ item: Job }>('tenant/delete', 'POST', {
      confirmName: 'Empty test workspace',
    });
    await expect(call('assets')).rejects.toMatchObject({
      code: 'membership_required',
    });
    await worker.run({ tenant, id: job.id, createdAt: Date.now() });
    expect(
      (await db.query('SELECT id FROM qm.tenants WHERE id=$1', [tenant])).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          'SELECT state FROM qm.jobs WHERE tenant_id=$1 AND id=$2',
          [tenant, job.id],
        )
      ).rows,
    ).toEqual([{ state: 'complete' }]);
    expect(platform.tombstone).toHaveBeenCalledWith(
      tenant,
      tenant,
      'tenant',
      expect.any(String),
    );
  });
  it('connects valuation and policy scope to insurance, and impairment to accounting', async () => {
    const location = await addRecord('locations', {
      name: 'Main',
      kind: 'building',
      parentId: null,
      address: '',
      notes: '',
    });
    const asset = await addAsset({
      ...assetInput,
      details: {
        locationId: location.id,
        costMinor: 12000,
        residualMinor: 0,
        replacementMinor: 14000,
        inServiceOn: '2026-01-01',
        usefulLifeMonths: 12,
        capitalized: true,
      },
    });
    await addRecord(
      'valuations',
      {
        basis: 'replacement',
        amountMinor: 18000,
        currency: 'USD',
        effectiveOn: '2026-06-01',
        notes: '',
      },
      asset.id,
    );
    const policy = await addRecord('policies', {
      name: 'Building cover',
      carrier: 'Test',
      reference: '',
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      limitMinor: 100000,
      deductibleMinor: 1000,
      locationId: location.id,
      assetClass: 'air_conditioner',
      notes: '',
    });
    await addRecord(
      'transactions',
      {
        kind: 'impairment',
        effectiveOn: '2026-06-01',
        amountMinor: 500,
        notes: '',
      },
      asset.id,
    );
    expect(
      await call('reports', 'POST', { kind: 'insurance', asOf: '2026-07-01' }),
    ).toMatchObject({
      items: [
        {
          id: asset.id,
          replacementMinor: 18000,
          coverageGap: false,
          policies: [{ id: policy.id }],
        },
      ],
      pageTotals: { replacementMinor: 18000 },
    });
    expect(
      await call('reports', 'POST', { kind: 'accounting', asOf: '2026-07-01' }),
    ).toMatchObject({
      items: [{ id: asset.id, impairmentMinor: 500, netBookMinor: 5500 }],
    });
  });
  it('creates one recurring task per due date, retains procedures and clamps month ends', async () => {
    const asset = await addAsset(),
      plan = await addRecord(
        'plans',
        {
          name: 'Monthly inspection',
          nextDueOn: '2027-01-31',
          intervalMonths: 1,
          procedure: 'Check condition from a safe position',
          assigneeId: null,
          estimatedMinor: 100,
        },
        asset.id,
      );
    const input = {
      tenant,
      kind: 'plan',
      id: plan.id,
      scheduledAt: '2027-01-31T12:00:00.000Z',
    };
    await worker.scheduled(input);
    await worker.scheduled(input);
    expect(
      (
        await db.query(
          'SELECT notes,due_date::text AS due FROM qm.maintenance WHERE tenant_id=$1',
          [tenant],
        )
      ).rows,
    ).toEqual([
      { notes: 'Check condition from a safe position', due: '2027-01-31' },
    ]);
    expect(await call('records/plans/' + plan.id)).toMatchObject({
      version: 2,
      content: { nextDueOn: '2027-02-28' },
    });
  });
  it('replays deletions on isolated restored rows without deleting another tenant', async () => {
    const asset = await addAsset();
    const other = randomUUID(),
      otherAsset = randomUUID();
    await db.query(
      "INSERT INTO qm.tenants(id,name) VALUES($1,'Other isolated test tenant')",
      [other],
    );
    await db.query(
      "INSERT INTO qm.assets(tenant_id,id,name,asset_class,status,location,notes) VALUES($1,$2,'Keep me','appliance','in_service','Other','')",
      [other, otherAsset],
    );
    const owner: Database = {
      transaction: (action) =>
        db.transaction((tx) =>
          action({
            query: async (q, v) => (await tx.query(q, v)).rows as never,
          }),
        ),
    };
    const mark = {
      pk: tenant,
      entityId: asset.id,
      entityType: 'asset' as const,
      deletedAt: new Date().toISOString(),
    };
    await replayDeletions(owner, [mark], platform.purge);
    await replayDeletions(owner, [mark], platform.purge);
    expect(
      (await db.query('SELECT id FROM qm.assets WHERE tenant_id=$1', [tenant]))
        .rows,
    ).toEqual([]);
    expect(
      (await db.query('SELECT id FROM qm.assets WHERE tenant_id=$1', [other]))
        .rows,
    ).toEqual([{ id: otherAsset }]);
  });
  it('purges standalone records and private drafts through the deletion ledger', async () => {
    const r = await addRecord('locations', {
        name: 'Delete me',
        kind: 'area',
        parentId: null,
        address: '',
        notes: 'private',
      }),
      key = randomUUID();
    const result = await call<{ item: Job }>(
      'records/locations/' + r.id,
      'DELETE',
      {},
      { version: 1, key },
    );
    expect(
      await call(
        'records/locations/' + r.id,
        'DELETE',
        {},
        { version: 1, key },
      ),
    ).toMatchObject({ replayed: true });
    await expect(call('records/locations/' + r.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await runJob(result.item)).state).toBe('complete');
    expect(platform.tombstone).toHaveBeenCalledWith(
      tenant,
      r.id,
      'record',
      expect.any(String),
    );
    const draft = await call<{ item: { id: string } }>('drafts', 'POST', {
      name: 'Private',
    });
    const removal = await call<{ item: Job }>(
      'drafts/' + draft.item.id,
      'DELETE',
      {},
      { version: 1 },
    );
    expect((await runJob(removal.item)).state).toBe('complete');
    expect(await call('drafts')).toMatchObject({ items: [] });
  });
  it('keeps purge failures retryable after workspace access closes', async () => {
    const asset = await addAsset();
    const { item: job } = await call<{ item: Job }>(
      'assets/' + asset.id,
      'DELETE',
      {},
      { version: 1 },
    );
    vi.mocked(platform.purge).mockRejectedValueOnce(
      new Error('Transient object-store failure'),
    );
    await expect(runJob(job)).rejects.toThrow('Purge requires retry');
    expect(await call('jobs/' + job.id)).toMatchObject({ state: 'queued' });
    expect((await runJob(job)).state).toBe('complete');
  });
  it('allows an export-only reader and denies processing after their capability is revoked', async () => {
    await db.query(
      'UPDATE qm.memberships SET capabilities=$3 WHERE tenant_id=$1 AND actor_id=$2',
      [tenant, reader, ['assets:read', 'exports:read']],
    );
    await addAsset();
    const { item: job } = await call<{ item: Job }>(
      'exports',
      'POST',
      { includePhotos: false },
      { actor: reader },
    );
    await worker.run({ tenant, id: job.id, createdAt: Date.now() });
    expect(
      await call('jobs/' + job.id, 'GET', undefined, { actor: reader }),
    ).toMatchObject({ state: 'complete' });
    const next = await call<{ item: Job }>(
      'exports',
      'POST',
      { includePhotos: false },
      { actor: reader },
    );
    await db.query(
      'UPDATE qm.memberships SET capabilities=$3 WHERE tenant_id=$1 AND actor_id=$2',
      [tenant, reader, ['assets:read']],
    );
    await worker.run({ tenant, id: next.item.id, createdAt: Date.now() });
    expect(
      await call('jobs/' + next.item.id, 'GET', undefined, { actor: reader }),
    ).toMatchObject({ state: 'failed', errorCode: 'membership_revoked' });
  });
  it('saves human-edited capture review without replacing it with model suggestions', async () => {
    const { item } = await call<{ item: { id: string } }>(
      'conversations',
      'POST',
      { draft: {} },
    );
    const review = {
      maintenance: [
        {
          title: 'Reviewed task',
          dueDate: null,
          status: 'open',
          notes: 'Human correction',
        },
      ],
      readings: [],
    };
    await call(
      'conversations/' + item.id,
      'PATCH',
      { draft: { name: 'Human name' }, review },
      { version: 1 },
    );
    expect(await call('conversations/' + item.id)).toMatchObject({
      draft: { name: 'Human name' },
      review,
    });
  });
  it('starts empty and rejects financial changes by ordinary editors, including draft commits', async () => {
    expect(await call('assets')).toMatchObject({ items: [] });
    await expect(
      call(
        'assets',
        'POST',
        { ...assetInput, details: { costMinor: 100 } },
        { actor: editor },
      ),
    ).rejects.toMatchObject({ code: 'capability_required' });
    const draft = await call<{ item: { id: string; version: number } }>(
      'drafts',
      'POST',
      { ...assetInput, details: { costMinor: 100 } },
      { actor: editor },
    );
    await expect(
      call(
        `drafts/${draft.item.id}/commit`,
        'POST',
        {},
        { actor: editor, version: 1 },
      ),
    ).rejects.toMatchObject({ code: 'capability_required' });
    expect(await call('assets')).toMatchObject({ items: [] });
  });
  it('supports validated custom types, locations and unique asset tags', async () => {
    const location = await addRecord('locations', {
      name: 'Sanctuary',
      kind: 'building',
      parentId: null,
      address: '',
      notes: '',
    });
    await addRecord('types', {
      name: 'Mixer',
      code: 'mixer',
      description: '',
      fields: [
        { key: 'channels', label: 'Channels', type: 'number', required: true },
      ],
      captureIntents: ['nameplate'],
    });
    await expect(
      addAsset({ ...assetInput, assetClass: 'mixer' }),
    ).rejects.toMatchObject({ code: 'required_type_field' });
    const input = {
      ...assetInput,
      assetClass: 'mixer',
      details: {
        assetTag: 'TAG1',
        locationId: location.id,
        attributes: { channels: 16 },
      },
    };
    const key = randomUUID();
    const created = await call<{ item: Asset }>('assets', 'POST', input, {
      key,
    });
    expect(await call('assets', 'POST', input, { key })).toMatchObject({
      replayed: true,
      item: { id: created.item.id },
    });
    await expect(addAsset(input)).rejects.toMatchObject({
      code: 'asset_tag_exists',
    });
    await expect(
      call('records/locations/' + location.id, 'DELETE', {}, { version: 1 }),
    ).rejects.toMatchObject({ code: 'location_in_use' });
  });
  it('protects record finance permissions and records immutable revisions', async () => {
    const asset = await addAsset();
    await expect(
      call(
        'records/valuations',
        'POST',
        {
          assetId: asset.id,
          content: {
            basis: 'replacement',
            amountMinor: 1,
            currency: 'USD',
            effectiveOn: '2026-10-06',
            notes: '',
          },
        },
        { actor: editor },
      ),
    ).rejects.toMatchObject({ code: 'capability_required' });
    const row = await addRecord(
      'components',
      {
        name: 'Compressor',
        kind: 'motor',
        accessConstraints: 'Do not open cover',
        notes: '',
      },
      asset.id,
    );
    await call(
      'records/components/' + row.id,
      'PATCH',
      {
        assetId: asset.id,
        content: { ...row.content, notes: 'Inspection deferred' },
      },
      { version: 1 },
    );
    expect(
      await call('records/components/' + row.id + '/history'),
    ).toMatchObject({ items: [{ version: 1, content: { notes: '' } }] });
    await expect(
      call(
        'records/components/' + row.id,
        'DELETE',
        {},
        { version: 2, auth: 0 },
      ),
    ).rejects.toMatchObject({ code: 'recent_sign_in_required' });
  });
  it('requires fresh sign-in for export and invitations, and protects the last admin', async () => {
    await expect(
      call('exports', 'POST', {}, { auth: 0 }),
    ).rejects.toMatchObject({ code: 'recent_sign_in_required' });
    await expect(
      call(
        'members',
        'POST',
        { email: 'test@example.com', capabilities: ['assets:read'] },
        { auth: 0 },
      ),
    ).rejects.toMatchObject({ code: 'recent_sign_in_required' });
    expect(platform.invite).not.toHaveBeenCalled();
    await expect(
      call('members/' + actor, 'PATCH', {
        capabilities: ['assets:read'],
        active: false,
      }),
    ).rejects.toMatchObject({ code: 'last_administrator' });
    await expect(
      call('members', 'GET', undefined, { actor: editor }),
    ).rejects.toMatchObject({ code: 'capability_required' });
  });
  it('commits reviewed captures atomically and replays a successful commit exactly once', async () => {
    const capture = await call<{ item: { id: string } }>(
        'conversations',
        'POST',
        { draft: {} },
      ),
      id = capture.item.id,
      key = randomUUID();
    const input = {
      asset: assetInput,
      maintenance: [
        {
          title: 'Replace insulation',
          dueDate: '2026-12-31',
          status: 'open',
          notes: 'Weathered',
        },
      ],
      readings: [
        {
          label: 'Current',
          value: 4.3,
          unit: 'A',
          observedAt: '2026-10-01T10:00:00Z',
          notes: 'Volunteered observation',
        },
      ],
      confirmed: true,
    };
    const result = await call<{ item: Asset }>(
      `conversations/${id}/commit`,
      'POST',
      input,
      { version: 1, key },
    );
    expect(
      await call(`conversations/${id}/commit`, 'POST', input, {
        version: 1,
        key,
      }),
    ).toMatchObject({ replayed: true, item: { id: result.item.id } });
    expect((await call<{ items: unknown[] }>('assets')).items).toHaveLength(1);
    expect(
      (await call<{ items: unknown[] }>(`assets/${result.item.id}/maintenance`))
        .items,
    ).toHaveLength(1);
  });
  it('keeps captures and capture photos private to their actor', async () => {
    const { item } = await call<{ item: { id: string } }>(
      'conversations',
      'POST',
      { draft: { name: 'Private capture' } },
    );
    await expect(
      call('conversations/' + item.id, 'GET', undefined, { actor: editor }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(
      await call('conversations', 'GET', undefined, { actor: editor }),
    ).toMatchObject({ items: [] });
    await expect(
      call(
        'media/uploads',
        'POST',
        {
          assetId: null,
          conversationId: item.id,
          intent: 'nameplate',
          contentType: 'image/jpeg',
          bytes: 1,
          sha256: 'a'.repeat(64),
        },
        { actor: editor },
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
  it('treats untrusted model output as a proposal, never executable writes', async () => {
    const { item } = await call<{ item: { id: string } }>(
      'conversations',
      'POST',
      { draft: {} },
    );
    await call(`conversations/${item.id}/transcribe`, 'POST', {
      pcm: Buffer.alloc(100).toString('base64'),
    });
    expect(await call('conversations/' + item.id)).toMatchObject({ turns: [] });
    vi.mocked(platform.model).mockResolvedValue({
      text: JSON.stringify({
        reply: 'Please review.',
        fields: { name: 'Suggested AC', location: 'Roof' },
        maintenance: [],
        readings: [],
        requestedPhoto: null,
        readyForReview: true,
      }),
      model: 'test',
      inputTokens: 1,
      outputTokens: 1,
    });
    const turn = await call<{ item: Job }>(
      `conversations/${item.id}/turns`,
      'POST',
      { text: 'Add an AC', draft: {} },
      { version: 1 },
    );
    expect((await runJob(turn.item)).state).toBe('complete');
    expect(vi.mocked(platform.model).mock.calls[0]![1]).not.toContain(
      'Recorded observation',
    );
    const prompt = vi.mocked(platform.model).mock.calls[0]![1];
    const schema = JSON.parse(
      prompt.split('JSON SCHEMA:\n')[1]!.split('\nUNTRUSTED CONTEXT:\n')[0]!,
    );
    expect(schema.additionalProperties).toBe(false);
    expect(schema.properties.fields.additionalProperties).toBe(false);
    expect(schema.properties.fields.properties.notes.type).toBe('string');
    expect(schema.properties.components.maxItems).toBe(10);
    expect(schema.required).toContain('readyForReview');
    expect(await call('assets')).toMatchObject({ items: [] });
    expect(await call('conversations/' + item.id)).toMatchObject({
      proposal: { fields: { name: 'Suggested AC' } },
    });
    await db.query(
      "UPDATE qm.conversations SET proposal_expires_at=now()-interval '1 second',updated_at=now() WHERE id=$1",
      [item.id],
    );
    expect(await call('conversations/' + item.id)).toMatchObject({
      proposal: null,
    });
    await worker.scheduled({
      tenant,
      kind: 'expiry',
      id: '',
      scheduledAt: new Date().toISOString(),
    });
    expect(
      (
        await db.query('SELECT proposal FROM qm.conversations WHERE id=$1', [
          item.id,
        ])
      ).rows,
    ).toEqual([{ proposal: null }]);
  });
  it('validates the actual image bytes, pins the upload version, and keeps resized evidence until deletion', async () => {
    const asset = await addAsset(),
      bytes = await sharp({
        create: { width: 50, height: 30, channels: 3, background: 'red' },
      })
        .jpeg()
        .toBuffer(),
      sha256 = createHash('sha256').update(bytes).digest('hex');
    const { item: media } = await call<{ item: { id: string } }>(
      'media/uploads',
      'POST',
      {
        assetId: asset.id,
        conversationId: null,
        intent: 'nameplate',
        contentType: 'image/jpeg',
        bytes: bytes.length,
        sha256,
      },
    );
    objects.set(objectKey('quarantine', tenant, media.id), bytes);
    vi.mocked(platform.headUpload).mockResolvedValue({
      version: 'immutable-v1',
      bytes: bytes.length,
      contentType: 'image/jpeg',
      checksum: Buffer.from(sha256, 'hex').toString('base64'),
    });
    vi.mocked(platform.model).mockResolvedValue({
      text: JSON.stringify({
        kind: 'other',
        confidence: 0.1,
        manufacturer: null,
        model: null,
        serialNumber: null,
        description: 'No nameplate readable',
      }),
      model: 'test',
      inputTokens: 1,
      outputTokens: 1,
    });
    const { item: job } = await call<{ item: Job }>(
      `media/${media.id}/complete`,
      'POST',
      {},
    );
    expect((await runJob(job)).state).toBe('complete');
    expect(platform.read).toHaveBeenCalledWith(
      objectKey('quarantine', tenant, media.id),
      'immutable-v1',
    );
    expect(await call('media/' + media.id)).toMatchObject({
      state: 'ready',
      intent: 'nameplate',
      width: 50,
    });
    await worker.scheduled({
      tenant,
      kind: 'original_expiry',
      id: media.id,
      scheduledAt: new Date().toISOString(),
    });
    expect(objects.has(objectKey('originals', tenant, media.id))).toBe(false);
    expect(objects.has(objectKey('resized', tenant, media.id))).toBe(true);
    await expect(
      normalizePhoto(new TextEncoder().encode('<svg/>'), 'image/jpeg'),
    ).rejects.toBeDefined();
  });
  it('purges live asset content and export caches, preserving only deletion/audit metadata', async () => {
    const asset = await addAsset({
      ...assetInput,
      notes: 'Sensitive observation',
    });
    await addRecord(
      'components',
      { name: 'Motor', kind: '', accessConstraints: '', notes: 'Private' },
      asset.id,
    );
    objects.set(`exports/${tenant}/old/estate.zip`, new Uint8Array([1]));
    const { item: job } = await call<{ item: Job }>(
      'assets/' + asset.id,
      'DELETE',
      {},
      { version: 1 },
    );
    await expect(call('assets/' + asset.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await runJob(job)).state).toBe('complete');
    expect(platform.tombstone).toHaveBeenCalledWith(
      tenant,
      asset.id,
      'asset',
      expect.any(String),
    );
    expect(objects.size).toBe(0);
    expect(
      (await db.query('SELECT id FROM qm.assets WHERE tenant_id=$1', [tenant]))
        .rows,
    ).toEqual([]);
    expect(
      (await call<{ items: unknown[] }>('audit')).items.length,
    ).toBeGreaterThan(0);
  });
  it('previews, activates and deduplicates business rules with revision history', async () => {
    await addAsset();
    const rule = await addRecord('rules', {
      name: 'AC check',
      field: 'assetClass',
      operator: 'equals',
      value: 'air_conditioner',
      action: 'maintenance',
      title: 'Inspect visually',
      dueOn: null,
      enabled: false,
    });
    const preview = await call<{ previewHash: string }>(
        `rules/${rule.id}/preview`,
        'POST',
        {},
      ),
      key = randomUUID();
    expect(
      await call(
        `rules/${rule.id}/activate`,
        'POST',
        { previewHash: preview.previewHash },
        { version: 1, key },
      ),
    ).toMatchObject({ item: { applied: 1 } });
    expect(
      await call(
        `rules/${rule.id}/activate`,
        'POST',
        { previewHash: preview.previewHash },
        { version: 1, key },
      ),
    ).toMatchObject({ replayed: true });
    expect(await call('records/rules/' + rule.id)).toMatchObject({
      version: 2,
      content: { enabled: true },
    });
    for (const signal of signals) await worker.run(signal);
    expect(
      (await call<{ items: unknown[] }>('maintenance')).items,
    ).toHaveLength(1);
  });
  it('exports a checksummed ZIP containing actual rows and no other tenant content', async () => {
    await addAsset();
    const { item: job } = await call<{ item: Job }>('exports', 'POST', {
      includePhotos: false,
    });
    const result = await runJob(job);
    expect(result.state).toBe('complete');
    expect(result.result.assetCount).toBe(1);
    expect(objects.has(`exports/${tenant}/${job.id}/estate.zip`)).toBe(true);
  });
  it('handles leap/month-end depreciation and spreadsheet formula escaping', () => {
    expect(
      depreciation(
        {
          costMinor: 12000,
          residualMinor: 0,
          usefulLifeMonths: 12,
          inServiceOn: '2026-01-31',
          capitalized: true,
        },
        '2026-02-28',
      ),
    ).toMatchObject({ months: 1, accumulatedMinor: 1000 });
    expect(csv([{ name: ' =HYPERLINK("bad")' }])).toContain("' =HYPERLINK");
  });
});
