import { z } from 'zod';
export const Identifier = z.uuid();

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

export const AssetInput = Asset.omit({
  id: true,
  tenantId: true,
  version: true,
  updatedAt: true,
});
export type AssetInput = z.infer<typeof AssetInput>;
export const Capability = z.enum([
  'assets:read',
  'assets:write',
  'maintenance:write',
  'audit:read',
]);
export type Capability = z.infer<typeof Capability>;
export const Membership = z
  .object({
    tenantId: z.uuid(),
    name: z.string(),
    capabilities: z.array(Capability),
    synthetic: z.boolean(),
  })
  .strict();
export type Membership = z.infer<typeof Membership>;
export const MaintenanceInput = z
  .object({
    title: z.string().trim().min(1).max(240),
    dueDate: z.iso.date().nullable(),
    status: z.enum(['open', 'in_progress', 'completed']),
    notes: z.string().max(4000),
  })
  .strict();
export type MaintenanceInput = z.infer<typeof MaintenanceInput>;
export const Maintenance = MaintenanceInput.extend({
  id: z.uuid(),
  assetId: z.uuid(),
  version: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
export type Maintenance = z.infer<typeof Maintenance>;
export const ReadingInput = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: z.number().finite().min(-1e12).max(1e12),
    unit: z.string().trim().min(1).max(40),
    observedAt: z.iso.datetime(),
    notes: z.string().max(2000),
  })
  .strict();
export type ReadingInput = z.infer<typeof ReadingInput>;
export const Reading = ReadingInput.extend({ id: z.uuid(), assetId: z.uuid() });
export type Reading = z.infer<typeof Reading>;
export const DraftInput = AssetInput.partial().strict();
export type DraftInput = z.infer<typeof DraftInput>;
export const Draft = z
  .object({
    id: z.uuid(),
    version: z.number().int().positive(),
    content: DraftInput,
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Draft = z.infer<typeof Draft>;
export interface SessionInfo {
  authenticated: boolean;
  authenticationEnabled: boolean;
  actorId?: string;
  csrfToken?: string;
  expiresAt?: string;
  memberships?: Membership[];
}
export interface AssetPage {
  items: Asset[];
  nextCursor: string | null;
}
export interface EstateSummary {
  assets: number;
  needsAttention: number;
  openTasks: number;
  overdueTasks: number;
}

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
