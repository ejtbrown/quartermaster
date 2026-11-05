import { describe, expect, it } from 'vitest';
import type { Membership } from '@quartermaster/contracts';
import { destination, readDestination } from './navigation';
const writer: Membership = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  name: 'Test estate',
  synthetic: true,
  capabilities: ['assets:read', 'assets:write'],
};
describe('workspace entry destinations', () => {
  it('defaults desktop to Assets and mobile writers to Capture, with read-only fallback', () => {
    expect(readDestination('', writer, false).section).toBe('Assets');
    expect(readDestination('', writer, true).section).toBe('Capture');
    expect(
      readDestination('', { ...writer, capabilities: ['assets:read'] }, true)
        .section,
    ).toBe('Assets');
  });
  it('honors explicit destinations and reserves verbal capture for mobile writers', () => {
    expect(readDestination('#maintenance', writer, true).section).toBe(
      'Maintenance',
    );
    expect(readDestination('#assets', writer, true).section).toBe('Assets');
    expect(readDestination('#capture', writer, false).section).toBe('Assets');
    expect(
      readDestination(
        '#capture',
        { ...writer, capabilities: ['assets:read'] },
        true,
      ).section,
    ).toBe('Assets');
    expect(readDestination('#team', writer, false).section).toBe('Assets');
  });
  it('drops cross-workspace context and unknown editor fields', () => {
    const wrong = readDestination(
      '#assets?workspace=another&asset=secret&q=private',
      writer,
      false,
    );
    expect(wrong.params.size).toBe(0);
    const route = readDestination(
      '#assets?asset=123&detail=Photos&notes=private&password=secret',
      writer,
      false,
    );
    expect(Object.fromEntries(route.params)).toEqual({
      asset: '123',
      detail: 'Photos',
    });
  });
  it('round-trips applied filters without turning search text into a route', () => {
    const hash = destination('Assets', {
      q: 'Roof ? # & /',
      locationId: 'a',
      status: '',
      detail: 'Related records',
    });
    const route = readDestination(hash, writer, false);
    expect(route.params.get('q')).toBe('Roof ? # & /');
    expect(route.params.get('detail')).toBe('Related records');
    expect(route.params.has('status')).toBe(false);
  });
});
