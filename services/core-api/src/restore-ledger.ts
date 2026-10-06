import { z } from 'zod';
import type { Database } from './database';
export const Tombstone = z.object({
  pk: z.uuid(),
  entityId: z.uuid(),
  entityType: z.enum([
    'tenant',
    'asset',
    'media',
    'capture',
    'draft',
    'record',
    'transcript',
  ]),
  deletedAt: z.iso.datetime(),
});
export type Tombstone = z.infer<typeof Tombstone>;
// Operator-only restore preparation. Every query is explicitly tenant-bound
// because this runs against an isolated restore with migration-owner access.
// The caller must prove that neither the database nor media bucket is live.
export async function replayDeletions(
  database: Database,
  rows: Tombstone[],
  purge: (prefix: string) => Promise<void>,
) {
  let replayed = 0;
  for (const raw of rows) {
    const row = Tombstone.parse(raw);
    await database.transaction(async (sql) => {
      const all = row.entityType === 'tenant';
      const media = await sql.query<{ id: string }>(
        `SELECT id FROM qm.media WHERE tenant_id=$1::uuid AND ($2 OR ($3='asset' AND asset_id=$4::uuid) OR ($3='media' AND id=$4::uuid) OR ($3='capture' AND conversation_id=$4::uuid))`,
        [row.pk, all, row.entityType, row.entityId],
      );
      if (all)
        for (const prefix of ['quarantine', 'originals', 'resized'])
          await purge(`${prefix}/${row.pk}/`);
      else {
        const ids = new Set(media.map((m) => m.id));
        if (row.entityType === 'media') ids.add(row.entityId);
        for (const id of ids)
          for (const prefix of ['quarantine', 'originals', 'resized'])
            await purge(`${prefix}/${row.pk}/${id}/`);
      }
      await purge(`exports/${row.pk}/`);
      await sql.query(
        "UPDATE qm.jobs SET state='failed',result='{}',error_code='restore_export_invalidated' WHERE tenant_id=$1::uuid AND kind='export'",
        [row.pk],
      );
      if (all) {
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
        ])
          await sql.query(`DELETE FROM qm.${table} WHERE tenant_id=$1::uuid`, [
            row.pk,
          ]);
        await sql.query('DELETE FROM qm.tenants WHERE id=$1::uuid', [row.pk]);
      } else {
        const table = {
          asset: 'assets',
          media: 'media',
          capture: 'conversations',
          draft: 'drafts',
          record: 'records',
          transcript: 'turns',
        }[row.entityType as Exclude<Tombstone['entityType'], 'tenant'>];
        if (row.entityType === 'record')
          await sql.query(
            "DELETE FROM qm.records WHERE tenant_id=$1::uuid AND kind='assessments' AND content->>'incidentId'=$2",
            [row.pk, row.entityId],
          );
        await sql.query(
          `DELETE FROM qm.${table} WHERE tenant_id=$1::uuid AND id=$2::uuid`,
          [row.pk, row.entityId],
        );
        await sql.query(
          "DELETE FROM qm.jobs WHERE tenant_id=$1::uuid AND (payload->>'assetId'=$2 OR payload->>'mediaId'=$2 OR payload->>'conversationId'=$2 OR payload->>'recordId'=$2 OR payload->>'draftId'=$2)",
          [row.pk, row.entityId],
        );
      }
    });
    replayed++;
  }
  // Expired transcripts/audit cannot be resurrected by restoring old storage.
  await database.transaction(async (sql) => {
    await sql.query('DELETE FROM qm.turns WHERE expires_at<=now()');
    await sql.query(
      'UPDATE qm.conversations SET proposal=NULL WHERE proposal_expires_at<=now()',
    );
    await sql.query('DELETE FROM qm.audit_events WHERE expires_at<=now()');
    await sql.query(
      "DELETE FROM qm.deletion_metadata WHERE deleted_at<=now()-interval '90 days'",
    );
  });
  return { replayed };
}
