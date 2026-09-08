import { z } from 'zod';

export const AssetClass = z.enum(['air_conditioner', 'appliance']);
export const AssetStatus = z.enum([
  'in_service',
  'needs_attention',
  'out_of_service',
]);
export const Asset = z
  .object({
    id: z.uuid(),
    tenantId: z.uuid(),
    version: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    assetClass: AssetClass,
    status: AssetStatus,
    location: z.string().trim().min(1).max(240),
    manufacturer: z.string().max(120).nullable(),
    model: z.string().max(120).nullable(),
    serialNumber: z.string().max(120).nullable(),
    notes: z.string().max(4000),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Asset = z.infer<typeof Asset>;

// No names, descriptions, images, transcripts, object URLs, or actor emails.
export const DeletionMetadata = z
  .object({
    entityId: z.uuid(),
    tenantId: z.uuid(),
    entityType: z.enum(['asset', 'tenant', 'media', 'transcript']),
    deletedAt: z.iso.datetime(),
    policyVersion: z.literal('2026-09-07'),
  })
  .strict();
export type DeletionMetadata = z.infer<typeof DeletionMetadata>;

export const DevelopmentSettings = Object.freeze({
  region: 'us-east-2',
  approvedRegions: ['us-east-2', 'us-east-1', 'us-west-2'] as const,
  domain: 'qm.ejtbrown.com',
  monthlyBudgetUsd: 100,
  originalRetentionDays: 15,
  resizedPhotoRetention: 'until_photo_asset_or_tenant_deletion',
  transcriptRetentionDays: 15,
  auditRetentionMonths: 12,
  backupRetentionDays: 90,
  recoveryTimeHours: 24,
  preferredRecoveryPointHours: 24,
  maximumRecoveryPointHours: 168,
  destructiveCleanupEnabled: false,
});
