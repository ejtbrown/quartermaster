import {
  RDSDataClient,
  BeginTransactionCommand,
  ExecuteStatementCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
} from '@aws-sdk/client-rds-data';
import type {
  ExecuteStatementCommandOutput,
  Field,
} from '@aws-sdk/client-rds-data';
export type SqlValue = string | number | boolean | null;
export interface Sql {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: SqlValue[],
  ): Promise<T[]>;
}
export interface Database {
  transaction<T>(action: (sql: Sql) => Promise<T>): Promise<T>;
}
function fieldValue(field: Field): unknown {
  if (field.isNull) return null;
  if (field.stringValue !== undefined) return field.stringValue;
  if (field.longValue !== undefined) return field.longValue;
  if (field.doubleValue !== undefined) return field.doubleValue;
  if (field.booleanValue !== undefined) return field.booleanValue;
  throw new Error('Unsupported database field');
}
export function decodeRecords(
  response: ExecuteStatementCommandOutput,
): Record<string, unknown>[] {
  return (response.records ?? []).map((record) =>
    Object.fromEntries(
      record.map((field, index) => {
        const column = response.columnMetadata?.[index];
        if (!column?.name) throw new Error('Missing database column metadata');
        const value = fieldValue(field);
        return [
          column.name,
          typeof value === 'string' &&
          ['json', 'jsonb'].includes(column.typeName ?? '')
            ? JSON.parse(value)
            : value,
        ];
      }),
    ),
  );
}
export class DataApiDatabase implements Database {
  constructor(
    private config: {
      resourceArn: string;
      secretArn: string;
      database: string;
    },
    private client = new RDSDataClient({ region: 'us-east-2', maxAttempts: 1 }),
  ) {}
  async transaction<T>(action: (sql: Sql) => Promise<T>): Promise<T> {
    const { transactionId } = await this.client.send(
      new BeginTransactionCommand(this.config),
    );
    if (!transactionId) throw new Error('Missing transaction');
    const query: Sql['query'] = async (sql, values = []) => {
      const response = await this.client.send(
        new ExecuteStatementCommand({
          ...this.config,
          transactionId,
          sql: sql.replace(/\$(\d+)/g, ':p$1'),
          includeResultMetadata: true,
          parameters: values.map((value, index) => ({
            name: `p${index + 1}`,
            value:
              value === null
                ? { isNull: true }
                : typeof value === 'number'
                  ? { doubleValue: value }
                  : typeof value === 'boolean'
                    ? { booleanValue: value }
                    : { stringValue: value },
          })),
        }),
      );
      // JSON-format mode only applies to SELECT, not INSERT/UPDATE RETURNING.
      // Decode both paths identically, including JSONB drafts and capabilities.
      return decodeRecords(response) as never;
    };
    try {
      const value = await action({ query });
      await this.client.send(
        new CommitTransactionCommand({ ...this.config, transactionId }),
      );
      return value;
    } catch (error) {
      try {
        await this.client.send(
          new RollbackTransactionCommand({ ...this.config, transactionId }),
        );
      } catch {
        /* Never expose SQL, credentials or content. */
      }
      throw error;
    }
  }
}
