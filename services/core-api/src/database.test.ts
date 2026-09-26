import { expect, it } from 'vitest';
import { decodeRecords } from './database';
it('decodes SELECT and DML RETURNING including JSON columns without losing nulls or numbers', () => {
  expect(
    decodeRecords({
      $metadata: {},
      columnMetadata: [
        { name: 'id', typeName: 'uuid' },
        { name: 'content', typeName: 'jsonb' },
        { name: 'capabilities', typeName: 'json' },
        { name: 'version', typeName: 'int4' },
        { name: 'synthetic', typeName: 'bool' },
        { name: 'notes', typeName: 'text' },
        { name: 'value', typeName: 'float8' },
      ],
      records: [
        [
          { stringValue: 'id' },
          { stringValue: '{"name":"Draft"}' },
          { stringValue: '["assets:read"]' },
          { longValue: 2 },
          { booleanValue: true },
          { isNull: true },
          { doubleValue: 4.3 },
        ],
      ],
    }),
  ).toEqual([
    {
      id: 'id',
      content: { name: 'Draft' },
      capabilities: ['assets:read'],
      version: 2,
      synthetic: true,
      notes: null,
      value: 4.3,
    },
  ]);
});
it('fails closed for unexpected or metadata-less result columns', () => {
  expect(() =>
    decodeRecords({ $metadata: {}, records: [[{ stringValue: 'secret' }]] }),
  ).toThrow('Missing database column metadata');
  expect(() =>
    decodeRecords({
      $metadata: {},
      columnMetadata: [{ name: 'array' }],
      records: [[{ arrayValue: { stringValues: ['a'] } }]],
    }),
  ).toThrow('Unsupported database field');
});
