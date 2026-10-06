import { z } from 'zod';

const text = (max = 4000) => z.string().trim().max(max);
const date = z.iso.date();
const id = z.uuid();
const money = z.number().int().min(0).max(1_000_000_000_000);
export const AssetDetails = z
  .object({
    assetTag: text(80).optional(),
    locationId: id.nullable().optional(),
    parentAssetId: id.nullable().optional(),
    condition: z.enum(['unknown', 'good', 'fair', 'poor', 'failed']).optional(),
    criticality: z.enum(['low', 'normal', 'high', 'critical']).optional(),
    acquiredOn: date.nullable().optional(),
    inServiceOn: date.nullable().optional(),
    warrantyUntil: date.nullable().optional(),
    replacementOn: date.nullable().optional(),
    costMinor: money.optional(),
    replacementMinor: money.optional(),
    residualMinor: money.optional(),
    usefulLifeMonths: z.number().int().min(1).max(1200).optional(),
    currency: z.literal('USD').optional(),
    costCenter: text(120).optional(),
    capitalized: z.boolean().optional(),
    disposedOn: date.nullable().optional(),
    proceedsMinor: money.optional(),
    disposalReason: text(1000).optional(),
    attributes: z
      .record(
        z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
        z.union([text(500), z.number().finite(), z.boolean()]),
      )
      .refine((v) => Object.keys(v).length <= 30)
      .optional(),
  })
  .strict()
  .refine(
    (v) => (v.residualMinor ?? 0) <= (v.costMinor ?? 0),
    'Residual cannot exceed cost',
  );
export type AssetDetails = z.infer<typeof AssetDetails>;

export const RecordSchemas = {
  locations: z
    .object({
      name: text(160).min(1),
      kind: z.enum(['site', 'building', 'floor', 'area']),
      parentId: id.nullable(),
      address: text(500),
      notes: text(),
    })
    .strict(),
  types: z
    .object({
      name: text(160).min(1),
      code: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
      description: text(),
      fields: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
              label: text(120).min(1),
              type: z.enum(['text', 'number', 'boolean']),
              required: z.boolean(),
            })
            .strict(),
        )
        .max(30),
      captureIntents: z.array(text(80).min(1)).max(12),
    })
    .strict(),
  components: z
    .object({
      name: text(160).min(1),
      kind: text(80),
      accessConstraints: text(),
      notes: text(),
    })
    .strict(),
  valuations: z
    .object({
      basis: z.enum(['replacement', 'market', 'appraised']),
      amountMinor: money,
      currency: z.literal('USD'),
      effectiveOn: date,
      notes: text(),
    })
    .strict(),
  policies: z
    .object({
      name: text(160).min(1),
      carrier: text(160),
      reference: text(120),
      startsOn: date,
      endsOn: date,
      limitMinor: money,
      deductibleMinor: money,
      locationId: id.nullable(),
      assetClass: text(60),
      notes: text(),
    })
    .strict()
    .refine((v) => v.endsOn >= v.startsOn),
  incidents: z
    .object({
      name: text(160).min(1),
      kind: z.enum(['storm', 'fire', 'flood', 'theft', 'other']),
      occurredOn: date,
      locationId: id.nullable(),
      reference: text(120),
      notes: text(),
    })
    .strict(),
  assessments: z
    .object({
      incidentId: id,
      condition: z.enum(['unaffected', 'damaged', 'destroyed', 'missing']),
      operable: z.boolean(),
      repairMinor: money,
      replacementMinor: money,
      notes: text(),
    })
    .strict(),
  books: z
    .object({
      name: text(160).min(1),
      method: z.literal('straight_line'),
      asOf: date,
      notes: text(),
    })
    .strict(),
  transactions: z
    .object({
      kind: z.enum(['acquisition', 'transfer', 'impairment', 'disposal']),
      effectiveOn: date,
      amountMinor: money,
      notes: text(),
    })
    .strict(),
  plans: z
    .object({
      name: text(160).min(1),
      nextDueOn: date,
      intervalMonths: z.number().int().min(1).max(120),
      procedure: text(),
      assigneeId: id.nullable(),
      estimatedMinor: money,
    })
    .strict(),
  work_logs: z
    .object({
      maintenanceId: id,
      workedOn: date,
      minutes: z.number().int().min(0).max(100000),
      partsMinor: money,
      laborMinor: money,
      vendor: text(160),
      notes: text(),
    })
    .strict(),
  rules: z
    .object({
      name: text(160).min(1),
      field: z.enum([
        'status',
        'assetClass',
        'location',
        'replacementOn',
        'warrantyUntil',
      ]),
      operator: z.enum(['equals', 'contains', 'before']),
      value: text(240),
      action: z.enum(['flag', 'maintenance']),
      title: text(240).min(1),
      dueOn: date.nullable(),
      enabled: z.boolean(),
    })
    .strict(),
  views: z
    .object({
      name: text(160).min(1),
      query: text(160),
      status: text(40),
      assetClass: text(60),
      locationId: id.nullable(),
    })
    .strict(),
} as const;
export type RecordKind = keyof typeof RecordSchemas;
export interface EstateRecord {
  id: string;
  kind: RecordKind;
  assetId: string | null;
  version: number;
  content: Record<string, unknown>;
  updatedAt: string;
}
export const RecordInput = z
  .object({
    assetId: id.nullable(),
    content: z.record(z.string(), z.unknown()),
  })
  .strict();
export const MediaIntent = z.enum([
  'nameplate',
  'whole_unit',
  'outdoor_coil',
  'compressor',
  'damage_detail',
  'document',
  'other',
]);
export const UploadInput = z
  .object({
    assetId: id.nullable(),
    conversationId: id.nullable(),
    intent: MediaIntent,
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    bytes: z
      .number()
      .int()
      .min(1)
      .max(12 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict()
  .refine((v) => Boolean(v.assetId) !== Boolean(v.conversationId));
export interface Media {
  id: string;
  assetId: string | null;
  conversationId: string | null;
  version: number;
  intent: z.infer<typeof MediaIntent>;
  state: 'uploading' | 'processing' | 'ready' | 'failed' | 'deleting';
  width: number | null;
  height: number | null;
  sha256: string;
  observation: Record<string, unknown> | null;
  createdAt: string;
}
export const ReportInput = z
  .object({
    kind: z.enum([
      'estate',
      'maintenance',
      'insurance',
      'accounting',
      'quality',
      'incident',
    ]),
    asOf: date,
    incidentId: id.nullable().optional(),
    query: text(160).default(''),
    status: text(40).default(''),
    assetClass: text(60).default(''),
    locationId: id.nullable().optional(),
  })
  .strict();
export const MemberInput = z
  .object({
    email: z.email().max(254),
    capabilities: z.array(z.string()).min(1).max(12),
  })
  .strict();
export const TenantInput = z
  .object({
    name: text(160).min(1),
    timeZone: z
      .string()
      .max(80)
      .refine((v) => {
        try {
          new Intl.DateTimeFormat('en-US', { timeZone: v });
          return true;
        } catch {
          return false;
        }
      }),
  })
  .strict();
export interface Job {
  id: string;
  kind: string;
  state: 'queued' | 'running' | 'complete' | 'failed';
  result: Record<string, unknown>;
  errorCode: string | null;
  createdAt: string;
}

// The model may propose only this bounded structure; it cannot call storage,
// execute SQL or authorize writes. A separate human confirmation commits it.
export const CaptureProposal = z
  .object({
    reply: text(1200).min(1),
    components: z.array(RecordSchemas.components).max(10).default([]),
    fields: z
      .object({
        name: text(160),
        assetClass: z.string().regex(/^[a-z][a-z0-9_]{0,59}$/),
        location: text(240),
        manufacturer: text(120).nullable(),
        model: text(120).nullable(),
        serialNumber: text(120).nullable(),
        notes: text(),
      })
      .partial()
      .strict(),
    maintenance: z
      .array(
        z
          .object({
            title: text(240).min(1),
            dueDate: date.nullable(),
            notes: text(),
          })
          .strict(),
      )
      .max(10),
    readings: z
      .array(
        z
          .object({
            label: text(120).min(1),
            value: z.number().finite().min(-1e12).max(1e12),
            unit: text(40).min(1),
            notes: text(2000),
          })
          .strict(),
      )
      .max(10),
    requestedPhoto: MediaIntent.nullable(),
    readyForReview: z.boolean(),
  })
  .strict();
export type CaptureProposal = z.infer<typeof CaptureProposal>;
export const ImageObservation = z
  .object({
    kind: MediaIntent,
    confidence: z.number().min(0).max(1),
    manufacturer: text(120).nullable(),
    model: text(120).nullable(),
    serialNumber: text(120).nullable(),
    description: text(1200),
  })
  .strict();
