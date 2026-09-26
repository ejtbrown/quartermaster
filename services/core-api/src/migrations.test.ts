import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { migrate, statements } from './migrations';
import type { Database } from './database';
it('splits only executable statement boundaries', () => {
  expect(
    statements(
      "-- comment;\nBEGIN; SELECT 'a;''b'; /* outer /* nested */ ; */ CREATE FUNCTION f() RETURNS text AS $f$ SELECT ';'; $f$ LANGUAGE sql; COMMIT;",
    ),
  ).toEqual([
    "SELECT 'a;''b'",
    "CREATE FUNCTION f() RETURNS text AS $f$ SELECT ';'; $f$ LANGUAGE sql",
  ]);
  expect(() => statements("SELECT 'unfinished")).toThrow('Unterminated');
});
it('runs the operator migration path transactionally, verifies checksums and is repeatable', async () => {
  const db = new PGlite();
  try {
    const adapter: Database = {
      transaction: (action) =>
        db.transaction((tx) =>
          action({
            query: async (q, v) => (await tx.query(q, v)).rows as never,
          }),
        ),
    };
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
    expect(await migrate(adapter, files)).toEqual(
      files.map((file) => file.name),
    );
    expect(await migrate(adapter, files)).toEqual([]);
    await expect(
      migrate(adapter, [
        { ...files[0]!, source: files[0]!.source + '\n-- tamper' },
        files[1]!,
        files[2]!,
      ]),
    ).rejects.toThrow('checksum');
    await expect(
      migrate(adapter, [
        ...files,
        {
          name: '0004_bad.sql',
          source:
            'CREATE TABLE qm.should_rollback(id int); SELECT missing_function();',
        },
      ]),
    ).rejects.toThrow();
    expect(
      (await db.query("SELECT to_regclass('qm.should_rollback') AS name")).rows,
    ).toEqual([{ name: null }]);
  } finally {
    await db.close();
  }
}, 30000);
