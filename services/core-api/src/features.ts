import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  AssetInput,
  Capability,
  UploadInput,
  MediaIntent,
  MemberInput,
  TenantInput,
  ReadingInput,
  MaintenanceInput,
  RecordSchemas,
} from '@quartermaster/contracts';
import type { Media, Asset, AssetDetails } from '@quartermaster/contracts';
import { Problem } from './http';
import {
  body,
  parse,
  identifier,
  version,
  first,
  page,
  createAsset,
  assetColumns,
} from './operations';
import { records } from './records';
import {
  mediaColumns,
  jobColumns,
  timestamp,
  mutate,
  changed,
  queueJob,
  readJob,
  tenantLock,
  recent,
  platform,
} from './feature-context';
import type { FeatureContext } from './feature-context';
import { objectKey } from './platform';
const conversationColumns = `id,version,draft,CASE WHEN proposal_expires_at>now() THEN proposal ELSE NULL END AS proposal,review,asset_id AS "assetId",${timestamp('updated_at')} AS "updatedAt"`;
const CaptureDraft = AssetInput.partial().extend({
  name: z.string().trim().max(160).optional(),
  location: z.string().trim().max(240).optional(),
});
const Review = z
  .object({
    components: z.array(RecordSchemas.components).max(10).default([]),
    maintenance: z.array(MaintenanceInput).max(10),
    readings: z.array(ReadingInput).max(10),
  })
  .strict();

export async function validateAsset(
  c: FeatureContext,
  details: AssetDetails | undefined,
  assetClass: string,
  id?: string,
) {
  const prior = id
    ? first(
        await c.sql.query<{ details: AssetDetails }>(
          'SELECT details FROM qm.assets WHERE id=$1::uuid',
          [identifier(id)],
        ),
      ).details
    : {};
  const financial = [
    'costMinor',
    'replacementMinor',
    'residualMinor',
    'usefulLifeMonths',
    'currency',
    'costCenter',
    'capitalized',
    'proceedsMinor',
  ] as const;
  if (
    financial.some(
      (key) =>
        JSON.stringify(details?.[key] ?? null) !==
        JSON.stringify(prior[key] ?? null),
    )
  )
    c.requireCapability('finance:write');
  if (
    details?.assetTag &&
    (
      await c.sql.query(
        "SELECT id FROM qm.assets WHERE details->>'assetTag'=$1 AND ($2::uuid IS NULL OR id<>$2::uuid) LIMIT 1",
        [details.assetTag, id ?? null],
      )
    ).length
  )
    throw new Problem(409, 'asset_tag_exists');
  if (details?.locationId)
    first(
      await c.sql.query(
        "SELECT id FROM qm.records WHERE id=$1::uuid AND kind='locations'",
        [details.locationId],
      ),
    );
  if (details?.parentAssetId) {
    if (details.parentAssetId === id) throw new Problem(422, 'cyclic_asset');
    first(
      await c.sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
        details.parentAssetId,
      ]),
    );
    const chain = await c.sql.query<{ id: string }>(
      `WITH RECURSIVE parents AS(SELECT id,details,1 AS depth FROM qm.assets WHERE id=$1::uuid UNION ALL SELECT a.id,a.details,p.depth+1 FROM qm.assets a JOIN parents p ON a.id=(p.details->>'parentAssetId')::uuid WHERE p.depth<25) SELECT id FROM parents`,
      [details.parentAssetId],
    );
    if (chain.length >= 25 || chain.some((r) => r.id === id))
      throw new Problem(422, 'cyclic_asset');
  }
  const [type] = await c.sql.query<{
    content: { fields: { key: string; type: string; required: boolean }[] };
  }>(
    "SELECT content FROM qm.records WHERE kind='types' AND content->>'code'=$1",
    [assetClass],
  );
  if (type) {
    for (const field of type.content.fields) {
      const value = details?.attributes?.[field.key];
      if (field.required && (value === undefined || value === ''))
        throw new Problem(422, 'required_type_field');
      if (
        value !== undefined &&
        typeof value !== (field.type === 'text' ? 'string' : field.type)
      )
        throw new Problem(422, 'invalid_type_field');
    }
  } else if (!['air_conditioner', 'appliance'].includes(assetClass))
    throw new Problem(422, 'unknown_asset_class');
}
async function accessibleMedia(c: FeatureContext, id: string) {
  const media = first(
    await c.sql.query<Media>(
      `SELECT ${mediaColumns} FROM qm.media WHERE id=$1::uuid`,
      [id],
    ),
  );
  if (media.assetId)
    first(
      await c.sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
        media.assetId,
      ]),
    );
  else
    first(
      await c.sql.query(
        'SELECT id FROM qm.conversations WHERE id=$1::uuid AND actor_id=$2::uuid',
        [media.conversationId!, c.actor],
      ),
    );
  return media;
}
export async function features(
  c: FeatureContext,
): Promise<unknown | undefined> {
  // All estate mutations share a tenant lock, including capture and legacy
  // draft commits. This serializes reference validation, deletion and writes.
  if (['POST', 'PATCH', 'DELETE'].includes(c.method)) await tenantLock(c);
  if (
    (c.route === 'assets' && c.method === 'POST') ||
    (/^assets\/[^/]+$/.test(c.route) && c.method === 'PATCH')
  ) {
    return undefined;
  }
  const record = await records(c);
  if (record !== undefined) return record;
  const privateDelete = c.route.match(/^(drafts|conversations)\/([^/]+)$/);
  if (privateDelete && c.method === 'DELETE') {
    c.requireCapability('assets:write');
    recent(c);
    const id = identifier(privateDelete[2]),
      kind = privateDelete[1] === 'drafts' ? 'draft' : 'capture',
      table = kind === 'draft' ? 'drafts' : 'conversations';
    return mutate(
      c,
      {},
      kind + '_delete',
      async (jobId) => {
        const row = first(
          await c.sql.query<{ version: number }>(
            `SELECT version FROM qm.${table} WHERE id=$1::uuid`,
            [id],
          ),
        );
        if (row.version !== version(c.request))
          throw new Problem(409, 'version_conflict');
        const job = await queueJob(c, jobId, 'purge_' + kind, {
          [kind === 'draft' ? 'draftId' : 'conversationId']: id,
          deletedAt: new Date().toISOString(),
        });
        await changed(c, id, kind + '.deletion_requested');
        await c.sql.query(
          'SELECT qm.request_private_deletion($1,$2::uuid,$3::int)',
          [kind, id, row.version],
        );
        return job;
      },
      (key) => readJob(c, key),
    );
  }
  if (c.route === 'settings') {
    c.requireCapability('workspace:admin');
    const read = () =>
      c.sql
        .query(
          'SELECT id,name,time_zone AS "timeZone",version FROM qm.tenants WHERE id=$1::uuid',
          [c.tenant],
        )
        .then((r) => first(r));
    if (c.method === 'GET')
      return {
        ...(await read()),
        retention: {
          originalDays: 15,
          transcriptDays: 15,
          auditYears: 1,
          backupDays: 90,
          deletionMetadataDays: 90,
          backupDeletion: 'isolated_until_expiry_with_replay',
        },
        usageLimits: { aiRequestsPerDay: 100, voiceSecondsPerDay: 900 },
      };
    if (c.method === 'PATCH') {
      recent(c);
      const input = parse(TenantInput, body(c.request));
      return mutate(
        c,
        input,
        'tenant_settings',
        async () => {
          first(
            await c.sql.query(
              'UPDATE qm.tenants SET name=$2,time_zone=$3,version=version+1 WHERE id=$1::uuid AND version=$4::int RETURNING id',
              [c.tenant, input.name, input.timeZone, version(c.request)],
            ),
            409,
            'version_conflict',
          );
          await changed(c, c.tenant, 'tenant.updated');
          return read();
        },
        read,
      );
    }
  }
  if (c.route === 'members' && c.method === 'GET') {
    c.requireCapability('workspace:admin');
    return page(
      await c.sql.query(
        `SELECT actor_id AS id,email,to_json(capabilities) AS capabilities,active,expires_at::text AS "expiresAt" FROM qm.memberships WHERE tenant_id=$1::uuid AND actor_id>$2::uuid ORDER BY actor_id LIMIT 51`,
        [c.tenant, c.cursor],
      ),
    );
  }
  if (c.route === 'members' && c.method === 'POST') {
    c.requireCapability('workspace:admin');
    recent(c);
    const input = parse(MemberInput, body(c.request));
    const capabilities = parse(z.array(Capability).min(1), input.capabilities);
    if (!capabilities.includes('assets:read'))
      throw new Problem(422, 'read_capability_required');
    return mutate(
      c,
      input,
      'member',
      async () => {
        await tenantLock(c);
        const identity = await platform(c).invite(input.email.toLowerCase());
        // An invitation adds membership but never silently downgrades an existing one.
        await c.sql.query(
          'INSERT INTO qm.memberships(tenant_id,actor_id,email,capabilities) VALUES($1::uuid,$2::uuid,$3,ARRAY(SELECT jsonb_array_elements_text($4::jsonb))) ON CONFLICT DO NOTHING',
          [
            c.tenant,
            identity.actorId,
            input.email.toLowerCase(),
            JSON.stringify(capabilities),
          ],
        );
        await changed(c, identity.actorId, 'membership.invited');
        return { id: identity.actorId, invited: identity.created };
      },
      async (id) => ({ id, invited: true }),
    );
  }
  const member = c.route.match(/^members\/([^/]+)$/);
  if (member && c.method === 'PATCH') {
    c.requireCapability('workspace:admin');
    recent(c);
    const id = identifier(member[1]);
    const input = parse(
      z
        .object({
          capabilities: z.array(Capability).min(1),
          active: z.boolean(),
        })
        .strict(),
      body(c.request),
    );
    if (!input.capabilities.includes('assets:read'))
      throw new Problem(422, 'read_capability_required');
    return mutate(
      c,
      input,
      'membership',
      async () => {
        await tenantLock(c);
        const target = first(
          await c.sql.query<{ capabilities: string[] }>(
            'SELECT to_json(capabilities) AS capabilities FROM qm.memberships WHERE tenant_id=$1::uuid AND actor_id=$2::uuid',
            [c.tenant, id],
          ),
        );
        if (
          target.capabilities.includes('workspace:admin') &&
          (!input.active || !input.capabilities.includes('workspace:admin'))
        ) {
          const admins = await c.sql.query(
            "SELECT actor_id FROM qm.memberships WHERE tenant_id=$1::uuid AND active AND 'workspace:admin'=ANY(capabilities) AND (expires_at IS NULL OR expires_at>now())",
            [c.tenant],
          );
          if (admins.length <= 1) throw new Problem(409, 'last_administrator');
        }
        await changed(c, id, 'membership.updated');
        await c.sql.query(
          'UPDATE qm.memberships SET capabilities=ARRAY(SELECT jsonb_array_elements_text($3::jsonb)),active=$4 WHERE tenant_id=$1::uuid AND actor_id=$2::uuid',
          [c.tenant, id, JSON.stringify(input.capabilities), input.active],
        );
        return { id, active: input.active };
      },
      async () => ({ id, active: input.active }),
    );
  }
  if (c.route === 'media' && c.method === 'GET') {
    const asset = c.params.get('assetId'),
      conversation = c.params.get('conversationId');
    if (Boolean(asset) === Boolean(conversation))
      throw new Problem(422, 'media_parent_required');
    if (asset)
      first(
        await c.sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
          identifier(asset),
        ]),
      );
    else
      first(
        await c.sql.query(
          'SELECT id FROM qm.conversations WHERE id=$1::uuid AND actor_id=$2::uuid',
          [identifier(conversation), c.actor],
        ),
      );
    return page(
      await c.sql.query(
        `SELECT ${mediaColumns} FROM qm.media WHERE id>$1::uuid AND (($2::uuid IS NOT NULL AND asset_id=$2::uuid) OR ($3::uuid IS NOT NULL AND conversation_id=$3::uuid)) AND state<>'deleting' ORDER BY id LIMIT 51`,
        [c.cursor, asset, conversation],
      ),
    );
  }
  if (c.route === 'media/uploads' && c.method === 'POST') {
    c.requireCapability('assets:write');
    const input = parse(UploadInput, body(c.request));
    await tenantLock(c);
    if (input.assetId)
      first(
        await c.sql.query('SELECT id FROM qm.assets WHERE id=$1::uuid', [
          input.assetId,
        ]),
      );
    else
      first(
        await c.sql.query(
          'SELECT id FROM qm.conversations WHERE id=$1::uuid AND actor_id=$2::uuid AND asset_id IS NULL',
          [input.conversationId!, c.actor],
        ),
      );
    const grant = async (id: string) => ({
      id,
      ...(await platform(c).upload(
        c.tenant,
        id,
        input.contentType,
        input.bytes,
        input.sha256,
      )),
      expiresIn: 60,
    });
    return mutate(
      c,
      input,
      'upload',
      async (id) => {
        await c.sql.query(
          "INSERT INTO qm.media(tenant_id,id,asset_id,conversation_id,intent,state,content_type,expected_bytes,sha256) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,'uploading',$6,$7::int,$8)",
          [
            c.tenant,
            id,
            input.assetId,
            input.conversationId,
            input.intent,
            input.contentType,
            input.bytes,
            input.sha256,
          ],
        );
        await platform(c).schedule(
          c.tenant,
          new Date(Date.now() + 86400000).toISOString(),
          'abandoned_upload',
          id,
        );
        await changed(c, id, 'media.requested');
        return grant(id);
      },
      async (id) => {
        const row = await accessibleMedia(c, id);
        if (row.state !== 'uploading')
          throw new Problem(409, 'upload_already_completed');
        return grant(id);
      },
    );
  }
  const mediaRoute = c.route.match(
    /^media\/([^/]+)(?:\/(complete|url|analyze|intent|renew))?$/,
  );
  if (mediaRoute) {
    const id = identifier(mediaRoute[1]),
      action = mediaRoute[2];
    if (c.method === 'DELETE' && !action) {
      c.requireCapability('assets:delete');
      recent(c);
      return mutate(
        c,
        {},
        'media_delete',
        async (jobId) => {
          const media = await accessibleMedia(c, id);
          if (media.version !== version(c.request))
            throw new Problem(409, 'version_conflict');
          await c.sql.query(
            "UPDATE qm.media SET state='deleting',version=version+1 WHERE id=$1::uuid",
            [id],
          );
          await changed(c, id, 'media.deletion_requested');
          return queueJob(c, jobId, 'purge_media', {
            mediaId: id,
            deletedAt: new Date().toISOString(),
          });
        },
        (key) => readJob(c, key),
      );
    }
    const media = await accessibleMedia(c, id);
    if (c.method === 'GET' && action === 'url') {
      if (media.state !== 'ready') throw new Problem(409, 'media_not_ready');
      return {
        url: await platform(c).download(objectKey('resized', c.tenant, id)),
        expiresIn: 60,
      };
    }
    if (c.method === 'GET' && !action) return media;
    c.requireCapability('assets:write');
    await tenantLock(c);
    if (c.method === 'POST' && action === 'renew') {
      if (media.state !== 'uploading')
        throw new Problem(409, 'upload_already_completed');
      const info = first(
        await c.sql.query<{ content_type: string; expected_bytes: number }>(
          'SELECT content_type,expected_bytes FROM qm.media WHERE id=$1::uuid',
          [id],
        ),
      );
      return {
        id,
        ...(await platform(c).upload(
          c.tenant,
          id,
          info.content_type,
          info.expected_bytes,
          media.sha256,
        )),
        expiresIn: 60,
      };
    }
    if (c.method === 'POST' && (action === 'complete' || action === 'analyze'))
      return mutate(
        c,
        {},
        'media_job',
        async (jobId) => {
          if (action === 'complete') {
            if (media.state !== 'uploading')
              throw new Problem(409, 'upload_already_completed');
            const stored = first(
              await c.sql.query<{
                expected_bytes: number;
                content_type: string;
              }>(
                'SELECT expected_bytes,content_type FROM qm.media WHERE id=$1::uuid',
                [id],
              ),
            );
            const head = await platform(c).headUpload(c.tenant, id);
            if (
              head.bytes !== stored.expected_bytes ||
              head.contentType !== stored.content_type ||
              head.checksum !==
                Buffer.from(media.sha256, 'hex').toString('base64')
            )
              throw new Problem(422, 'upload_mismatch');
            await c.sql.query(
              "UPDATE qm.media SET state='processing',source_version=$2,version=version+1 WHERE id=$1::uuid",
              [id, head.version],
            );
          } else if (media.state !== 'ready')
            throw new Problem(409, 'media_not_ready');
          await changed(
            c,
            id,
            action === 'complete'
              ? 'media.uploaded'
              : 'media.analysis_requested',
          );
          return queueJob(
            c,
            jobId,
            action === 'complete' ? 'media' : 'image_analysis',
            { mediaId: id },
          );
        },
        (key) => readJob(c, key),
      );
    if (c.method === 'PATCH' && action === 'intent') {
      const input = parse(
        z.object({ intent: MediaIntent }).strict(),
        body(c.request),
      );
      return mutate(
        c,
        input,
        'media_intent',
        async () => {
          first(
            await c.sql.query(
              'UPDATE qm.media SET intent=$2,version=version+1 WHERE id=$1::uuid AND version=$3::int RETURNING id',
              [id, input.intent, version(c.request)],
            ),
            409,
            'version_conflict',
          );
          await changed(c, id, 'media.classified');
          return { ...media, intent: input.intent, version: media.version + 1 };
        },
        async () => ({ ...(await accessibleMedia(c, id)) }),
      );
    }
  }
  if (c.route === 'jobs' && c.method === 'GET')
    return page(
      await c.sql.query(
        `SELECT ${jobColumns} FROM qm.jobs WHERE actor_id=$1::uuid AND id>$2::uuid ORDER BY id LIMIT 51`,
        [c.actor, c.cursor],
      ),
    );
  const job = c.route.match(/^jobs\/([^/]+)(?:\/(retry|download))?$/);
  if (job) {
    const id = identifier(job[1]);
    const current = await readJob(c, id);
    if (c.method === 'GET' && !job[2]) return current;
    if (c.method === 'GET' && job[2] === 'download') {
      c.requireCapability('exports:read');
      recent(c);
      if (current.kind !== 'export' || current.state !== 'complete')
        throw new Problem(409, 'export_not_ready');
      return {
        url: await platform(c).download(`exports/${c.tenant}/${id}/estate.zip`),
        expiresIn: 60,
      };
    }
    if (c.method === 'POST' && job[2] === 'retry') {
      c.requireCapability(
        current.kind === 'export'
          ? 'exports:read'
          : String(current.kind).startsWith('purge_')
            ? 'assets:delete'
            : 'assets:write',
      );
      if (
        current.kind === 'export' ||
        String(current.kind).startsWith('purge_')
      )
        recent(c);
      return mutate(
        c,
        {},
        'job_retry',
        async () => {
          if (current.state !== 'failed')
            throw new Problem(409, 'job_not_failed');
          if (current.kind === 'media')
            await c.sql.query(
              "UPDATE qm.media SET state='processing',version=version+1 WHERE id=(SELECT (payload->>'mediaId')::uuid FROM qm.jobs WHERE id=$1::uuid) AND state='failed'",
              [id],
            );
          await c.sql.query(
            "UPDATE qm.jobs SET state='queued',error_code=NULL WHERE id=$1::uuid",
            [id],
          );
          await platform(c).enqueue({
            tenant: c.tenant,
            id,
            createdAt: Date.now(),
          });
          return readJob(c, id);
        },
        (key) => readJob(c, key),
      );
    }
  }
  if (c.route === 'exports' && c.method === 'POST') {
    c.requireCapability('exports:read');
    recent(c);
    const input = parse(
      z
        .object({
          after: z.uuid().nullable().default(null),
          includePhotos: z.boolean().default(true),
        })
        .strict(),
      body(c.request),
    );
    return mutate(
      c,
      input,
      'export',
      async (id) => {
        await changed(c, id, 'export.requested');
        return queueJob(c, id, 'export', input);
      },
      (id) => readJob(c, id),
    );
  }
  const deleteAsset = c.route.match(/^assets\/([^/]+)$/);
  if (deleteAsset && c.method === 'DELETE') {
    c.requireCapability('assets:delete');
    recent(c);
    const id = identifier(deleteAsset[1]);
    return mutate(
      c,
      {},
      'asset_delete',
      async (jobId) => {
        await tenantLock(c);
        const asset = first(
          await c.sql.query<Asset>(
            `SELECT ${assetColumns} FROM qm.assets WHERE id=$1::uuid FOR UPDATE`,
            [id],
          ),
        );
        if (asset.version !== version(c.request))
          throw new Problem(409, 'version_conflict');
        const refs = await c.sql.query(
          "SELECT id FROM qm.assets WHERE details->>'parentAssetId'=$1 LIMIT 1",
          [id],
        );
        if (refs.length) throw new Problem(409, 'asset_has_components');
        const item = await queueJob(c, jobId, 'purge_asset', {
          assetId: id,
          deletedAt: new Date().toISOString(),
        });
        await changed(c, id, 'asset.deletion_requested');
        first(
          await c.sql.query(
            'SELECT qm.request_asset_deletion($1::uuid,$2::int) AS accepted',
            [id, asset.version],
          ),
        );
        return item;
      },
      (key) => readJob(c, key),
    );
  }
  if (c.route === 'tenant/delete' && c.method === 'POST') {
    c.requireCapability('workspace:admin');
    recent(c);
    const input = parse(
      z.object({ confirmName: z.string() }).strict(),
      body(c.request),
    );
    await tenantLock(c);
    const tenant = first(
      await c.sql.query<{ name: string }>(
        'SELECT name FROM qm.tenants WHERE id=$1::uuid',
        [c.tenant],
      ),
    );
    if (input.confirmName !== tenant.name)
      throw new Problem(422, 'confirmation_mismatch');
    // Record dedupe/audit/job while membership is still active, then close tenant.
    const result = await mutate(
      c,
      input,
      'tenant_delete',
      async (id) => {
        await changed(c, c.tenant, 'tenant.deletion_requested');
        return queueJob(c, id, 'purge_tenant', {
          deletedAt: new Date().toISOString(),
        });
      },
      (key) => readJob(c, key),
    );
    await c.sql.query('SELECT qm.request_tenant_deletion()');
    return result;
  }
  if (c.route === 'conversations' && c.method === 'GET')
    return page(
      await c.sql.query(
        `SELECT ${conversationColumns} FROM qm.conversations WHERE id>$1::uuid AND asset_id IS NULL ORDER BY id LIMIT 51`,
        [c.cursor],
      ),
    );
  if (c.route === 'conversations' && c.method === 'POST') {
    c.requireCapability('assets:write');
    const input = parse(
      z.object({ draft: CaptureDraft.default({}) }).strict(),
      body(c.request),
    );
    return mutate(
      c,
      input,
      'conversation',
      async (id) => {
        const row = first(
          await c.sql.query(
            `INSERT INTO qm.conversations(tenant_id,id,actor_id,draft) VALUES($1::uuid,$2::uuid,$3::uuid,$4::jsonb) RETURNING ${conversationColumns}`,
            [c.tenant, id, c.actor, JSON.stringify(input.draft)],
          ),
        );
        await changed(c, id, 'capture.started');
        return row;
      },
      async (id) =>
        first(
          await c.sql.query(
            `SELECT ${conversationColumns} FROM qm.conversations WHERE id=$1::uuid`,
            [id],
          ),
        ),
    );
  }
  const capture = c.route.match(
    /^conversations\/([^/]+)(?:\/(turns|transcribe|commit))?$/,
  );
  if (capture) {
    c.requireCapability('assets:write');
    const id = identifier(capture[1]);
    const conversation = first(
      await c.sql.query<{
        id: string;
        version: number;
        draft: unknown;
        proposal: unknown;
        assetId: string | null;
      }>(
        `SELECT ${conversationColumns} FROM qm.conversations WHERE id=$1::uuid AND actor_id=$2::uuid`,
        [id, c.actor],
      ),
    );
    if (c.method === 'GET' && !capture[2])
      return {
        ...conversation,
        turns: await c.sql.query(
          `SELECT id,role,content,${timestamp('created_at')} AS "createdAt" FROM qm.turns WHERE conversation_id=$1::uuid AND expires_at>now() AND role IN ('user','assistant') ORDER BY created_at DESC,id LIMIT 30`,
          [id],
        ),
      };
    if (conversation.assetId && capture[2] !== 'commit')
      throw new Problem(409, 'capture_already_committed');
    if (c.method === 'POST' && capture[2] === 'transcribe') {
      const input = parse(
        z
          .object({
            pcm: z
              .string()
              .min(4)
              .max(860000)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
          })
          .strict(),
        body(c.request, 900000),
      );
      return mutate(
        c,
        input,
        'transcript',
        async (key) => {
          const transcript = await platform(c).transcribe(
            c.tenant,
            Buffer.from(input.pcm, 'base64'),
          );
          await c.sql.query(
            "INSERT INTO qm.turns(tenant_id,id,conversation_id,actor_id,role,content) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'transcript',$5)",
            [c.tenant, key, id, c.actor, transcript],
          );
          await platform(c).schedule(
            c.tenant,
            new Date(Date.now() + 15 * 86400000).toISOString(),
          );
          return { id: key, transcript };
        },
        async (key) =>
          first(
            await c.sql.query(
              'SELECT id,content AS transcript FROM qm.turns WHERE id=$1::uuid AND expires_at>now()',
              [key],
            ),
          ),
      );
    }
    if (c.method === 'POST' && capture[2] === 'turns') {
      const input = parse(
        z
          .object({
            text: z.string().trim().min(1).max(8000),
            draft: CaptureDraft,
          })
          .strict(),
        body(c.request),
      );
      return mutate(
        c,
        input,
        'capture_turn',
        async (key) => {
          if (conversation.version !== version(c.request))
            throw new Problem(409, 'version_conflict');
          if (
            (
              await c.sql.query(
                "SELECT id FROM qm.jobs WHERE kind='conversation' AND payload->>'conversationId'=$1 AND state IN ('queued','running') LIMIT 1",
                [id],
              )
            ).length
          )
            throw new Problem(409, 'capture_busy');
          await c.sql.query(
            "INSERT INTO qm.turns(tenant_id,id,conversation_id,actor_id,role,content) VALUES($1::uuid,$2::uuid,$3::uuid,$4::uuid,'user',$5)",
            [c.tenant, randomUUID(), id, c.actor, input.text],
          );
          await c.sql.query(
            'UPDATE qm.conversations SET draft=$2::jsonb,version=version+1,updated_at=now() WHERE id=$1::uuid',
            [id, JSON.stringify(input.draft)],
          );
          await platform(c).schedule(
            c.tenant,
            new Date(Date.now() + 15 * 86400000).toISOString(),
          );
          return queueJob(c, key, 'conversation', {
            conversationId: id,
            version: conversation.version + 1,
          });
        },
        (key) => readJob(c, key),
      );
    }
    if (c.method === 'POST' && capture[2] === 'commit') {
      const input = parse(
        z
          .object({
            asset: AssetInput,
            components: z.array(RecordSchemas.components).max(10).default([]),
            maintenance: z.array(MaintenanceInput).max(10),
            readings: z.array(ReadingInput).max(10),
            confirmed: z.literal(true),
          })
          .strict(),
        body(c.request),
      );
      if (input.maintenance.length) c.requireCapability('maintenance:write');
      if (input.components.length) c.requireCapability('records:write');
      return mutate(
        c,
        input,
        'capture_commit',
        async (assetId) => {
          await tenantLock(c);
          if (conversation.assetId)
            throw new Problem(409, 'capture_already_committed');
          if (conversation.version !== version(c.request))
            throw new Problem(409, 'version_conflict');
          await validateAsset(c, input.asset.details, input.asset.assetClass);
          if (
            (
              await c.sql.query(
                "SELECT id FROM qm.media WHERE conversation_id=$1::uuid AND state IN ('uploading','processing','deleting') LIMIT 1",
                [id],
              )
            ).length
          )
            throw new Problem(409, 'media_processing');
          const asset = await createAsset(
            c.sql,
            c.tenant,
            assetId,
            input.asset,
          );
          for (const component of input.components) {
            const componentId = randomUUID();
            await c.sql.query(
              "INSERT INTO qm.records(tenant_id,id,kind,asset_id,content) VALUES($1::uuid,$2::uuid,'components',$3::uuid,$4::jsonb)",
              [c.tenant, componentId, assetId, JSON.stringify(component)],
            );
            await changed(c, componentId, 'components.created');
          }
          for (const task of input.maintenance)
            await c.sql.query(
              'INSERT INTO qm.maintenance(tenant_id,id,asset_id,title,due_date,status,notes) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::date,$6,$7)',
              [
                c.tenant,
                randomUUID(),
                assetId,
                task.title,
                task.dueDate,
                task.status,
                task.notes,
              ],
            );
          for (const r of input.readings) {
            if (Date.parse(r.observedAt) > Date.now() + 300000)
              throw new Problem(422, 'future_reading');
            await c.sql.query(
              'INSERT INTO qm.readings(tenant_id,id,asset_id,label,value,unit,observed_at,notes) VALUES($1::uuid,$2::uuid,$3::uuid,$4,$5::double precision,$6,$7::timestamptz,$8)',
              [
                c.tenant,
                randomUUID(),
                assetId,
                r.label,
                r.value,
                r.unit,
                r.observedAt,
                r.notes,
              ],
            );
          }
          await c.sql.query(
            'UPDATE qm.media SET asset_id=$2::uuid,conversation_id=NULL WHERE conversation_id=$1::uuid',
            [id, assetId],
          );
          await c.sql.query(
            'UPDATE qm.conversations SET asset_id=$2::uuid,version=version+1,updated_at=now() WHERE id=$1::uuid',
            [id, assetId],
          );
          await changed(c, assetId, 'capture.committed');
          await queueJob(c, randomUUID(), 'asset_rules', { assetId });
          return asset;
        },
        async (key) =>
          first(
            await c.sql.query(
              `SELECT ${assetColumns} FROM qm.assets WHERE id=$1::uuid`,
              [key],
            ),
          ),
      );
    }
    if (c.method === 'PATCH' && !capture[2]) {
      const input = parse(
        z
          .object({
            draft: CaptureDraft,
            review: Review.optional(),
          })
          .strict(),
        body(c.request),
      );
      return mutate(
        c,
        input,
        'capture_draft',
        async () => {
          const row = first(
            await c.sql.query(
              `UPDATE qm.conversations SET draft=$2::jsonb,review=coalesce($4::jsonb,review),version=version+1,updated_at=now() WHERE id=$1::uuid AND version=$3::int RETURNING ${conversationColumns}`,
              [
                id,
                JSON.stringify(input.draft),
                version(c.request),
                input.review ? JSON.stringify(input.review) : null,
              ],
            ),
            409,
            'version_conflict',
          );
          await changed(c, id, 'capture.saved');
          return row;
        },
        async () =>
          first(
            await c.sql.query(
              `SELECT ${conversationColumns} FROM qm.conversations WHERE id=$1::uuid`,
              [id],
            ),
          ),
      );
    }
  }
  return undefined;
}
