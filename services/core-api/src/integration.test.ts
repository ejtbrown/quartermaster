import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { expect, it } from 'vitest';
import { migrate } from './migrations';
import { integration } from './integration';
import type { Database } from './database';

it('runs deployment checks with a non-superuser owner and cleans only its own fixtures', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      'CREATE ROLE test_migrator LOGIN CREATEROLE; GRANT CREATE ON DATABASE postgres TO test_migrator; GRANT CREATE,USAGE ON SCHEMA public TO test_migrator;',
    );
    function adapter(role: string): Database {
      return {
        transaction: (action) =>
          db.transaction(async (tx) => {
            await tx.exec(`SET LOCAL ROLE ${role}`);
            return action({
              query: async (q, v) => (await tx.query(q, v)).rows as never,
            });
          }),
      };
    }
    const owner = adapter('test_migrator');
    const files = await Promise.all(
      [
        '0001_asset_foundation.sql',
        '0002_authenticated_operations.sql',
        '0003_operator_rls_access.sql',
      ].map(async (name) => ({
        name,
        source: await readFile(
          new URL('../../../db/migrations/' + name, import.meta.url),
          'utf8',
        ),
      })),
    );
    await migrate(owner, files);
    await db.exec(
      'CREATE ROLE qm_runtime LOGIN INHERIT NOBYPASSRLS; GRANT qm_app TO qm_runtime;',
    );
    await owner.transaction(async (sql) => {
      await sql.query(
        "INSERT INTO qm.tenants(id,name) VALUES('11111111-1111-4111-8111-111111111111','Unrelated synthetic tenant')",
      );
    });
    await integration(owner, adapter('qm_runtime'));
    const remaining = await owner.transaction((sql) =>
      sql.query('SELECT name FROM qm.tenants'),
    );
    expect(remaining).toEqual([{ name: 'Unrelated synthetic tenant' }]);
    await adapter('qm_runtime').transaction(async (sql) => {
      expect(await sql.query('SELECT * FROM qm.tenants')).toEqual([]);
    });
  } finally {
    await db.close();
  }
}, 30000);
