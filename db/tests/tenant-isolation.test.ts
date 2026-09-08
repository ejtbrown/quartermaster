import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA = '11111111-1111-4111-8111-111111111111';
const tenantB = '22222222-2222-4222-8222-222222222222';
const assetA = '33333333-3333-4333-8333-333333333333';
const assetB = '44444444-4444-4444-8444-444444444444';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    await readFile(
      new URL('../migrations/0001_asset_foundation.sql', import.meta.url),
      'utf8',
    ),
  );
  await db.query('INSERT INTO qm.tenants(id,name) VALUES ($1,$2),($3,$4)', [
    tenantA,
    'Synthetic A',
    tenantB,
    'Synthetic B',
  ]);
  await db.query(
    "INSERT INTO qm.assets(tenant_id,id,name,asset_class,status,location) VALUES ($1,$2,'AC A','air_conditioner','in_service','Roof'),($3,$4,'AC B','air_conditioner','in_service','Roof')",
    [tenantA, assetA, tenantB, assetB],
  );
  await db.exec('SET ROLE qm_app');
}, 30_000);
afterAll(async () => {
  await db?.close();
});

describe(
  'PostgreSQL row-level security in an isolated WASM engine',
  { concurrent: false },
  () => {
    it('denies unscoped access without trusting query predicates', async () => {
      expect((await db.query('SELECT * FROM qm.assets')).rows).toHaveLength(0);
    });
    it('exposes only the selected tenant', async () => {
      await db.query("SELECT set_config('qm.tenant_id', $1, false)", [tenantA]);
      expect((await db.query('SELECT name FROM qm.assets')).rows).toEqual([
        { name: 'AC A' },
      ]);
    });
    it('blocks cross-tenant writes and moving an asset across tenants', async () => {
      await expect(
        db.query(
          "INSERT INTO qm.assets(tenant_id,id,name,asset_class,status,location) VALUES ($1,$2,'Cross tenant','appliance','in_service','Kitchen')",
          [tenantB, assetA],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        db.query('UPDATE qm.assets SET tenant_id=$1 WHERE id=$2', [
          tenantB,
          assetA,
        ]),
      ).rejects.toThrow(/row-level security/);
      expect(
        (
          await db.query('DELETE FROM qm.assets WHERE id=$1 RETURNING id', [
            assetB,
          ])
        ).rows,
      ).toHaveLength(0);
    });
    it('supports version checks without overwriting stale edits', async () => {
      expect(
        (
          await db.query(
            'UPDATE qm.assets SET version=version+1 WHERE id=$1 AND version=1 RETURNING version',
            [assetA],
          )
        ).rows,
      ).toEqual([{ version: 2 }]);
      expect(
        (
          await db.query(
            'UPDATE qm.assets SET version=version+1 WHERE id=$1 AND version=1 RETURNING version',
            [assetA],
          )
        ).rows,
      ).toHaveLength(0);
    });
    it('atomically purges content and retains only deletion metadata', async () => {
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO qm.deletion_metadata(tenant_id,entity_id,entity_type,deleted_at,policy_version) VALUES ($1,$2,'asset',$3,'2026-09-07')",
          [tenantA, assetA, '2026-09-07T12:00:00Z'],
        );
        await tx.query('DELETE FROM qm.assets WHERE id=$1', [assetA]);
      });
      expect((await db.query('SELECT * FROM qm.assets')).rows).toHaveLength(0);
      const rows = (await db.query('SELECT * FROM qm.deletion_metadata')).rows;
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] as object).sort()).toEqual([
        'deleted_at',
        'entity_id',
        'entity_type',
        'policy_version',
        'tenant_id',
      ]);
      await expect(
        db.query('DELETE FROM qm.deletion_metadata'),
      ).rejects.toThrow(/permission denied/);
    });
    it('does not leak deletion metadata into another tenant', async () => {
      await db.query("SELECT set_config('qm.tenant_id', $1, false)", [tenantB]);
      expect(
        (await db.query('SELECT * FROM qm.deletion_metadata')).rows,
      ).toHaveLength(0);
      expect((await db.query('SELECT name FROM qm.assets')).rows).toEqual([
        { name: 'AC B' },
      ]);
    });
    it('hides expired audit records even before physical cleanup', async () => {
      await db.query(
        "INSERT INTO qm.audit_events(tenant_id,id,entity_id,action,occurred_at,expires_at) VALUES ($1,$2,$3,'asset.created',now()-interval '2 years',now()-interval '18 months')",
        [tenantB, '55555555-5555-4555-8555-555555555555', assetB],
      );
      expect(
        (await db.query('SELECT * FROM qm.audit_events')).rows,
      ).toHaveLength(0);
    });
    it('rejects audit retention beyond one year and in-place rewrites', async () => {
      await expect(
        db.query(
          "INSERT INTO qm.audit_events(tenant_id,id,entity_id,action,occurred_at,expires_at) VALUES ($1,$2,$3,'asset.created',now(),now()+interval '2 years')",
          [tenantB, '66666666-6666-4666-8666-666666666666', assetB],
        ),
      ).rejects.toThrow(/check constraint/);
      await expect(
        db.query("UPDATE qm.audit_events SET action='asset.deleted'"),
      ).rejects.toThrow(/permission denied/);
      await expect(db.query('DELETE FROM qm.audit_events')).rejects.toThrow(
        /permission denied/,
      );
    });
  },
);
