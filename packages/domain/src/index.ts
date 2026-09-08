import {
  Asset,
  DeletionMetadata,
  DevelopmentSettings,
} from '@quartermaster/contracts';

function validDate(value: Date): Date {
  if (!Number.isFinite(value.getTime())) throw new Error('Invalid timestamp');
  return new Date(value.getTime());
}

export function afterDays(start: Date, days: number): Date {
  if (!Number.isSafeInteger(days) || days < 0)
    throw new Error('Invalid retention days');
  return validDate(new Date(validDate(start).getTime() + days * 86_400_000));
}

export function afterCalendarMonths(start: Date, months: number): Date {
  if (!Number.isSafeInteger(months) || months < 0)
    throw new Error('Invalid retention months');
  const result = validDate(start);
  const originalDay = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(originalDay, lastDay));
  return validDate(result);
}

export function retentionDeadline(
  kind: 'original' | 'transcript' | 'audit' | 'backup',
  createdAt: Date,
): Date {
  switch (kind) {
    case 'original':
      return afterDays(createdAt, DevelopmentSettings.originalRetentionDays);
    case 'transcript':
      return afterDays(createdAt, DevelopmentSettings.transcriptRetentionDays);
    case 'audit':
      return afterCalendarMonths(
        createdAt,
        DevelopmentSettings.auditRetentionMonths,
      );
    case 'backup':
      return afterDays(createdAt, DevelopmentSettings.backupRetentionDays);
  }
}

// Enforce at read/grant time: a delayed storage sweeper must not extend access.
export function mayReadRetainedContent(
  expiresAt: Date,
  now: Date,
  deletedAt: Date | null,
): boolean {
  return (
    deletedAt === null &&
    validDate(now).getTime() < validDate(expiresAt).getTime()
  );
}

// Retention only, not authorization: callers must separately verify tenant
// membership. Resized photos have no age-based expiry, even after originals do.
export function shouldRetainResizedPhoto(deletion: {
  photoDeletedAt: Date | null;
  assetDeletedAt: Date | null;
  tenantDeletedAt: Date | null;
}): boolean {
  return (
    deletion.photoDeletedAt === null &&
    deletion.assetDeletedAt === null &&
    deletion.tenantDeletedAt === null
  );
}

export function deletionMetadata(
  asset: Asset,
  deletedAt: Date,
): DeletionMetadata {
  const value = Asset.parse(asset);
  return DeletionMetadata.parse({
    entityId: value.id,
    tenantId: value.tenantId,
    entityType: 'asset',
    deletedAt: validDate(deletedAt).toISOString(),
    policyVersion: '2026-09-07',
  });
}

export function filterEstate(
  assets: readonly Asset[],
  tenantId: string,
  query: string,
): Asset[] {
  const search = query.trim().toLocaleLowerCase('en-US');
  return assets.filter(
    (asset) =>
      asset.tenantId === tenantId &&
      [
        asset.name,
        asset.location,
        asset.manufacturer,
        asset.model,
        asset.serialNumber,
      ].some((value) => value?.toLocaleLowerCase('en-US').includes(search)),
  );
}

export function budgetLevel(
  spendUsd: number,
): 'normal' | 'notice' | 'warning' | 'exceeded' {
  if (!Number.isFinite(spendUsd) || spendUsd < 0)
    throw new Error('Invalid spending amount');
  const ratio = spendUsd / DevelopmentSettings.monthlyBudgetUsd;
  return ratio >= 1
    ? 'exceeded'
    : ratio >= 0.8
      ? 'warning'
      : ratio >= 0.5
        ? 'notice'
        : 'normal';
}
