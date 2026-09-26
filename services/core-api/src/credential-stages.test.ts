import { expect, it } from 'vitest';
import { initialCredentialStages } from './credential-stages';

it('allows empty containers and resumes the first current/pending version', () => {
  expect(initialCredentialStages()).toEqual({
    current: undefined,
    pending: undefined,
  });
  expect(
    initialCredentialStages({ first: ['AWSCURRENT', 'AWSPENDING'] }),
  ).toEqual({ current: 'first', pending: 'first' });
  expect(initialCredentialStages({ first: ['AWSPENDING'] })).toEqual({
    current: undefined,
    pending: 'first',
  });
});

it('refuses completed credentials and rotations over a different current version', () => {
  expect(() => initialCredentialStages({ first: ['AWSCURRENT'] })).toThrow(
    'already exists',
  );
  expect(() =>
    initialCredentialStages({ first: ['AWSCURRENT'], second: ['AWSPENDING'] }),
  ).toThrow('already exists');
});
