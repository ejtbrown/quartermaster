import type {
  Asset,
  AssetDetails,
  EstateRecord,
} from '@quartermaster/contracts';

export function depreciation(details: AssetDetails, asOf: string) {
  const cost = details.costMinor ?? 0,
    residual = details.residualMinor ?? 0;
  const start = details.inServiceOn;
  if (
    !start ||
    !details.capitalized ||
    !details.usefulLifeMonths ||
    asOf < start
  )
    return { costMinor: cost, accumulatedMinor: 0, bookMinor: cost, months: 0 };
  const end =
    details.disposedOn && details.disposedOn < asOf ? details.disposedOn : asOf;
  const [sy, sm, sd] = start.split('-').map(Number),
    [ey, em, ed] = end.split('-').map(Number);
  const months = Math.max(
    0,
    Math.min(
      details.usefulLifeMonths,
      (ey! - sy!) * 12 +
        em! -
        sm! -
        (ed! < Math.min(sd!, new Date(Date.UTC(ey!, em!, 0)).getUTCDate())
          ? 1
          : 0),
    ),
  );
  const accumulatedMinor = Math.floor(
    ((cost - residual) * months) / details.usefulLifeMonths,
  );
  return {
    costMinor: cost,
    accumulatedMinor,
    bookMinor: cost - accumulatedMinor,
    months,
  };
}
export function quality(asset: Asset, photos: number) {
  const missing = [
    !asset.serialNumber && 'serial number',
    !asset.manufacturer && 'manufacturer',
    !asset.model && 'model',
    !asset.details?.locationId && 'structured location',
    !asset.details?.replacementMinor && 'replacement value',
    photos === 0 && 'photo',
  ].filter((v): v is string => Boolean(v));
  return { missing, score: Math.round(((6 - missing.length) / 6) * 100) };
}
export function matchesRule(asset: Asset, rule: EstateRecord['content']) {
  const field = String(rule.field),
    value =
      field === 'replacementOn' || field === 'warrantyUntil'
        ? asset.details?.[field]
        : (
            {
              status: asset.status,
              assetClass: asset.assetClass,
              location: asset.location,
            } as Record<string, string>
          )[field];
  if (!value) return false;
  const expected = String(rule.value);
  return rule.operator === 'equals'
    ? value === expected
    : rule.operator === 'contains'
      ? value.toLowerCase().includes(expected.toLowerCase())
      : rule.operator === 'before' && value < expected;
}
export function csvCell(value: unknown) {
  let text =
    value == null
      ? ''
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  // Spreadsheets interpret leading control/whitespace followed by a formula.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csv(rows: Record<string, unknown>[]) {
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return (
    '\ufeff' +
    [
      keys.map(csvCell).join(','),
      ...rows.map((row) => keys.map((key) => csvCell(row[key])).join(',')),
    ].join('\r\n')
  );
}
