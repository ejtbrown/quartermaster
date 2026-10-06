import { createHash, randomUUID } from 'node:crypto';
import { boundedRows } from './database';
import {
  RecordSchemas,
  RecordInput,
  ReportInput,
} from '@quartermaster/contracts';
import type { RecordKind, Asset, EstateRecord } from '@quartermaster/contracts';
import { Problem } from './http';
import {
  body,
  parse,
  identifier,
  version,
  first,
  page,
  assetColumns,
  maintenanceColumns,
} from './operations';
import {
  recordColumns,
  mutate,
  changed,
  tenantLock,
  recent,
  platform,
  queueJob,
  readJob,
} from './feature-context';
import type { FeatureContext } from './feature-context';
import { depreciation, quality, matchesRule } from './reports';

const assetKinds = new Set([
  'components',
  'valuations',
  'assessments',
  'transactions',
  'plans',
  'work_logs',
]);
function permission(c: FeatureContext, kind: string) {
  c.requireCapability(
    ['valuations', 'policies', 'books', 'transactions', 'assessments'].includes(
      kind,
    )
      ? 'finance:write'
      : kind === 'rules'
        ? 'rules:write'
        : 'records:write',
  );
}
async function validateReferences(
  c: FeatureContext,
  kind: RecordKind,
  id: string,
  assetId: string | null,
  value: Record<string, unknown>,
) {
  if (assetKinds.has(kind) && !assetId)
    throw new Problem(422, 'asset_required');
  if (assetId)
    first(
      await c.sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
        assetId,
      ]),
    );
  for (const [key, target] of [
    ['parentId', 'locations'],
    ['locationId', 'locations'],
    ['incidentId', 'incidents'],
  ] as const)
    if (value[key]) {
      const ref = identifier(value[key]);
      if (ref === id) throw new Problem(422, 'cyclic_location');
      first(
        await c.sql.query(
          'SELECT id FROM qm.records WHERE id=$1::uuid AND kind=$2',
          [ref, target],
        ),
      );
    }
  if (kind === 'locations' && value.parentId) {
    const chain = await c.sql.query<{ id: string }>(
      `WITH RECURSIVE parents AS(SELECT id,content,1 AS depth FROM qm.records WHERE id=$1::uuid AND kind='locations' UNION ALL SELECT r.id,r.content,p.depth+1 FROM qm.records r JOIN parents p ON r.id=(p.content->>'parentId')::uuid WHERE p.depth<25 AND r.kind='locations') SELECT id FROM parents`,
      [String(value.parentId)],
    );
    if (chain.length >= 25 || chain.some((r) => r.id === id))
      throw new Problem(422, 'cyclic_location');
  }
  if (kind === 'work_logs')
    first(
      await c.sql.query(
        'SELECT id FROM qm.maintenance WHERE id=$1::uuid AND asset_id=$2::uuid',
        [identifier(value.maintenanceId), assetId],
      ),
    );
  if (kind === 'plans' && value.assigneeId)
    first(
      await c.sql.query(
        'SELECT actor_id FROM qm.memberships WHERE tenant_id=$1::uuid AND actor_id=$2::uuid AND active',
        [c.tenant, identifier(value.assigneeId)],
      ),
    );
  if (kind === 'types') {
    const [prior] = await c.sql.query<{ code: string }>(
      "SELECT content->>'code' AS code FROM qm.records WHERE id=$1::uuid AND kind='types'",
      [id],
    );
    if (
      prior &&
      prior.code !== value.code &&
      (
        await c.sql.query(
          'SELECT id FROM qm.assets WHERE asset_class=$1 LIMIT 1',
          [prior.code],
        )
      ).length
    )
      throw new Problem(409, 'type_in_use');
    const duplicate = await c.sql.query(
      "SELECT id FROM qm.records WHERE kind='types' AND content->>'code'=$1 AND id<>$2::uuid",
      [String(value.code), id],
    );
    if (duplicate.length) throw new Problem(409, 'type_code_exists');
    const keys = (value.fields as { key: string }[]).map((v) => v.key);
    if (new Set(keys).size !== keys.length)
      throw new Problem(422, 'duplicate_field');
  }
}
export async function records(c: FeatureContext): Promise<unknown | undefined> {
  const route = c.route.match(
    /^records\/([a-z_]+)(?:\/([^/]+))?(?:\/(history))?$/,
  );
  if (route) {
    const kind = route[1] as RecordKind;
    if (!Object.hasOwn(RecordSchemas, kind))
      throw new Problem(404, 'not_found');
    const id = route[2] ? identifier(route[2]) : undefined;
    const read = (key: string) =>
      c.sql
        .query(
          `SELECT ${recordColumns} FROM qm.records WHERE id=$1::uuid AND kind=$2`,
          [key, kind],
        )
        .then((r) => first(r));
    if (c.method === 'GET') {
      if (route[3]) {
        await read(id!);
        return page(
          await c.sql.query(
            `SELECT id,version,content FROM qm.record_history WHERE id=$1::uuid ORDER BY version DESC LIMIT 50`,
            [id!],
          ),
        );
      }
      if (id) return read(id);
      const asset = c.params.get('assetId');
      return page(
        await boundedRows(
          c.sql,
          `SELECT ${recordColumns} FROM qm.records WHERE kind=$1 AND id>$2::uuid AND ($3::uuid IS NULL OR asset_id=$3::uuid) ORDER BY id LIMIT 51`,
          [kind, c.cursor, asset ? identifier(asset) : null],
        ),
      );
    }
    permission(c, kind);
    await tenantLock(c);
    if (c.method === 'DELETE' && id) {
      recent(c);
      return mutate(
        c,
        {},
        'record_deleted',
        async (jobId) => {
          const record = await read(id);
          if (record.version !== version(c.request))
            throw new Problem(409, 'version_conflict');
          if (kind === 'locations') {
            const refs = await c.sql.query(
              "SELECT id FROM qm.assets WHERE details->>'locationId'=$1 UNION ALL SELECT id FROM qm.records WHERE content->>'parentId'=$1 OR content->>'locationId'=$1 LIMIT 1",
              [id],
            );
            if (refs.length) throw new Problem(409, 'location_in_use');
          }
          if (
            kind === 'types' &&
            (
              await c.sql.query(
                'SELECT id FROM qm.assets WHERE asset_class=$1 LIMIT 1',
                [String((record.content as Record<string, unknown>).code)],
              )
            ).length
          )
            throw new Problem(409, 'type_in_use');
          await changed(c, id, 'record.deletion_requested');
          const job = await queueJob(c, jobId, 'purge_record', {
            recordId: id,
            deletedAt: new Date().toISOString(),
          });
          await c.sql.query(
            'SELECT qm.request_record_deletion($1::uuid,$2::int)',
            [id, version(c.request)],
          );
          return job;
        },
        (key) => readJob(c, key),
      );
    }
    if (
      !['POST', 'PATCH'].includes(c.method) ||
      Boolean(id) !== (c.method === 'PATCH')
    )
      throw new Problem(405, 'method_not_allowed');
    const input = parse(RecordInput, body(c.request));
    const content = parse<Record<string, unknown>>(
      RecordSchemas[kind],
      input.content,
    );
    if (kind === 'rules' && content.enabled)
      throw new Problem(422, 'rule_requires_preview');
    return mutate(
      c,
      { ...input, content },
      'record',
      async (generated) => {
        const key = id ?? generated;
        await validateReferences(c, kind, key, input.assetId, content);
        if (id) {
          const prior = await read(id);
          if (prior.version !== version(c.request))
            throw new Problem(409, 'version_conflict');
          await c.sql.query(
            'INSERT INTO qm.record_history(tenant_id,id,version,content) SELECT tenant_id,id,version,content FROM qm.records WHERE id=$1::uuid',
            [id],
          );
          if (kind === 'incidents') {
            const old = prior.content as Record<string, unknown>;
            if (
              old.locationId !== content.locationId ||
              old.occurredOn !== content.occurredOn
            )
              throw new Problem(409, 'incident_snapshot_immutable');
          }
          await c.sql.query(
            'UPDATE qm.records SET asset_id=$2::uuid,content=$3::jsonb,version=version+1,updated_at=now() WHERE id=$1::uuid',
            [id, input.assetId, JSON.stringify(content)],
          );
        } else {
          await c.sql.query(
            'INSERT INTO qm.records(tenant_id,id,kind,asset_id,content) VALUES($1::uuid,$2::uuid,$3,$4::uuid,$5::jsonb)',
            [c.tenant, key, kind, input.assetId, JSON.stringify(content)],
          );
          if (kind === 'incidents')
            await c.sql.query(
              `INSERT INTO qm.snapshot_items(tenant_id,incident_id,asset_id,content) SELECT tenant_id,$1::uuid,id,to_jsonb(a)-'tenant_id'-'deleted_at' FROM qm.assets a WHERE ($2::text IS NULL OR details->>'locationId'=$2)`,
              [key, (content.locationId as string | null) ?? null],
            );
        }
        if (kind === 'plans')
          await platform(c).schedule(
            c.tenant,
            String(content.nextDueOn) + 'T12:00:00.000Z',
            'plan',
            key,
          );
        await changed(c, key, id ? 'record.updated' : 'record.created');
        return read(key);
      },
      read,
    );
  }
  const ruleRoute = c.route.match(/^rules\/([^/]+)\/(preview|run|activate)$/);
  if (ruleRoute && c.method === 'POST') {
    c.requireCapability('rules:write');
    const id = identifier(ruleRoute[1]);
    await tenantLock(c);
    const rule = first(
      await c.sql.query<EstateRecord>(
        `SELECT ${recordColumns} FROM qm.records WHERE id=$1::uuid AND kind='rules'`,
        [id],
      ),
    );
    const assets = await boundedRows<Asset>(
      c.sql,
      `SELECT ${assetColumns} FROM qm.assets ORDER BY id LIMIT 1001`,
    );
    if (assets.length > 1000) throw new Problem(422, 'rule_scope_too_large');
    const matches = assets.filter((a) => matchesRule(a, rule.content));
    const hash = createHash('sha256')
      .update(
        JSON.stringify([rule.version, matches.map((a) => [a.id, a.version])]),
      )
      .digest('hex');
    if (ruleRoute[2] === 'preview')
      return {
        previewHash: hash,
        ruleVersion: rule.version,
        count: matches.length,
        items: matches
          .slice(0, 100)
          .map((a) => ({ id: a.id, name: a.name, version: a.version })),
      };
    recent(c);
    const input = body(c.request) as { previewHash?: unknown };
    if (matches.length > 100) throw new Problem(422, 'rule_mutation_limit');
    c.requireCapability(
      rule.content.action === 'flag' ? 'assets:write' : 'maintenance:write',
    );
    return mutate(
      c,
      input,
      'rule_run',
      async (runId) => {
        if (input.previewHash !== hash || version(c.request) !== rule.version)
          throw new Problem(409, 'preview_changed');
        let effectVersion = rule.version;
        if (ruleRoute[2] === 'activate' && !rule.content.enabled) {
          await c.sql.query(
            'INSERT INTO qm.record_history(tenant_id,id,version,content) SELECT tenant_id,id,version,content FROM qm.records WHERE id=$1::uuid',
            [id],
          );
          await c.sql.query(
            "UPDATE qm.records SET content=jsonb_set(content,'{enabled}','true'::jsonb),version=version+1,updated_at=now() WHERE id=$1::uuid",
            [id],
          );
          effectVersion++;
          await changed(c, id, 'rule.activated');
        }
        let applied = 0;
        for (const asset of matches) {
          const effect = randomUUID();
          const rows = await c.sql.query(
            'INSERT INTO qm.rule_effects(tenant_id,rule_id,asset_id,rule_version,entity_id) VALUES($1::uuid,$2::uuid,$3::uuid,$4::int,$5::uuid) ON CONFLICT DO NOTHING RETURNING entity_id',
            [c.tenant, id, asset.id, effectVersion, effect],
          );
          if (!rows.length) continue;
          if (rule.content.action === 'flag')
            await c.sql.query(
              "UPDATE qm.assets SET status='needs_attention',version=version+1,updated_at=now() WHERE id=$1::uuid",
              [asset.id],
            );
          else
            await c.sql.query(
              "INSERT INTO qm.maintenance(tenant_id,id,asset_id,title,due_date,status,notes) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::date,'open','Created by an approved business rule')",
              [
                c.tenant,
                effect,
                asset.id,
                String(rule.content.title),
                (rule.content.dueOn as string | null) ?? null,
              ],
            );
          await changed(c, asset.id, 'rule.applied');
          applied++;
        }
        await c.sql.query(
          "INSERT INTO qm.jobs(tenant_id,id,actor_id,kind,state,payload,result,finished_at) VALUES($1::uuid,$2::uuid,$3::uuid,'rule_run','complete','{}',$4::jsonb,now())",
          [c.tenant, runId, c.actor, JSON.stringify({ ruleId: id, applied })],
        );
        return { id: runId, applied };
      },
      async (key) => {
        const r = first(
          await c.sql.query<{ result: Record<string, unknown> }>(
            'SELECT result FROM qm.jobs WHERE id=$1::uuid',
            [key],
          ),
        );
        return { id: key, ...r.result };
      },
    );
  }
  if (c.route === 'maintenance' && c.method === 'GET')
    return page(
      await c.sql.query(
        `SELECT ${maintenanceColumns} FROM qm.maintenance WHERE id>$1::uuid AND ($2='' OR status=$2) ORDER BY id LIMIT 51`,
        [c.cursor, c.params.get('status') ?? ''],
      ),
    );
  if (c.route === 'reports' && c.method === 'POST') {
    c.requireCapability('exports:read');
    recent(c);
    const input = parse(ReportInput, body(c.request));
    const assets = await boundedRows<Asset>(
      c.sql,
      `SELECT ${assetColumns} FROM qm.assets WHERE id>$1::uuid AND ($2='' OR position(lower($2) in lower(concat_ws(' ',name,location,manufacturer,model,serial_number,notes)))>0) AND ($3='' OR status=$3) AND ($4='' OR asset_class=$4) AND ($5::text IS NULL OR details->>'locationId'=$5) ORDER BY id LIMIT 101`,
      [
        c.cursor,
        input.query,
        input.status,
        input.assetClass,
        input.locationId ?? null,
      ],
    );
    const items = assets.slice(0, 100),
      ids = JSON.stringify(items.map((a) => a.id));
    const photoCounts = await c.sql.query<{ asset_id: string; count: number }>(
      "SELECT asset_id,count(*)::int AS count FROM qm.media WHERE state='ready' AND asset_id IN (SELECT value::uuid FROM jsonb_array_elements_text($1::jsonb)) GROUP BY asset_id",
      [ids],
    );
    const rows: Record<string, unknown>[] = items.map((a) => ({
      id: a.id,
      name: a.name,
      assetClass: a.assetClass,
      status: a.status,
      location: a.location,
      manufacturer: a.manufacturer,
      model: a.model,
      serialNumber: a.serialNumber,
      ...(input.kind === 'accounting'
        ? depreciation(a.details ?? {}, input.asOf)
        : { replacementMinor: a.details?.replacementMinor ?? 0 }),
      ...(input.kind === 'quality'
        ? quality(a, photoCounts.find((p) => p.asset_id === a.id)?.count ?? 0)
        : {}),
    }));
    if (input.kind === 'insurance') {
      const policies = await boundedRows<EstateRecord>(
        c.sql,
        `SELECT ${recordColumns} FROM qm.records WHERE kind='policies' AND content->>'startsOn'<=$1 AND content->>'endsOn'>=$1 ORDER BY id LIMIT 1001`,
        [input.asOf],
      );
      if (policies.length > 1000)
        throw new Problem(422, 'report_scope_too_large');
      const locations = await c.sql.query<{
        id: string;
        content: { parentId: string | null };
      }>(
        "SELECT id,jsonb_build_object('parentId',content->'parentId') AS content FROM qm.records WHERE kind='locations' ORDER BY id LIMIT 5001",
      );
      if (locations.length > 5000)
        throw new Problem(422, 'report_scope_too_large');
      const valuations = await c.sql.query<{
        asset_id: string;
        content: { amountMinor: number; effectiveOn: string };
      }>(
        "SELECT DISTINCT ON(asset_id) asset_id,content FROM qm.records WHERE kind='valuations' AND content->>'basis'='replacement' AND content->>'effectiveOn'<=$1 AND asset_id IN(SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb)) ORDER BY asset_id,content->>'effectiveOn' DESC,updated_at DESC,id",
        [input.asOf, ids],
      );
      for (let i = 0; i < items.length; i++) {
        const a = items[i]!,
          scope = new Set<string>();
        let location = a.details?.locationId;
        while (location && !scope.has(location) && scope.size < 25) {
          scope.add(location);
          location = locations.find((v) => v.id === location)?.content.parentId;
        }
        const matching = policies.filter(
          (p) =>
            (!p.content.assetClass || p.content.assetClass === a.assetClass) &&
            (!p.content.locationId || scope.has(String(p.content.locationId))),
        );
        const valuation = valuations.find((v) => v.asset_id === a.id);
        Object.assign(rows[i]!, {
          replacementMinor:
            valuation?.content.amountMinor ?? a.details?.replacementMinor ?? 0,
          valuationOn: valuation?.content.effectiveOn ?? null,
          policies: matching.map((p) => ({
            id: p.id,
            name: p.content.name,
            carrier: p.content.carrier,
            reference: p.content.reference,
            limitMinor: p.content.limitMinor,
            deductibleMinor: p.content.deductibleMinor,
          })),
          coverageGap: matching.length === 0,
          ...quality(
            a,
            photoCounts.find((p) => p.asset_id === a.id)?.count ?? 0,
          ),
        });
      }
    }
    if (input.kind === 'accounting') {
      const adjustments = await c.sql.query<{
        asset_id: string;
        total: number;
      }>(
        "SELECT asset_id,sum((content->>'amountMinor')::bigint)::float8 AS total FROM qm.records WHERE kind='transactions' AND content->>'kind'='impairment' AND content->>'effectiveOn'<=$1 AND asset_id IN(SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb)) GROUP BY asset_id",
        [input.asOf, ids],
      );
      for (let i = 0; i < items.length; i++) {
        const a = items[i]!,
          impairment = adjustments.find((v) => v.asset_id === a.id)?.total ?? 0,
          book = Math.max(0, Number(rows[i]!.bookMinor) - impairment),
          disposed = Boolean(
            a.details?.disposedOn && a.details.disposedOn <= input.asOf,
          );
        Object.assign(rows[i]!, {
          impairmentMinor: impairment,
          netBookMinor: disposed ? 0 : book,
          disposalGainLossMinor: disposed
            ? (a.details?.proceedsMinor ?? 0) - book
            : null,
          calculation:
            'Management estimate; completed-month straight line plus recorded impairment; no general-ledger posting',
        });
      }
    }
    if (input.kind === 'quality')
      for (let i = 0; i < items.length; i++) {
        const a = items[i]!;
        const matches = a.serialNumber
          ? await c.sql.query<{ id: string }>(
              'SELECT id FROM qm.assets WHERE serial_number=$1 AND id<>$2::uuid ORDER BY id LIMIT 20',
              [a.serialNumber, a.id],
            )
          : [];
        rows[i]!.possibleDuplicateIds = matches.map((m) => m.id);
      }
    if (input.kind === 'maintenance') {
      const result = await c.sql.query(
        `SELECT ${maintenanceColumns} FROM qm.maintenance WHERE id>$1::uuid ORDER BY id LIMIT 101`,
        [c.cursor],
      );
      return {
        kind: input.kind,
        asOf: input.asOf,
        currency: 'USD',
        items: result.slice(0, 100),
        nextCursor: result.length > 100 ? result[99]!.id : null,
      };
    }
    if (input.kind === 'incident') {
      const incident = identifier(input.incidentId);
      first(
        await c.sql.query(
          "SELECT id FROM qm.records WHERE id=$1::uuid AND kind='incidents'",
          [incident],
        ),
      );
      const result = await c.sql.query(
        `SELECT asset_id AS id,content AS "before",(SELECT coalesce(jsonb_agg(r.content),'[]'::jsonb) FROM qm.records r WHERE r.kind='assessments' AND r.asset_id=s.asset_id AND r.content->>'incidentId'=$1) AS assessments FROM qm.snapshot_items s WHERE incident_id=$1::uuid AND asset_id>$2::uuid ORDER BY asset_id LIMIT 101`,
        [incident, c.cursor],
      );
      return {
        kind: input.kind,
        asOf: input.asOf,
        items: result.slice(0, 100),
        nextCursor: result.length > 100 ? result[99]!.id : null,
      };
    }
    return {
      kind: input.kind,
      asOf: input.asOf,
      currency: 'USD',
      items: rows,
      pageTotals: {
        replacementMinor: rows.reduce(
          (sum, r) => sum + Number(r.replacementMinor ?? 0),
          0,
        ),
        costMinor: rows.reduce((sum, r) => sum + Number(r.costMinor ?? 0), 0),
        netBookMinor: rows.reduce(
          (sum, r) => sum + Number(r.netBookMinor ?? 0),
          0,
        ),
      },
      nextCursor: assets.length > 100 ? items.at(-1)!.id : null,
    };
  }
  return undefined;
}
