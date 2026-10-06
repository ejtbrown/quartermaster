import { createHash, randomUUID } from 'node:crypto';
import type { Capability } from '@quartermaster/contracts';
import type { Sql } from './database';
import type { Request } from './http';
import { Problem, header } from './http';
import type { Platform } from './platform';
import { audit, first, identifier } from './operations';
export interface FeatureContext {
  sql: Sql;
  actor: string;
  tenant: string;
  route: string;
  method: string;
  request: Request;
  params: URLSearchParams;
  cursor: string;
  requireCapability: (cap: Capability) => void;
  authenticatedAt: number;
  platform: Platform | undefined;
}
export const timestamp = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
export const recordColumns = `id,kind,asset_id AS "assetId",version,content,${timestamp('updated_at')} AS "updatedAt"`;
export const mediaColumns = `id,asset_id AS "assetId",conversation_id AS "conversationId",version,intent,state,width,height,sha256,observation,${timestamp('created_at')} AS "createdAt"`;
export const jobColumns = `id,kind,state,result,error_code AS "errorCode",${timestamp('created_at')} AS "createdAt"`;
export function platform(c: FeatureContext) {
  if (!c.platform) throw new Problem(503, 'platform_unavailable');
  return c.platform;
}
export function recent(c: FeatureContext) {
  if (c.authenticatedAt < Math.floor(Date.now() / 1000) - 900)
    throw new Problem(403, 'recent_sign_in_required');
}
export async function tenantLock(c: FeatureContext) {
  const row = first(
    await c.sql.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',
      ['estate:' + c.tenant],
    ),
  );
  if (!row.locked) throw new Problem(409, 'operation_in_progress');
}
export async function mutate(
  c: FeatureContext,
  input: unknown,
  kind: string,
  action: (id: string) => Promise<Record<string, unknown>>,
  read: (id: string) => Promise<Record<string, unknown>>,
) {
  const key = identifier(header(c.request, 'idempotency-key'));
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify([
        c.method,
        c.route,
        header(c.request, 'if-match') ?? null,
        input,
      ]),
    )
    .digest('hex');
  const lock = first(
    await c.sql.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked',
      [c.tenant + c.actor + key],
    ),
  );
  if (!lock.locked) throw new Problem(409, 'operation_in_progress');
  const [prior] = await c.sql.query<{ fingerprint: string; entity_id: string }>(
    'SELECT fingerprint,entity_id FROM qm.mutations WHERE id=$1::uuid',
    [key],
  );
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      throw new Problem(409, 'idempotency_conflict');
    return { item: await read(prior.entity_id), replayed: true };
  }
  const id = randomUUID(),
    item = await action(id),
    entity = typeof item.id === 'string' ? item.id : id;
  await c.sql.query(
    'INSERT INTO qm.mutations(tenant_id,actor_id,id,fingerprint,entity_id,entity_type) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6)',
    [c.tenant, c.actor, key, fingerprint, entity, kind],
  );
  return { item, replayed: false };
}
export async function queueJob(
  c: FeatureContext,
  id: string,
  kind: string,
  payload: Record<string, unknown>,
) {
  const row = first(
    await c.sql.query(
      `INSERT INTO qm.jobs(tenant_id,id,actor_id,kind,payload) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb) RETURNING ${jobColumns}`,
      [c.tenant, id, c.actor, kind, JSON.stringify(payload)],
    ),
  );
  // Queue signal before commit prevents a committed job from being lost if the
  // process dies before sending. Worker retries signals whose transaction has
  // not become visible, and harmlessly discards rolled-back signals.
  await platform(c).enqueue({ tenant: c.tenant, id, createdAt: Date.now() });
  return row;
}
export const readJob = (c: FeatureContext, id: string) =>
  c.sql
    .query(
      `SELECT ${jobColumns} FROM qm.jobs WHERE id=$1::uuid AND actor_id=$2::uuid`,
      [id, c.actor],
    )
    .then((rows) => first(rows));
export async function changed(c: FeatureContext, id: string, action: string) {
  await audit(c.sql, c.tenant, c.actor, id, action);
  if (c.platform) {
    const deadline = new Date();
    deadline.setUTCFullYear(deadline.getUTCFullYear() + 1);
    deadline.setUTCHours(23, 59, 59, 0);
    await c.platform.schedule(c.tenant, deadline.toISOString());
  }
}
