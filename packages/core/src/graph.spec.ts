import { describe, it, expect } from 'vitest';
import { NO_PROVENANCE, type SchemaAdapter, type TypeDescriptor } from './descriptor/types.js';
import { Pick, extend } from './dto/pick.js';
import { collection, nested } from './dto/resolver.js';
import { Mapper } from './mapper.js';

class Address {
  city!: string;
}
class Post {
  title!: string;
  author!: User;
}
class User {
  id!: string;
  name!: string;
  address!: Address;
  posts!: Post[];
  manager!: User;
}

const f = (name: string) => ({ name, type: 'string' as const, nullable: false, provenance: NO_PROVENANCE });

const adapter: SchemaAdapter = {
  name: 'fake',
  supports: (t) => t === User || t === Address || t === Post,
  describe: (t): TypeDescriptor =>
    t === Address
      ? { type: Address, fields: [f('city')], relations: [], producedBy: 'fake' }
      : t === Post
        ? {
            type: Post,
            fields: [f('title')],
            relations: [{ name: 'author', target: () => User, kind: 'one', nullable: true }],
            producedBy: 'fake',
          }
        : {
            type: User,
            fields: [f('id'), f('name')],
            relations: [
              { name: 'address', target: () => Address, kind: 'one', nullable: true },
              { name: 'posts', target: () => Post, kind: 'many', nullable: false },
              { name: 'manager', target: () => User, kind: 'one', nullable: true },
            ],
            producedBy: 'fake',
          },
};

class AddressDto extends Pick(Address, ['city']) {}
class UserDto extends extend(Pick(User, ['id', 'name']), {
  address: nested<User, AddressDto>(() => AddressDto),
}) {}

const sealed = (...dtos: Parameters<Mapper['register']>) => {
  const m = new Mapper().use(adapter).register(...dtos);
  m.seal();
  return m;
};

describe('CAP-6 — nested pairs register themselves', () => {
  it('plans a child that was never registered', () => {
    // Only UserDto is declared; AddressDto is reached through the relation.
    const m = new Mapper().use(adapter).register(UserDto);
    const report = m.seal();
    expect(report.ok).toBe(true);
    expect(report.pairs).toContain('Address::AddressDto');
  });

  it('maps the nested object', () => {
    const out = sealed(UserDto).map({ id: 'u1', name: 'N', address: { city: 'Pune' } }, UserDto);
    expect(out.address).toMatchObject({ city: 'Pune' });
    expect(out.address).toBeInstanceOf(AddressDto);
  });

  it('leaves a missing relation null rather than throwing', () => {
    expect(sealed(UserDto).map({ id: 'u1', name: 'N' }, UserDto).address).toBeUndefined();
  });
});

describe('collections', () => {
  class PostDto extends Pick(Post, ['title']) {}
  class FeedDto extends extend(Pick(User, ['id']), {
    posts: collection<User, PostDto>(() => PostDto),
  }) {}

  it('maps each element', () => {
    const out = sealed(FeedDto).map({ id: 'u1', posts: [{ title: 'a' }, { title: 'b' }] }, FeedDto);
    expect(out.posts.map((p) => p.title)).toEqual(['a', 'b']);
  });

  it('yields an empty array when the relation is absent', () => {
    expect(sealed(FeedDto).map({ id: 'u1' }, FeedDto).posts).toEqual([]);
  });
});

describe('CAP-7 — cyclic and shared graphs', () => {
  // A self-referencing DTO needs the thunk's return type annotated, or the
  // class appears in its own base expression (TS2506). Annotating breaks the
  // cycle for the checker without changing anything at runtime.
  const selfRef = (): unknown => SelfDto;
  class SelfDto extends extend(Pick(User, ['id']), {
    manager: nested<User, unknown>(selfRef),
  }) {}

  it('terminates on a self-referencing cycle', () => {
    const a: Record<string, unknown> = { id: 'a' };
    const b: Record<string, unknown> = { id: 'b', manager: a };
    a['manager'] = b; // a → b → a

    const out = sealed(SelfDto).map(a, SelfDto) as unknown as Record<string, unknown>;
    expect(out['id']).toBe('a');
    // The back-edge resolves to the in-progress instance, so the cycle closes.
    expect((out['manager'] as Record<string, unknown>)['manager']).toBe(out);
  });

  it('maps a shared reference once and shares the result', () => {
    const shared = { title: 'shared' };
    class PostDto extends Pick(Post, ['title']) {}
    class FeedDto extends extend(Pick(User, ['id']), {
      posts: collection<User, PostDto>(() => PostDto),
    }) {}

    const out = sealed(FeedDto).map({ id: 'u1', posts: [shared, shared] }, FeedDto);
    expect(out.posts[0]).toBe(out.posts[1]);
  });

  it('discards operation state between calls, so nothing goes stale', () => {
    const m = sealed(UserDto);
    const src = { id: 'u1', name: 'first', address: { city: 'Pune' } };
    const first = m.map(src, UserDto);
    src.name = 'second';
    expect(m.map(src, UserDto).name).toBe('second');
    expect(first.name).toBe('first');
  });
});

describe('AD-9 — async propagates up the closure', () => {
  it('marks a parent async when its child is', async () => {
    const { resolve } = await import('./dto/resolver.js');
    class SlowAddressDto extends extend(Pick(Address, ['city']), {
      geo: resolve<Address, string>(['city'], async (a) => `geo:${a.city}`),
    }) {}
    class ParentDto extends extend(Pick(User, ['id']), {
      address: nested<User, unknown>(() => SlowAddressDto),
    }) {}

    const m = sealed(ParentDto);
    // The parent declares nothing async itself; it inherits it from the child.
    expect(m.planOf(ParentDto)?.isAsync).toBe(true);
  });
});

describe('lazy relations', () => {
  class LazyAddressDto extends Pick(Address, ['city']) {}

  const lazyAdapter: SchemaAdapter = {
    name: 'lazy',
    supports: (t) => t === User || t === Address,
    describe: (t): TypeDescriptor =>
      t === Address
        ? { type: Address, fields: [f('city')], relations: [], producedBy: 'lazy' }
        : {
            type: User,
            fields: [f('id')],
            relations: [
              { name: 'address', target: () => Address, kind: 'one', nullable: true, isLazy: true },
            ],
            producedBy: 'lazy',
          },
  };

  class LazyUserDto extends extend(Pick(User, ['id']), {
    address: nested<User, unknown>(() => LazyAddressDto),
  }) {}

  const mapper = new Mapper().use(lazyAdapter).register(LazyUserDto);
  mapper.seal();

  it('forces the plan async, since the value is a Promise', () => {
    expect(mapper.planOf(LazyUserDto)?.isAsync).toBe(true);
  });

  it('awaits the relation instead of writing the promise into the DTO', async () => {
    const out = (await mapper.mapAsync(
      { id: 'u1', address: Promise.resolve({ city: 'Pune' }) },
      LazyUserDto,
    )) as unknown as Record<string, unknown>;

    expect(out['address']).toMatchObject({ city: 'Pune' });
    expect(out['address']).not.toBeInstanceOf(Promise);
  });
});
