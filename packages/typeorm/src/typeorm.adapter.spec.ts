import { describe, it, expect } from 'vitest';
import type { FieldSelection } from '@nestjs-automapper/core';
import { toFindOptions } from './typeorm.adapter.js';

/**
 * `toFindOptions` is the whole reason `core` can stay zero-dependency: core
 * emits a neutral selection and knows nothing about `select`/`relations`.
 * It is pure, so it is tested directly.
 *
 * `describe()` reads a live DataSource and is covered by an integration test
 * with a real driver, not here — mocking TypeORM's metadata classes would only
 * test the mock.
 */
describe('neutral selection → TypeORM find options', () => {
  it('turns fields into a select map', () => {
    const selection: FieldSelection = { fields: ['id', 'email'], relations: {} };
    expect(toFindOptions(selection)).toEqual({ select: { id: true, email: true } });
  });

  it('emits no relations key when nothing is joined', () => {
    expect(toFindOptions({ fields: ['id'], relations: {} }).relations).toBeUndefined();
  });

  it('nests a relation under select and declares the join in relations', () => {
    const selection: FieldSelection = {
      fields: ['id'],
      relations: { address: { fields: ['city'], relations: {} } },
    };
    expect(toFindOptions(selection)).toEqual({
      select: { id: true, address: { city: true } },
      relations: { address: true },
    });
  });

  it('recurses through a nested relation', () => {
    const selection: FieldSelection = {
      fields: ['id'],
      relations: {
        address: { fields: ['city'], relations: { country: { fields: ['code'], relations: {} } } },
      },
    };
    expect(toFindOptions(selection)).toEqual({
      select: { id: true, address: { city: true, country: { code: true } } },
      relations: { address: { country: true } },
    });
  });

  it('produces an empty select for an empty selection, never a select-all', () => {
    // `fields: []` means EXACTLY NONE. Emitting `{}` here and letting TypeORM
    // read it as "everything" is precisely the over-fetch this feature exists
    // to prevent, so the distinction is asserted rather than assumed.
    expect(toFindOptions({ fields: [], relations: {} })).toEqual({ select: {} });
  });
});
