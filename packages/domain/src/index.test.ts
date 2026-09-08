import { describe, expect, it } from 'vitest';
import { Asset, DeletionMetadata } from '@quartermaster/contracts';
import {
  afterCalendarMonths,
  afterDays,
  budgetLevel,
  deletionMetadata,
  filterEstate,
  mayReadRetainedContent,
  retentionDeadline,
  shouldRetainResizedPhoto,
} from './index';

const tenantId = '11111111-1111-4111-8111-111111111111';
const asset = Asset.parse({
  id: '22222222-2222-4222-8222-222222222222',
  tenantId,
  version: 1,
  name: 'Roof AC',
  assetClass: 'air_conditioner',
  status: 'needs_attention',
  location: 'Main building · NW roof',
  manufacturer: 'Example',
  model: 'AC-10',
  serialNumber: 'PRIVATE-SERIAL',
  notes: 'PRIVATE-NOTE',
  updatedAt: '2026-09-07T12:00:00.000Z',
});

describe('retention policy', () => {
  it.each(['original', 'transcript'] as const)(
    '%s expires at 15 days',
    (kind) => {
      expect(
        retentionDeadline(kind, new Date('2026-09-07T12:00:00Z')).toISOString(),
      ).toBe('2026-09-22T12:00:00.000Z');
    },
  );
  it('retains backups for the explicit 90-day convention', () => {
    expect(
      retentionDeadline(
        'backup',
        new Date('2026-09-07T12:00:00Z'),
      ).toISOString(),
    ).toBe('2026-12-06T12:00:00.000Z');
  });
  it('retains audits for one calendar year, including leap-day clamping', () => {
    expect(
      retentionDeadline(
        'audit',
        new Date('2024-02-29T12:00:00Z'),
      ).toISOString(),
    ).toBe('2025-02-28T12:00:00.000Z');
  });
  it('clamps month-end without overflowing into another month', () => {
    expect(
      afterCalendarMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString(),
    ).toBe('2026-02-28T12:00:00.000Z');
  });
  it('denies access exactly at expiry and immediately after deletion', () => {
    const expiry = new Date('2026-09-22T12:00:00Z');
    expect(
      mayReadRetainedContent(expiry, new Date(expiry.getTime() - 1), null),
    ).toBe(true);
    expect(mayReadRetainedContent(expiry, expiry, null)).toBe(false);
    expect(
      mayReadRetainedContent(
        expiry,
        new Date('2026-09-08T12:00:00Z'),
        new Date('2026-09-08T11:00:00Z'),
      ),
    ).toBe(false);
  });
  it('rejects malformed retention inputs', () => {
    expect(() => afterDays(new Date('invalid'), 15)).toThrow();
    expect(() => afterDays(new Date(), -1)).toThrow();
    expect(() => afterCalendarMonths(new Date(), 1.5)).toThrow();
  });
});

describe('resized photo retention', () => {
  const retained = {
    photoDeletedAt: null,
    assetDeletedAt: null,
    tenantDeletedAt: null,
  };
  it('keeps resized photos even decades after original expiry', () => {
    const expiry = retentionDeadline('original', new Date('2026-09-07'));
    expect(mayReadRetainedContent(expiry, new Date('2056-09-07'), null)).toBe(
      false,
    );
    expect(shouldRetainResizedPhoto(retained)).toBe(true);
  });
  it.each(['photoDeletedAt', 'assetDeletedAt', 'tenantDeletedAt'] as const)(
    'stops retaining the photo on %s',
    (field) => {
      expect(
        shouldRetainResizedPhoto({
          ...retained,
          [field]: new Date('2026-09-08'),
        }),
      ).toBe(false);
    },
  );
});

describe('minimal deletion metadata', () => {
  it('retains the timestamp and opaque identifiers without deleted content', () => {
    const metadata = deletionMetadata(asset, new Date('2026-09-08T12:00:00Z'));
    expect(metadata.deletedAt).toBe('2026-09-08T12:00:00.000Z');
    expect(Object.keys(metadata).sort()).toEqual([
      'deletedAt',
      'entityId',
      'entityType',
      'policyVersion',
      'tenantId',
    ]);
    expect(JSON.stringify(metadata)).not.toContain('PRIVATE');
  });
  it('rejects content smuggled into metadata', () => {
    expect(() =>
      DeletionMetadata.parse({
        ...deletionMetadata(asset, new Date()),
        notes: asset.notes,
      }),
    ).toThrow();
  });
});

it('filters search results by tenant even when a search matches another tenant', () => {
  const other = {
    ...asset,
    tenantId: '33333333-3333-4333-8333-333333333333',
    name: 'Other AC',
  };
  expect(filterEstate([asset, other], tenantId, 'ac')).toEqual([asset]);
  expect(filterEstate([asset, other], tenantId, 'other')).toEqual([]);
});

it.each([
  [0, 'normal'],
  [49.99, 'normal'],
  [50, 'notice'],
  [80, 'warning'],
  [100, 'exceeded'],
  [120, 'exceeded'],
] as const)('classifies $%s as %s', (amount, expected) =>
  expect(budgetLevel(amount)).toBe(expected),
);
it('rejects invalid spending inputs', () =>
  expect(() => budgetLevel(Number.NaN)).toThrow());
