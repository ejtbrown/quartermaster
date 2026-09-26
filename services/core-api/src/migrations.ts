import { createHash } from 'node:crypto';
import type { Database } from './database';

// Data API accepts one statement per call. Split repository migrations without
// breaking semicolons inside strings, comments or dollar-quoted function bodies.
export function statements(source: string): string[] {
  const result: string[] = [];
  let current = '',
    quote = '',
    dollar = '',
    line = false,
    block = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!,
      next = source[i + 1];
    if (line) {
      if (c === '\n') {
        line = false;
        current += '\n';
      }
      continue;
    }
    if (block) {
      if (c === '/' && next === '*') {
        block++;
        i++;
      } else if (c === '*' && next === '/') {
        block--;
        i++;
      }
      continue;
    }
    if (dollar) {
      if (source.startsWith(dollar, i)) {
        current += dollar;
        i += dollar.length - 1;
        dollar = '';
      } else current += c;
      continue;
    }
    if (quote) {
      current += c;
      if (c === quote) {
        if (next === quote) {
          current += next;
          i++;
        } else quote = '';
      }
      continue;
    }
    if (c === '-' && next === '-') {
      line = true;
      i++;
      current += ' ';
      continue;
    }
    if (c === '/' && next === '*') {
      block = 1;
      i++;
      current += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      current += c;
      continue;
    }
    if (c === '$') {
      const match = source.slice(i).match(/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/);
      if (match) {
        dollar = match[0];
        current += dollar;
        i += dollar.length - 1;
        continue;
      }
    }
    if (c === ';') {
      if (current.trim()) result.push(current.trim());
      current = '';
    } else current += c;
  }
  if (quote || dollar || block) throw new Error('Unterminated migration token');
  if (current.trim()) result.push(current.trim());
  return result.filter(
    (sql) => !['BEGIN', 'COMMIT'].includes(sql.toUpperCase()),
  );
}
export async function migrate(
  database: Database,
  migrations: { name: string; source: string }[],
) {
  return database.transaction(async (sql) => {
    const [lock] = await sql.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_xact_lock(81948231) AS acquired',
    );
    if (!lock?.acquired) throw new Error('Another migration is running');
    await sql.query(
      'CREATE TABLE IF NOT EXISTS public.qm_schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await sql.query('REVOKE ALL ON public.qm_schema_migrations FROM PUBLIC');
    const applied = await sql.query<{ name: string; checksum: string }>(
      'SELECT name,checksum FROM public.qm_schema_migrations ORDER BY name',
    );
    if (
      applied.some((row) => !migrations.some((file) => file.name === row.name))
    )
      throw new Error('Database contains an unknown migration');
    const changed: string[] = [];
    for (const file of migrations) {
      const checksum = createHash('sha256').update(file.source).digest('hex'),
        prior = applied.find((row) => row.name === file.name);
      if (prior) {
        if (prior.checksum !== checksum)
          throw new Error('Applied migration checksum changed');
        continue;
      }
      for (const [index, statement] of statements(file.source).entries()) {
        try {
          await sql.query(statement);
        } catch (error) {
          if (error instanceof Error)
            error.name += `:migration:${file.name}:statement:${index + 1}`;
          throw error;
        }
      }
      await sql.query(
        'INSERT INTO public.qm_schema_migrations(name,checksum) VALUES($1,$2)',
        [file.name, checksum],
      );
      changed.push(file.name);
    }
    return changed;
  });
}
