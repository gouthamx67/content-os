#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/51ad3137a964ebb61d81d7b9217aa744e853d9430ec996ee1d688631767f3b36/contract';
import endContract from '../../snapshots/51ad3137a964ebb61d81d7b9217aa744e853d9430ec996ee1d688631767f3b36/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/6c77f72461b984d10b46a28826a0a4978533bced104aea4ed33bc993ee05e0fd/contract';
import startContract from '../../snapshots/6c77f72461b984d10b46a28826a0a4978533bced104aea4ed33bc993ee05e0fd/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'brand_source_state',
        column: col('analyzerRevision', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
