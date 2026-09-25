#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2cf59c656c6a2b08c637713ebe50571570e1f6708857caf9e4058e25d88a6aba/contract';
import endContract from '../../snapshots/2cf59c656c6a2b08c637713ebe50571570e1f6708857caf9e4058e25d88a6aba/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/c452bc7af2468a3fa5120749196a76b07c4792fd47fd250c4e0666a94252cf76/contract';
import startContract from '../../snapshots/c452bc7af2468a3fa5120749196a76b07c4792fd47fd250c4e0666a94252cf76/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('contentHash', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('errorCode', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('errorMessage', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('mimeType', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('sizeBytes', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('status', 'text', {
          notNull: true,
          default: lit('READY'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'source',
        column: col('storageKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'source',
        constraint: 'source_status_check_a5b0d0d9',
        expression: "\"status\" IN ('QUEUED', 'PROCESSING', 'READY', 'FAILED')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'source',
        index: 'source_projectId_contentHash_idx_1db464cf',
        columns: ['projectId', 'contentHash'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'source',
        index: 'source_storageKey_idx_8c086641',
        columns: ['storageKey'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
