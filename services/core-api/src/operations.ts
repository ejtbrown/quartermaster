import { createHash, randomUUID } from 'node:crypto';
import {
  AssetInput,
  DraftInput,
  Identifier,
  MaintenanceInput,
  ReadingInput,
} from '@quartermaster/contracts';
import type { Capability, Membership } from '@quartermaster/contracts';
import type { Database, Sql } from './database';
import { Problem, header } from './http';
import type { Request } from './http';

const assetColumns = `id, tenant_id AS "tenantId", version, name, asset_class AS "assetClass", status, location,
  manufacturer, model, serial_number AS "serialNumber", notes,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
const maintenanceColumns = `id, asset_id AS "assetId", version, title, due_date::text AS "dueDate", status, notes,
  to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
const readingColumns = `id, asset_id AS "assetId", label, value, unit, notes,
  to_char(observed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "observedAt"`;
const draftColumns = `id, version, content, to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
const membershipSql = `SELECT m.tenant_id AS "tenantId", t.name, to_json(m.capabilities) AS capabilities, t.synthetic
  FROM qm.memberships m JOIN qm.tenants t ON t.id=m.tenant_id ORDER BY t.id LIMIT 101`;
function identifier(value: unknown) {
  const parsed = Identifier.safeParse(value);
  if (!parsed.success) throw new Problem(400, 'invalid_identifier');
  return parsed.data;
}
function body(request: Request): unknown {
  const text = request.isBase64Encoded
    ? Buffer.from(request.body ?? '', 'base64').toString('utf8')
    : (request.body ?? '');
  if (Buffer.byteLength(text) > 16000)
    throw new Problem(413, 'request_too_large');
  if (
    header(request, 'content-type')?.split(';')[0]?.trim() !==
    'application/json'
  )
    throw new Problem(415, 'json_required');
  try {
    return JSON.parse(text);
  } catch {
    throw new Problem(400, 'invalid_json');
  }
}
function parse<T>(
  schema: {
    safeParse(input: unknown): { success: true; data: T } | { success: false };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Problem(422, 'invalid_fields');
  return result.data;
}
function version(request: Request) {
  const value = header(request, 'if-match');
  if (!value || !/^"[1-9][0-9]{0,8}"$/.test(value))
    throw new Problem(428, 'version_required');
  return Number(value.slice(1, -1));
}
function first<T>(rows: T[], status = 404, code = 'not_found'): T {
  if (!rows[0]) throw new Problem(status, code);
  return rows[0];
}
async function context(sql: Sql, actorId: string, tenantId?: string) {
  await sql.query(
    "SELECT set_config('qm.actor_id',$1,true), set_config('qm.tenant_id',$2,true), set_config('statement_timeout','4000',true), set_config('lock_timeout','1000',true)",
    [actorId, tenantId ?? ''],
  );
  const [role] = await sql.query<{
    safe: boolean;
  }>(`SELECT NOT r.rolsuper AND NOT r.rolbypassrls AND
    c.relowner <> r.oid AND NOT pg_has_role(current_user,c.relowner,'MEMBER') AS safe
    FROM pg_roles r JOIN pg_class c ON c.oid='qm.assets'::regclass WHERE r.rolname=current_user`);
  if (!role?.safe) throw new Problem(503, 'database_role_unsafe');
}
async function audit(
  sql: Sql,
  tenant: string,
  actor: string,
  entity: string,
  action: string,
) {
  await sql.query(
    `INSERT INTO qm.audit_events(tenant_id,id,entity_id,actor_id,action,expires_at)
    VALUES ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,now()+interval '1 year')`,
    [tenant, randomUUID(), entity, actor, action],
  );
}
async function createAsset(
  sql: Sql,
  tenant: string,
  id: string,
  input: AssetInput,
) {
  return first(
    await sql.query(
      `INSERT INTO qm.assets(tenant_id,id,name,asset_class,status,location,manufacturer,model,serial_number,notes)
    VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${assetColumns}`,
      [
        tenant,
        id,
        input.name,
        input.assetClass,
        input.status,
        input.location,
        input.manufacturer,
        input.model,
        input.serialNumber,
        input.notes,
      ],
    ),
  );
}
function page(rows: Record<string, unknown>[]) {
  const items = rows.slice(0, 50);
  return { items, nextCursor: rows.length > 50 ? items.at(-1)!.id : null };
}
export class Operations {
  constructor(private database: Database) {}
  async memberships(actorId: string) {
    return this.database.transaction(async (sql) => {
      await context(sql, actorId);
      const memberships = await sql.query<Membership>(membershipSql);
      if (memberships.length > 100) throw new Problem(409, 'membership_limit');
      return memberships;
    });
  }
  async handle(actorId: string, request: Request) {
    const parts = request.rawPath?.match(/^\/api\/v1\/tenants\/([^/]+)\/(.*)$/);
    if (!parts) throw new Problem(404, 'not_found');
    const tenant = identifier(parts[1]),
      route = parts[2]!,
      method = request.requestContext?.http?.method;
    const params = new URLSearchParams(request.rawQueryString);
    const cursor = params.has('cursor')
      ? identifier(params.get('cursor'))
      : '00000000-0000-0000-0000-000000000000';
    const query = params.get('q')?.trim() ?? '';
    if (query.length > 160) throw new Problem(400, 'search_too_long');
    const status = params.get('status') ?? '';
    if (
      status &&
      !['in_service', 'needs_attention', 'out_of_service'].includes(status)
    )
      throw new Problem(400, 'invalid_status');
    return this.database.transaction(async (sql) => {
      await context(sql, actorId, tenant);
      const membership = (await sql.query<Membership>(membershipSql)).find(
        (item) => item.tenantId === tenant,
      );
      if (!membership) throw new Problem(403, 'membership_required');
      if (!membership.synthetic) throw new Problem(403, 'pilot_not_enabled');
      const requireCapability = (capability: Capability) => {
        if (!membership.capabilities.includes(capability))
          throw new Problem(403, 'capability_required');
      };
      requireCapability('assets:read');
      const assetRoute = route.match(
        /^assets\/([^/]+)(?:\/(maintenance|readings))?$/,
      );
      const assetId = assetRoute ? identifier(assetRoute[1]) : undefined;
      const sub = assetRoute?.[2];
      const maintenanceRoute = route.match(/^maintenance\/([^/]+)$/);
      const draftRoute = route.match(/^drafts\/([^/]+)(\/commit)?$/);
      if (method === 'GET') {
        if (route === 'assets')
          return page(
            await sql.query(
              `SELECT ${assetColumns} FROM qm.assets WHERE id > $1::uuid
          AND ($2='' OR position(lower($2) in lower(concat_ws(' ',name,location,manufacturer,model,serial_number,notes)))>0)
          AND ($3='' OR status=$3) ORDER BY id LIMIT 51`,
              [cursor, query, status],
            ),
          );
        if (assetId && !sub)
          return first(
            await sql.query(
              `SELECT ${assetColumns} FROM qm.assets WHERE id=$1::uuid`,
              [assetId],
            ),
          );
        if (assetId && sub) {
          first(
            await sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
              assetId,
            ]),
          );
          return page(
            await sql.query(
              `SELECT ${sub === 'maintenance' ? maintenanceColumns : readingColumns}
            FROM qm.${sub} WHERE asset_id=$1::uuid AND id > $2::uuid ORDER BY id LIMIT 51`,
              [assetId, cursor],
            ),
          );
        }
        if (route === 'summary')
          return first(
            await sql.query(`SELECT
          (SELECT count(*)::int FROM qm.assets) AS assets,
          (SELECT count(*)::int FROM qm.assets WHERE status <> 'in_service') AS "needsAttention",
          (SELECT count(*)::int FROM qm.maintenance WHERE status <> 'completed') AS "openTasks",
          (SELECT count(*)::int FROM qm.maintenance WHERE status <> 'completed' AND due_date < (now() AT TIME ZONE 'UTC')::date) AS "overdueTasks"`),
          );
        if (route === 'drafts') {
          requireCapability('assets:write');
          return page(
            await sql.query(
              `SELECT ${draftColumns} FROM qm.drafts WHERE id>$1::uuid ORDER BY id LIMIT 51`,
              [cursor],
            ),
          );
        }
        if (route === 'audit') {
          requireCapability('audit:read');
          return page(
            await sql.query(
              `SELECT id, entity_id AS "entityId", actor_id AS "actorId", action,
            to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "occurredAt"
            FROM qm.audit_events WHERE id>$1::uuid ORDER BY id LIMIT 51`,
              [cursor],
            ),
          );
        }
        throw new Problem(404, 'not_found');
      }
      if (method === 'DELETE') throw new Problem(409, 'purge_policy_pending');
      if (method !== 'POST' && method !== 'PATCH')
        throw new Problem(405, 'method_not_allowed');
      const isAssetCreate = route === 'assets' && method === 'POST';
      const isAssetUpdate = assetId && !sub && method === 'PATCH';
      const isMaintenance =
        (assetId && sub === 'maintenance' && method === 'POST') ||
        (maintenanceRoute && method === 'PATCH');
      const isReading = assetId && sub === 'readings' && method === 'POST';
      const isDraftSave =
        (route === 'drafts' && method === 'POST') ||
        (draftRoute && !draftRoute[2] && method === 'PATCH');
      const isDraftCommit = draftRoute && draftRoute[2] && method === 'POST';
      if (
        !isAssetCreate &&
        !isAssetUpdate &&
        !isMaintenance &&
        !isReading &&
        !isDraftSave &&
        !isDraftCommit
      )
        throw new Problem(404, 'not_found');
      requireCapability(isMaintenance ? 'maintenance:write' : 'assets:write');
      const key = identifier(header(request, 'idempotency-key'));
      const input = body(request);
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify([
            method,
            route,
            header(request, 'if-match') ?? null,
            input,
          ]),
        )
        .digest('hex');
      const lock = first(
        await sql.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS acquired',
          [tenant + actorId + key],
        ),
      );
      if (!lock.acquired) throw new Problem(409, 'operation_in_progress');
      const [prior] = await sql.query<{
        fingerprint: string;
        entity_id: string;
        entity_type: string;
      }>(
        'SELECT fingerprint,entity_id,entity_type FROM qm.mutations WHERE id=$1::uuid',
        [key],
      );
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Problem(409, 'idempotency_conflict');
        const columns = {
          assets: assetColumns,
          maintenance: maintenanceColumns,
          readings: readingColumns,
          drafts: draftColumns,
        }[prior.entity_type];
        if (!columns) throw new Problem(503, 'invalid_operation_record');
        const item = first(
          await sql.query(
            `SELECT ${columns} FROM qm.${prior.entity_type} WHERE id=$1::uuid`,
            [prior.entity_id],
          ),
          409,
          'operation_already_applied',
        );
        return { item, replayed: true };
      }
      let id: string = randomUUID(),
        kind: string,
        action: string,
        item: Record<string, unknown>;
      if (isAssetCreate) {
        item = await createAsset(sql, tenant, id, parse(AssetInput, input));
        kind = 'assets';
        action = 'asset.created';
      } else if (isAssetUpdate) {
        const data = parse(AssetInput, input);
        id = assetId!;
        kind = 'assets';
        action = 'asset.updated';
        item = first(
          await sql.query(
            `UPDATE qm.assets SET name=$2,asset_class=$3,status=$4,location=$5,manufacturer=$6,model=$7,serial_number=$8,notes=$9,
          version=version+1,updated_at=now() WHERE id=$1::uuid AND version=$10::int RETURNING ${assetColumns}`,
            [
              id,
              data.name,
              data.assetClass,
              data.status,
              data.location,
              data.manufacturer,
              data.model,
              data.serialNumber,
              data.notes,
              version(request),
            ],
          ),
          409,
          'version_conflict',
        );
      } else if (isMaintenance) {
        const data = parse(MaintenanceInput, input);
        kind = 'maintenance';
        if (maintenanceRoute) {
          id = identifier(maintenanceRoute[1]);
          action = 'maintenance.updated';
          item = first(
            await sql.query(
              `UPDATE qm.maintenance SET title=$2,due_date=$3::date,status=$4,notes=$5,version=version+1,updated_at=now()
            WHERE id=$1::uuid AND version=$6::int RETURNING ${maintenanceColumns}`,
              [
                id,
                data.title,
                data.dueDate,
                data.status,
                data.notes,
                version(request),
              ],
            ),
            409,
            'version_conflict',
          );
        } else {
          first(
            await sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
              assetId!,
            ]),
          );
          action = 'maintenance.created';
          item = first(
            await sql.query(
              `INSERT INTO qm.maintenance(tenant_id,id,asset_id,title,due_date,status,notes)
            VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6,$7) RETURNING ${maintenanceColumns}`,
              [
                tenant,
                id,
                assetId!,
                data.title,
                data.dueDate,
                data.status,
                data.notes,
              ],
            ),
          );
        }
      } else if (isReading) {
        const data = parse(ReadingInput, input);
        kind = 'readings';
        action = 'reading.created';
        if (Date.parse(data.observedAt) > Date.now() + 300000)
          throw new Problem(422, 'future_reading');
        first(
          await sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
            assetId!,
          ]),
        );
        item = first(
          await sql.query(
            `INSERT INTO qm.readings(tenant_id,id,asset_id,label,value,unit,observed_at,notes)
          VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7::timestamptz,$8) RETURNING ${readingColumns}`,
            [
              tenant,
              id,
              assetId!,
              data.label,
              data.value,
              data.unit,
              data.observedAt,
              data.notes,
            ],
          ),
        );
      } else if (isDraftSave) {
        const data = parse(DraftInput, input);
        kind = 'drafts';
        action = 'draft.saved';
        if (draftRoute) {
          id = identifier(draftRoute[1]);
          item = first(
            await sql.query(
              `UPDATE qm.drafts SET content=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1::uuid AND version=$3::int RETURNING ${draftColumns}`,
              [id, JSON.stringify(data), version(request)],
            ),
            409,
            'version_conflict',
          );
        } else
          item = first(
            await sql.query(
              `INSERT INTO qm.drafts(tenant_id,id,actor_id,content) VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb) RETURNING ${draftColumns}`,
              [tenant, id, actorId, JSON.stringify(data)],
            ),
          );
      } else {
        const draftId = identifier(draftRoute![1]);
        if (JSON.stringify(input) !== '{}')
          throw new Problem(422, 'invalid_fields');
        const draft = first(
          await sql.query<{ content: unknown }>(
            'SELECT content FROM qm.drafts WHERE id=$1::uuid AND version=$2::int FOR UPDATE',
            [draftId, version(request)],
          ),
          409,
          'version_conflict',
        );
        item = await createAsset(
          sql,
          tenant,
          id,
          parse(AssetInput, draft.content),
        );
        kind = 'assets';
        action = 'draft.committed';
        await sql.query('DELETE FROM qm.drafts WHERE id=$1::uuid', [draftId]);
        await audit(sql, tenant, actorId, id, 'asset.created');
      }
      await audit(sql, tenant, actorId, id, action);
      await sql.query(
        'INSERT INTO qm.mutations(tenant_id,actor_id,id,fingerprint,entity_id,entity_type) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::uuid,$6)',
        [tenant, actorId, key, fingerprint, id, kind],
      );
      return { item, replayed: false };
    });
  }
}
