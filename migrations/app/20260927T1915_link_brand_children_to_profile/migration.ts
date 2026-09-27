#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6c77f72461b984d10b46a28826a0a4978533bced104aea4ed33bc993ee05e0fd/contract';
import endContract from '../../snapshots/6c77f72461b984d10b46a28826a0a4978533bced104aea4ed33bc993ee05e0fd/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/7154ae40f2635aa7ace0fa457b8cda3a5f23c55c7113ebcc66c5e7d4cc59fd0f/contract';
import startContract from '../../snapshots/7154ae40f2635aa7ace0fa457b8cda3a5f23c55c7113ebcc66c5e7d4cc59fd0f/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createIndex({
        schema: 'public',
        table: 'brand_asset',
        index: 'brand_asset_assetId_idx_4ebe630a',
        columns: ['assetId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_asset',
        foreignKey: {
          name: 'brand_asset_assetId_fkey',
          columns: ['assetId'],
          references: { schema: 'public', table: 'asset', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_asset',
        foreignKey: {
          name: 'brand_asset_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_color',
        foreignKey: {
          name: 'brand_color_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_conflict',
        foreignKey: {
          name: 'brand_conflict_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_font',
        foreignKey: {
          name: 'brand_font_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_guideline',
        foreignKey: {
          name: 'brand_guideline_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_term',
        foreignKey: {
          name: 'brand_term_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'brand_voice_signal',
        foreignKey: {
          name: 'brand_voice_signal_profileId_fkey',
          columns: ['profileId'],
          references: { schema: 'public', table: 'brand_profile', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
