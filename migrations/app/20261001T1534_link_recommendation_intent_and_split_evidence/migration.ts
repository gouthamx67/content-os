#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/9376e3388ef8cc48503ead96c401950fa5ea2bd7550274ca3a165bcea7fcc08e/contract';
import startContract from '../../snapshots/9376e3388ef8cc48503ead96c401950fa5ea2bd7550274ca3a165bcea7fcc08e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f5537d84fb0917df614370dde52172e76a7de4e5a46372d43da01593b3d0b0da/contract';
import endContract from '../../snapshots/f5537d84fb0917df614370dde52172e76a7de4e5a46372d43da01593b3d0b0da/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropColumn({ schema: 'public', table: 'content_recommendation', column: 'isProgress' }),
      this.addColumn({
        schema: 'public',
        table: 'content_recommendation',
        column: col('entityIds', 'text[]', {
          notNull: true,
          default: lit([]),
          codecRef: { codecId: 'pg/text@1', many: true },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'content_recommendation',
        constraint: 'content_recommendation_entityIds_elem_not_null_78520e6f',
        expression: 'array_position("entityIds", NULL) IS NULL',
      }),
      this.createIndex({
        schema: 'public',
        table: 'content_recommendation',
        index: 'content_recommendation_selectedIntentId_idx_678d8fdb',
        columns: ['selectedIntentId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'content_recommendation',
        foreignKey: {
          name: 'content_recommendation_selectedIntentId_fkey',
          columns: ['selectedIntentId'],
          references: { schema: 'public', table: 'content_intent', columns: ['id'] },
          onDelete: 'setNull',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
