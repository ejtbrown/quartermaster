import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { Operations } from './operations';
import type { Database, Sql } from './database';
import type { Request } from './http';
const tenantA = '11111111-1111-4111-8111-111111111111',
  tenantB = '22222222-2222-4222-8222-222222222222';
const actorA = '33333333-3333-4333-8333-333333333333',
  actorB = '44444444-4444-4444-8444-444444444444',
  reader = '55555555-5555-4555-8555-555555555555';
let db: PGlite, ops: Operations;
const asset = {
  name: 'Rooftop AC',
  assetClass: 'air_conditioner',
  status: 'in_service',
  location: 'Main building / NW roof',
  manufacturer: 'Test',
  model: 'ZYX',
  serialNumber: '1234',
  notes: 'Rounded cover screws',
};
function request(
  route: string,
  method = 'GET',
  input?: unknown,
  headers: Record<string, string> = {},
  tenant = tenantA,
): Request {
  return {
    rawPath: `/api/v1/tenants/${tenant}/${route}`,
    requestContext: { http: { method } },
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...headers,
    },
    ...(input !== undefined ? { body: JSON.stringify(input) } : {}),
  };
}
async function call(
  route: string,
  method = 'GET',
  input?: unknown,
  headers: Record<string, string> = {},
) {
  return (await ops.handle(actorA, request(route, method, input, headers))) as {
    item: Record<string, unknown>;
    items: Record<string, unknown>[];
    nextCursor: string | null;
    replayed: boolean;
  };
}
beforeAll(async () => {
  db = new PGlite();
  for (const file of [
    '0001_asset_foundation.sql',
    '0002_authenticated_operations.sql',
  ])
    await db.exec(
      await readFile(
        new URL('../../../db/migrations/' + file, import.meta.url),
        'utf8',
      ),
    );
  await db.query('INSERT INTO qm.tenants(id,name) VALUES($1,$2),($3,$4)', [
    tenantA,
    'Synthetic A',
    tenantB,
    'Synthetic B',
  ]);
  const caps = [
    'assets:read',
    'assets:write',
    'maintenance:write',
    'audit:read',
  ];
  for (const [tenant, actor, capabilities] of [
    [tenantA, actorA, caps],
    [tenantB, actorB, caps],
    [tenantA, reader, ['assets:read']],
  ])
    await db.query(
      'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1,$2,$3)',
      [tenant, actor, capabilities],
    );
  const adapter: Database = {
    transaction: (action) =>
      db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE qm_app');
        const sql: Sql = {
          query: async (query, values) =>
            (await tx.query(query, values)).rows as never,
        };
        return action(sql);
      }),
  };
  ops = new Operations(adapter);
}, 30000);
afterAll(async () => {
  await db?.close();
});
describe(
  'real PostgreSQL operational transactions and RLS',
  { concurrent: false },
  () => {
    it('resolves only current memberships and denies a forged tenant', async () => {
      expect((await ops.memberships(actorA)).map((m) => m.tenantId)).toEqual([
        tenantA,
      ]);
      await expect(
        ops.handle(actorA, request('assets', 'GET', undefined, {}, tenantB)),
      ).rejects.toMatchObject({ code: 'membership_required' });
    });
    it('creates once across retries, audits atomically, rejects changed payload reuse', async () => {
      const headers = { 'idempotency-key': randomUUID() };
      const result = await call('assets', 'POST', asset, headers),
        retry = await call('assets', 'POST', asset, headers);
      expect(retry.item.id).toBe(result.item.id);
      expect(retry.replayed).toBe(true);
      expect((await call('assets')).items).toHaveLength(1);
      const audit = (await call('audit')).items;
      expect(audit).toHaveLength(1);
      expect(JSON.stringify(audit)).not.toContain('Rounded');
      await expect(
        call('assets', 'POST', { ...asset, name: 'Different' }, headers),
      ).rejects.toMatchObject({ code: 'idempotency_conflict' });
      expect(
        (
          (await ops.handle(
            actorB,
            request('assets', 'GET', undefined, {}, tenantB),
          )) as { items: unknown[] }
        ).items,
      ).toEqual([]);
    });
    it('protects readers at both service and SQL layers; cannot grant membership', async () => {
      await expect(
        ops.handle(reader, request('assets', 'POST', asset)),
      ).rejects.toMatchObject({ code: 'capability_required' });
      await db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE qm_app');
        await tx.query(
          "SELECT set_config('qm.actor_id',$1,true),set_config('qm.tenant_id',$2,true)",
          [reader, tenantA],
        );
        expect(
          (await tx.query("UPDATE qm.assets SET name='forged' RETURNING id"))
            .rows,
        ).toEqual([]);
        expect((await tx.query('SELECT * FROM qm.audit_events')).rows).toEqual(
          [],
        );
      });
      await expect(
        db.transaction(async (tx) => {
          await tx.exec('SET LOCAL ROLE qm_app');
          await tx.query('UPDATE qm.memberships SET active=true');
        }),
      ).rejects.toThrow(/permission denied/);
    });
    it('prevents stale updates and requires a version', async () => {
      const id = (await call('assets')).items[0]!.id;
      expect(
        (
          await call(
            `assets/${id}`,
            'PATCH',
            { ...asset, status: 'needs_attention' },
            { 'if-match': '"1"' },
          )
        ).item.version,
      ).toBe(2);
      await expect(
        call(`assets/${id}`, 'PATCH', asset, { 'if-match': '"1"' }),
      ).rejects.toMatchObject({ code: 'version_conflict' });
      await expect(call(`assets/${id}`, 'PATCH', asset)).rejects.toMatchObject({
        code: 'version_required',
      });
    });
    it('adds maintenance and observations, tracks completion and estate totals', async () => {
      const id = (await call('assets')).items[0]!.id;
      const task = {
        title: 'Replace weathered tubing insulation',
        dueDate: '2026-12-31',
        status: 'open',
        notes: 'Check access first',
      };
      const created = await call(`assets/${id}/maintenance`, 'POST', task);
      await call(
        `maintenance/${created.item.id}`,
        'PATCH',
        { ...task, status: 'completed' },
        { 'if-match': '"1"' },
      );
      expect((await call(`assets/${id}/maintenance`)).items[0]!.status).toBe(
        'completed',
      );
      const reading = {
        label: 'Compressor current',
        value: 4.3,
        unit: 'A',
        observedAt: '2026-09-24T12:00:00.000Z',
        notes: 'Human-reported',
      };
      await call(`assets/${id}/readings`, 'POST', reading);
      expect((await call(`assets/${id}/readings`)).items[0]).toMatchObject(
        reading,
      );
      expect(await ops.handle(actorA, request('summary'))).toMatchObject({
        assets: 1,
        needsAttention: 1,
        openTasks: 0,
      });
      await expect(
        ops.handle(
          actorB,
          request(`assets/${id}/maintenance`, 'POST', task, {}, tenantB),
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
    it('saves private durable drafts and commits to an asset exactly once', async () => {
      const draft = await call('drafts', 'POST', asset);
      const headers = { 'if-match': '"1"', 'idempotency-key': randomUUID() };
      const result = await call(
        `drafts/${draft.item.id}/commit`,
        'POST',
        {},
        headers,
      );
      expect(
        (await call(`drafts/${draft.item.id}/commit`, 'POST', {}, headers)).item
          .id,
      ).toBe(result.item.id);
      expect((await call('drafts')).items).toEqual([]);
      expect((await call('assets')).items).toHaveLength(2);
    });
    it('rolls back invalid drafts, forbids deletion and fails closed on real-data tenants', async () => {
      const draft = await call('drafts', 'POST', { name: 'Incomplete' });
      await expect(
        call(
          `drafts/${draft.item.id}/commit`,
          'POST',
          {},
          { 'if-match': '"1"' },
        ),
      ).rejects.toMatchObject({ code: 'invalid_fields' });
      expect((await call('drafts')).items).toHaveLength(1);
      await expect(
        call('assets/' + randomUUID(), 'DELETE'),
      ).rejects.toMatchObject({ code: 'purge_policy_pending' });
      await db.query('UPDATE qm.tenants SET synthetic=false WHERE id=$1', [
        tenantB,
      ]);
      await expect(
        ops.handle(actorB, request('assets', 'GET', undefined, {}, tenantB)),
      ).rejects.toMatchObject({ code: 'pilot_not_enabled' });
    });
    it('revocation takes effect without waiting for a web session to expire', async () => {
      await db.query(
        'UPDATE qm.memberships SET active=false WHERE actor_id=$1',
        [reader],
      );
      expect(await ops.memberships(reader)).toEqual([]);
      await expect(ops.handle(reader, request('assets'))).rejects.toMatchObject(
        { code: 'membership_required' },
      );
    });
    it('rejects owner/master credentials in the runtime adapter', async () => {
      const unsafe = new Operations({
        transaction: (action) =>
          db.transaction(async (tx) =>
            action({
              query: async (q, v) => (await tx.query(q, v)).rows as never,
            }),
          ),
      });
      await expect(unsafe.memberships(actorA)).rejects.toMatchObject({
        code: 'database_role_unsafe',
      });
    });
    it('enforces request limits, strict schemas and parameterized literal searches', async () => {
      await expect(
        call('assets', 'POST', { ...asset, tenantId: tenantB }),
      ).rejects.toMatchObject({ code: 'invalid_fields' });
      await expect(
        call('assets', 'POST', { ...asset, notes: 'x'.repeat(17000) }),
      ).rejects.toMatchObject({ code: 'request_too_large' });
      const search = request('assets');
      search.rawQueryString = new URLSearchParams({
        q: "' OR true --",
      }).toString();
      expect(
        ((await ops.handle(actorA, search)) as { items: unknown[] }).items,
      ).toEqual([]);
      search.rawQueryString = 'cursor=not-a-uuid';
      await expect(ops.handle(actorA, search)).rejects.toMatchObject({
        code: 'invalid_identifier',
      });
    });
    it('bounds pagination without repeating records', async () => {
      for (let i = 0; i < 52; i++)
        await db.query(
          "INSERT INTO qm.assets(tenant_id,id,name,asset_class,status,location) VALUES($1,$2,$3,'appliance','in_service','Kitchen')",
          [tenantA, randomUUID(), `Synthetic pagination ${i}`],
        );
      const first = await call('assets');
      expect(first.items).toHaveLength(50);
      expect(first.nextCursor).toBeTruthy();
      const next = request('assets');
      next.rawQueryString = 'cursor=' + first.nextCursor;
      const second = (await ops.handle(actorA, next)) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      expect(second.items).toHaveLength(4);
      expect(second.nextCursor).toBeNull();
      expect(
        new Set([
          ...first.items.map((a) => a.id),
          ...second.items.map((a) => a.id),
        ]).size,
      ).toBe(54);
    });
    it('RLS rejects arbitrary tenant context even when query filters are omitted', async () => {
      await db.transaction(async (tx) => {
        await tx.exec('SET LOCAL ROLE qm_app');
        await tx.query(
          "SELECT set_config('qm.actor_id',$1,true),set_config('qm.tenant_id',$2,true)",
          [actorB, tenantA],
        );
        for (const table of [
          'assets',
          'maintenance',
          'readings',
          'drafts',
          'mutations',
          'audit_events',
          'deletion_metadata',
        ])
          expect((await tx.query(`SELECT * FROM qm.${table}`)).rows).toEqual(
            [],
          );
      });
    });
  },
);
