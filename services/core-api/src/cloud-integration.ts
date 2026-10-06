import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  S3Client,
  ListObjectVersionsCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  SchedulerClient,
  ListSchedulesCommand,
  GetScheduleCommand,
  DeleteScheduleCommand,
} from '@aws-sdk/client-scheduler';
import { unzipSync, strFromU8 } from 'fflate';
import { Capability } from '@quartermaster/contracts';
import type { Asset, Job, Media } from '@quartermaster/contracts';
import type { Database } from './database';
import type { RDSDataClient } from '@aws-sdk/client-rds-data';

// Operator-only acceptance probe. Never creates an identity or touches a caller-
// supplied tenant. Ephemeral sessions are not a substitute for human MFA testing.
export async function cloudIntegration(
  owner: Database,
  credentials: RDSDataClient['config']['credentials'],
  account: string,
) {
  const tenant = randomUUID(),
    actor = randomUUID(),
    other = randomUUID(),
    marker = 'Temporary deployment probe ' + randomUUID(),
    origin = 'https://qm.ejtbrown.com',
    bucket = `quartermaster-dev-media-${account}-us-east-2`;
  const config = { region: 'us-east-2', credentials, maxAttempts: 2 },
    dynamo = DynamoDBDocumentClient.from(new DynamoDBClient(config)),
    s3 = new S3Client(config),
    scheduler = new SchedulerClient(config);
  const token = randomBytes(32).toString('base64url'),
    csrf = randomBytes(32).toString('base64url'),
    sessionKey = {
      pk: 'SESSION#' + createHash('sha256').update(token).digest('hex'),
      sk: 'AUTH',
    };
  console.log(
    JSON.stringify({
      probeTenant: tenant,
      otherTenant: other,
      temporary: true,
    }),
  );
  let seeded = false;
  async function request<T = Record<string, unknown>>(
    path: string,
    method = 'GET',
    body?: unknown,
    version?: number,
    expected = 200,
  ): Promise<T> {
    const key = randomUUID();
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(origin + path, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(40000),
        headers: {
          cookie: '__Host-qm_session=' + token,
          origin,
          'x-csrf-token': csrf,
          'content-type': 'application/json',
          'idempotency-key': key,
          ...(version ? { 'if-match': `"${version}"` } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const result = (await response.json()) as T & { code?: string };
      if (
        (response.status === 503 || result.code === 'operation_in_progress') &&
        attempt < 8
      ) {
        await delay(5000);
        continue;
      }
      assert.equal(
        response.status,
        expected,
        `Probe ${method} ${path.split('/').at(-1)}: ${response.status} ${result.code ?? ''}`,
      );
      return result;
    }
  }
  const call = <T = Record<string, unknown>>(
    path: string,
    method = 'GET',
    body?: unknown,
    version?: number,
    expected = 200,
  ) =>
    request<T>(
      `/api/v1/tenants/${tenant}/${path}`,
      method,
      body,
      version,
      expected,
    );
  async function job(id: string) {
    for (let i = 0; i < 60; i++) {
      await delay(3000);
      const item = await call<Job>('jobs/' + id);
      if (item.state === 'complete') return item;
      assert.notEqual(
        item.state,
        'failed',
        'Cloud job ' + item.kind + ': ' + item.errorCode,
      );
    }
    throw new Error('Cloud job deadline exceeded');
  }
  async function versions(prefix: string) {
    const all: { Key: string; VersionId: string }[] = [];
    let key: string | undefined, version: string | undefined;
    do {
      const page = await s3.send(
        new ListObjectVersionsCommand({
          Bucket: bucket,
          Prefix: prefix,
          KeyMarker: key,
          VersionIdMarker: version,
        }),
      );
      all.push(
        ...[...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map(
          (v) => ({ Key: v.Key!, VersionId: v.VersionId! }),
        ),
      );
      key = page.NextKeyMarker;
      version = page.NextVersionIdMarker;
      if (!page.IsTruncated) break;
    } while (key);
    return all;
  }
  try {
    await owner.transaction(async (sql) => {
      await sql.query(
        'INSERT INTO qm.tenants(id,name) VALUES($1::uuid,$3),($2::uuid,$3)',
        [tenant, other, marker],
      );
      await sql.query(
        'INSERT INTO qm.memberships(tenant_id,actor_id,capabilities) VALUES($1::uuid,$2::uuid,ARRAY(SELECT jsonb_array_elements_text($3::jsonb)))',
        [tenant, actor, JSON.stringify(Capability.options)],
      );
    });
    seeded = true;
    const now = Math.floor(Date.now() / 1000);
    await dynamo.send(
      new PutCommand({
        TableName: 'quartermaster-dev-sessions',
        Item: {
          ...sessionKey,
          actorId: actor,
          csrf,
          authenticatedAt: now,
          expiresAt: now + 1800,
          expires_at: now + 1800,
        },
        ConditionExpression: 'attribute_not_exists(pk)',
      }),
    );
    const session = await request<{ memberships: { tenantId: string }[] }>(
      '/api/auth/session',
    );
    assert.deepEqual(
      session.memberships.map((v) => v.tenantId),
      [tenant],
    );
    await request(
      `/api/v1/tenants/${other}/assets`,
      'GET',
      undefined,
      undefined,
      403,
    );
    assert.deepEqual((await call<{ items: unknown[] }>('assets')).items, []);
    const asset = (
      await call<{ item: Asset }>('assets', 'POST', {
        name: 'Temporary acceptance unit',
        assetClass: 'air_conditioner',
        status: 'in_service',
        location: 'Isolated test location',
        manufacturer: 'Test',
        model: 'Probe',
        serialNumber: 'TEST',
        notes: 'Temporary fixture; removed by this probe',
        details: { replacementMinor: 10000 },
      })
    ).item;
    console.log(
      'Live session, CSRF-protected asset write and cross-tenant rejection passed.',
    );
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQokWP4TyJgGNVABGAgRhEyGNVADKB9KAEAr639H8LdEzEAAAAASUVORK5CYII=',
      'base64',
    );
    const upload = (
      await call<{
        item: { id: string; url: string; fields: Record<string, string> };
      }>('media/uploads', 'POST', {
        assetId: asset.id,
        conversationId: null,
        intent: 'other',
        contentType: 'image/png',
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    ).item;
    const form = new FormData();
    Object.entries(upload.fields).forEach(([k, v]) => form.append(k, v));
    form.append('file', new Blob([bytes], { type: 'image/png' }), 'probe.png');
    const uploaded = await fetch(upload.url, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(20000),
    });
    assert.ok(uploaded.ok, 'Private S3 upload rejected: ' + uploaded.status);
    const queued = await call<{ item: Job }>(
      `media/${upload.id}/complete`,
      'POST',
      {},
    );
    await job(queued.item.id);
    const media = (await call<{ items: Media[] }>(`media?assetId=${asset.id}`))
      .items[0]!;
    assert.equal(media.state, 'ready');
    assert.ok(media.observation, 'Real Bedrock image observation missing');
    const link = await call<{ url: string }>(`media/${media.id}/url`);
    assert.equal((await fetch(link.url)).status, 200);
    assert.equal((await fetch(link.url.split('?')[0]!)).status, 403);
    console.log(
      'Private upload, native ARM64 resize, Bedrock observation and signed photo access passed.',
    );
    const capture = (
      await call<{ item: { id: string; version: number } }>(
        'conversations',
        'POST',
        { draft: {} },
      )
    ).item;
    const silence = await call<{ code: string }>(
      `conversations/${capture.id}/transcribe`,
      'POST',
      { pcm: Buffer.alloc(32000).toString('base64') },
      undefined,
      422,
    );
    assert.equal(silence.code, 'no_speech_detected');
    const turn = await call<{ item: Job }>(
      `conversations/${capture.id}/turns`,
      'POST',
      {
        text: 'Record a test appliance in the kitchen. I cannot read the nameplate. Ask one next question without inventing facts.',
        draft: {},
      },
      capture.version,
    );
    await job(turn.item.id);
    const proposal = await call<{ proposal: { reply: string } }>(
      `conversations/${capture.id}`,
    );
    assert.ok(proposal.proposal.reply);
    assert.equal(
      (await call<{ items: unknown[] }>('assets')).items.length,
      1,
      'Model must not write assets',
    );
    console.log(
      'Transcribe service access and human-gated conversational proposal passed (not a microphone or speech-accuracy test).',
    );
    const report = await call<{ items: unknown[] }>('reports', 'POST', {
      kind: 'insurance',
      asOf: new Date().toISOString().slice(0, 10),
    });
    assert.equal(report.items.length, 1);
    const pack = await call<{ item: Job }>('exports', 'POST', {
      includePhotos: true,
    });
    await job(pack.item.id);
    const download = await call<{ url: string }>(
      `jobs/${pack.item.id}/download`,
    );
    const archive = unzipSync(
      new Uint8Array(await (await fetch(download.url)).arrayBuffer()),
    );
    assert.equal(
      JSON.parse(strFromU8(archive['estate.json']!)).assets[0].id,
      asset.id,
    );
    assert.ok(archive[`photos/${media.id}.jpg`]);
    const removal = await call<{ item: Job }>(
      'assets/' + asset.id,
      'DELETE',
      {},
      asset.version,
    );
    await job(removal.item.id);
    assert.deepEqual((await call<{ items: unknown[] }>('assets')).items, []);
    for (const prefix of ['quarantine', 'originals', 'resized', 'exports'])
      assert.equal(
        (await versions(`${prefix}/${tenant}/`)).length,
        0,
        'Live object versions survived purge',
      );
    assert.ok(
      (
        await dynamo.send(
          new GetCommand({
            TableName: 'quartermaster-dev-deletions',
            Key: { pk: tenant, sk: 'asset#' + asset.id },
            ConsistentRead: true,
          }),
        )
      ).Item,
      'Deletion ledger missing',
    );
    console.log(
      'Insurance report, checksummed photo export, version-aware purge and independent deletion ledger passed.',
    );
  } finally {
    await dynamo.send(
      new DeleteCommand({
        TableName: 'quartermaster-dev-sessions',
        Key: sessionKey,
      }),
    );
    // Exact newly generated tenant prefixes only; no broad bucket deletion.
    for (const prefix of ['quarantine', 'originals', 'resized', 'exports']) {
      const objects = await versions(`${prefix}/${tenant}/`);
      for (let i = 0; i < objects.length; i += 1000) {
        const r = await s3.send(
          new DeleteObjectsCommand({
            Bucket: bucket,
            Delete: { Objects: objects.slice(i, i + 1000), Quiet: true },
          }),
        );
        assert.ok(!r.Errors?.length, 'Fixture object cleanup failed');
      }
    }
    if (seeded)
      await owner.transaction(async (sql) => {
        const rows = await sql.query<{ name: string }>(
          'SELECT name FROM qm.tenants WHERE id=$1::uuid OR id=$2::uuid',
          [tenant, other],
        );
        assert.ok(
          rows.every((r) => r.name === marker),
          'Fixture identity mismatch',
        );
        for (const table of [
          'turns',
          'media',
          'conversations',
          'record_history',
          'snapshot_items',
          'rule_effects',
          'records',
          'readings',
          'maintenance',
          'drafts',
          'assets',
          'memberships',
          'mutations',
          'jobs',
          'audit_events',
          'deletion_metadata',
        ])
          await sql.query(
            `DELETE FROM qm.${table} WHERE tenant_id=$1::uuid OR tenant_id=$2::uuid`,
            [tenant, other],
          );
        await sql.query(
          'DELETE FROM qm.tenants WHERE id=$1::uuid OR id=$2::uuid',
          [tenant, other],
        );
      });
    let next: string | undefined;
    do {
      const page = await scheduler.send(
        new ListSchedulesCommand({
          GroupName: 'quartermaster-dev-estate',
          NextToken: next,
        }),
      );
      for (const item of page.Schedules ?? []) {
        const s = await scheduler.send(
          new GetScheduleCommand({
            Name: item.Name,
            GroupName: 'quartermaster-dev-estate',
          }),
        );
        if (s.Target?.Input && JSON.parse(s.Target.Input).tenant === tenant)
          await scheduler.send(
            new DeleteScheduleCommand({
              Name: item.Name,
              GroupName: 'quartermaster-dev-estate',
            }),
          );
      }
      next = page.NextToken;
    } while (next);
    console.log(
      'Temporary sessions, fixture rows, live objects and fixture schedules removed; content-free backup tombstones retain their normal expiry.',
    );
  }
}
