import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Asset, Draft, Maintenance, Reading } from '@quartermaster/contracts';
import type { Database } from './database';
import { Operations } from './operations';
import type { Request } from './http';

// Operator-only. Fresh IDs captured here, never supplied by a caller. No Cognito
// users or browser sessions are created. Cleanup is limited to this run's rows.
export async function integration(owner: Database, runtime: Database) {
  const tenantA = randomUUID(),
    tenantB = randomUUID(),
    actorA = randomUUID(),
    actorB = randomUUID();
  const marker = 'Synthetic deployment check ' + randomUUID();
  let seeded = false;
  console.log(
    JSON.stringify({ integrationTenants: [tenantA, tenantB], temporary: true }),
  );
  const ops = new Operations(runtime);
  const input = {
    name: 'Synthetic roof unit',
    assetClass: 'air_conditioner',
    status: 'in_service',
    location: 'Synthetic roof NW',
    manufacturer: 'Test',
    model: 'ZYX',
    serialNumber: 'SYNTHETIC',
    notes: 'Integration fixture only',
  };
  const request = (
    tenant: string,
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ): Request => ({
    rawPath: `/api/v1/tenants/${tenant}/${route}`,
    requestContext: { http: { method } },
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const call = (
    route: string,
    method = 'GET',
    body?: unknown,
    headers: Record<string, string> = {},
  ) => ops.handle(actorA, request(tenantA, route, method, body, headers));
  try {
    await owner.transaction(async (sql) => {
      await sql.query(
        'INSERT INTO qm.tenants(id,name,synthetic) VALUES($1::uuid,$3,true),($2::uuid,$3,true)',
        [tenantA, tenantB, marker],
      );
      for (const [tenant, actor] of [
        [tenantA, actorA],
        [tenantB, actorB],
      ])
        await sql.query(
          `INSERT INTO qm.memberships(tenant_id,actor_id,capabilities)
        VALUES($1::uuid,$2::uuid,ARRAY['assets:read','assets:write','maintenance:write','audit:read'])`,
          [tenant!, actor!],
        );
    });
    seeded = true;
    assert.deepEqual(
      (await ops.memberships(actorA)).map((m) => m.tenantId),
      [tenantA],
    );
    const key = { 'idempotency-key': randomUUID() };
    const asset = Asset.parse(
      ((await call('assets', 'POST', input, key)) as { item: unknown }).item,
    );
    const retry = (await call('assets', 'POST', input, key)) as {
      item: unknown;
      replayed: boolean;
    };
    assert.equal(Asset.parse(retry.item).id, asset.id);
    assert.equal(retry.replayed, true);
    await assert.rejects(
      call('assets', 'POST', { ...input, name: 'Different' }, key),
      { code: 'idempotency_conflict' },
    );
    const updated = (await call(
      `assets/${asset.id}`,
      'PATCH',
      { ...input, status: 'needs_attention' },
      { 'if-match': '"1"' },
    )) as { item: unknown };
    assert.equal(Asset.parse(updated.item).version, 2);
    await assert.rejects(
      call(`assets/${asset.id}`, 'PATCH', input, { 'if-match': '"1"' }),
      { code: 'version_conflict' },
    );
    await assert.rejects(ops.handle(actorB, request(tenantA, 'assets')), {
      code: 'membership_required',
    });
    assert.deepEqual(
      (
        (await ops.handle(actorB, request(tenantB, 'assets'))) as {
          items: unknown[];
        }
      ).items,
      [],
    );
    await assert.rejects(
      ops.handle(actorB, request(tenantB, `assets/${asset.id}`)),
      { code: 'not_found' },
    );
    const task = {
      title: 'Replace synthetic insulation',
      dueDate: '2026-12-31',
      status: 'open',
      notes: 'Synthetic work only',
    };
    const maintenance = Maintenance.parse(
      (
        (await call(`assets/${asset.id}/maintenance`, 'POST', task)) as {
          item: unknown;
        }
      ).item,
    );
    assert.equal(maintenance.dueDate, task.dueDate);
    await call(
      `maintenance/${maintenance.id}`,
      'PATCH',
      { ...task, status: 'completed' },
      { 'if-match': '"1"' },
    );
    const observation = {
      label: 'Synthetic current',
      value: 4.3,
      unit: 'A',
      observedAt: '2026-09-24T12:00:00.000Z',
      notes: '',
    };
    const reading = Reading.parse(
      (
        (await call(`assets/${asset.id}/readings`, 'POST', observation)) as {
          item: unknown;
        }
      ).item,
    );
    assert.equal(reading.value, 4.3);
    assert.equal(reading.observedAt, observation.observedAt);
    const draft = Draft.parse(
      ((await call('drafts', 'POST', input)) as { item: unknown }).item,
    );
    const commitKey = { 'idempotency-key': randomUUID(), 'if-match': '"1"' };
    const committed = Asset.parse(
      (
        (await call(`drafts/${draft.id}/commit`, 'POST', {}, commitKey)) as {
          item: unknown;
        }
      ).item,
    );
    assert.equal(
      Asset.parse(
        (
          (await call(`drafts/${draft.id}/commit`, 'POST', {}, commitKey)) as {
            item: unknown;
          }
        ).item,
      ).id,
      committed.id,
    );
    assert.deepEqual(await call('summary'), {
      assets: 2,
      needsAttention: 1,
      openTasks: 0,
      overdueTasks: 0,
    });
    await runtime.transaction(async (sql) => {
      await sql.query(
        "SELECT set_config('qm.actor_id',$1,true),set_config('qm.tenant_id',$2,true)",
        [actorA, tenantB],
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
        assert.deepEqual(await sql.query(`SELECT * FROM qm.${table}`), []);
    });
    await assert.rejects(
      runtime.transaction(async (sql) => {
        await sql.query(
          "SELECT set_config('qm.actor_id',$1,true),set_config('qm.tenant_id',$2,true)",
          [actorA, tenantA],
        );
        await sql.query(
          "UPDATE qm.assets SET name='Should roll back' WHERE id=$1::uuid",
          [asset.id],
        );
        throw new Error('expected_rollback');
      }),
      { message: 'expected_rollback' },
    );
    assert.equal(
      Asset.parse(await call(`assets/${asset.id}`)).name,
      input.name,
    );
    await owner.transaction(async (sql) => {
      await sql.query(
        'UPDATE qm.memberships SET active=false WHERE tenant_id=$1::uuid AND actor_id=$2::uuid',
        [tenantA, actorA],
      );
    });
    await assert.rejects(call('assets'), { code: 'membership_required' });
    console.log(
      'Aurora integration passed: tenant/role isolation, JSON/dates, assets/tasks/readings/drafts, retry/version guards, rollback and revocation.',
    );
  } finally {
    if (seeded)
      await owner.transaction(async (sql) => {
        const tenants = await sql.query(
          'SELECT id FROM qm.tenants WHERE id IN ($1::uuid,$2::uuid) AND name=$3 AND synthetic FOR UPDATE',
          [tenantA, tenantB, marker],
        );
        assert.equal(
          tenants.length,
          2,
          'Fixture cleanup ownership check failed; do not widen scope',
        );
        for (const table of [
          'mutations',
          'audit_events',
          'drafts',
          'readings',
          'maintenance',
          'assets',
          'memberships',
        ])
          await sql.query(
            `DELETE FROM qm.${table} WHERE tenant_id IN ($1::uuid,$2::uuid)`,
            [tenantA, tenantB],
          );
        await sql.query(
          'DELETE FROM qm.tenants WHERE id IN ($1::uuid,$2::uuid)',
          [tenantA, tenantB],
        );
        assert.deepEqual(
          await sql.query(
            'SELECT id FROM qm.tenants WHERE id IN ($1::uuid,$2::uuid)',
            [tenantA, tenantB],
          ),
          [],
        );
      });
    if (seeded)
      console.log(
        'Removed only this run’s temporary synthetic fixtures; no users or invitations were created.',
      );
  }
}
