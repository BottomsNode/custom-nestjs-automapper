import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  Column,
  CreateDateColumn,
  DataSource,
  DeleteDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { typeorm } from './typeorm.adapter.js';

/**
 * `describe()` against a real DataSource. sql.js is WASM, so this needs no
 * native build — the metadata TypeORM produces here is the same metadata a
 * Postgres app would produce.
 */

enum Role {
  Admin = 'admin',
  User = 'user',
}

@Entity()
class Address {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column() city!: string;
  @OneToMany(() => User, (u) => u.address) users!: User[];
}

@Entity()
class User {
  @PrimaryGeneratedColumn('uuid') id!: string;
  @Column({ length: 255 }) email!: string;
  @Column({ select: false }) password!: string;
  // Explicit type: `string | null` reflects as Object, which TypeORM cannot map.
  @Column({ type: 'varchar', nullable: true }) nickname!: string | null;
  @Column({ type: 'integer' }) loginCount!: number;
  @Column({ type: 'boolean', default: false }) active!: boolean;
  @Column({ type: 'simple-json', nullable: true }) settings!: Record<string, unknown> | null;
  @Column({ type: 'simple-enum', enum: Role, default: Role.User }) role!: Role;
  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
  @DeleteDateColumn() deletedAt!: Date | null;
  @VersionColumn() version!: number;
  @ManyToOne(() => Address, (a) => a.users, { nullable: true })
  @JoinColumn({ name: 'address_id' })
  address!: Address | null;
}

let dataSource: DataSource;
let adapter: ReturnType<typeof typeorm>;

beforeAll(async () => {
  const initSqlJs = (await import('sql.js')).default;
  dataSource = new DataSource({
    type: 'sqljs',
    driver: await initSqlJs({}),
    entities: [User, Address],
    synchronize: true,
    logging: false,
  });
  await dataSource.initialize();
  adapter = typeorm(dataSource);
});

afterAll(async () => {
  if (dataSource?.isInitialized) await dataSource.destroy();
});

const fieldOf = (name: string) => adapter.describe(User).fields.find((f) => f.name === name);

describe('supports()', () => {
  it('claims mapped entities and nothing else', () => {
    expect(adapter.supports(User)).toBe(true);
    expect(adapter.supports(class Unmapped {})).toBe(false);
  });

  it('does not throw for an unknown type (AD-17)', () => {
    expect(() => adapter.supports(class Nope {})).not.toThrow();
  });
});

describe('describe() — fields', () => {
  it('reports every column with no policy applied (AD-14)', () => {
    const names = adapter.describe(User).fields.map((f) => f.name);
    // Including password (select:false) and every generated column.
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'email',
        'password',
        'nickname',
        'loginCount',
        'active',
        'settings',
        'role',
        'createdAt',
        'updatedAt',
        'deletedAt',
        'version',
      ]),
    );
  });

  it('classifies column types', () => {
    expect(fieldOf('email')?.type).toBe('string');
    expect(fieldOf('loginCount')?.type).toBe('number');
    expect(fieldOf('active')?.type).toBe('boolean');
    expect(fieldOf('createdAt')?.type).toBe('date');
    expect(fieldOf('settings')?.type).toBe('json');
    expect(fieldOf('role')?.type).toBe('enum');
  });

  it('carries enum values through', () => {
    expect(fieldOf('role')?.enumValues).toEqual(expect.arrayContaining(['admin', 'user']));
  });

  it('reports nullability', () => {
    expect(fieldOf('nickname')?.nullable).toBe(true);
    expect(fieldOf('email')?.nullable).toBe(false);
  });

  it('keeps the property name and carries the column name separately (AD-15)', () => {
    expect(fieldOf('loginCount')?.name).toBe('loginCount');
    expect(fieldOf('loginCount')?.nativeName).toBe('loginCount');
  });
});

describe('describe() — provenance', () => {
  it('flags every database-owned column', () => {
    expect(fieldOf('id')?.provenance.isPrimary).toBe(true);
    expect(fieldOf('id')?.provenance.isGenerated).toBe(true);
    expect(fieldOf('createdAt')?.provenance.isCreateDate).toBe(true);
    expect(fieldOf('updatedAt')?.provenance.isUpdateDate).toBe(true);
    expect(fieldOf('deletedAt')?.provenance.isDeleteDate).toBe(true);
    expect(fieldOf('version')?.provenance.isVersion).toBe(true);
  });

  it('marks a select:false column as hidden on read, not as write-dropped', () => {
    // The distinction CAP-8 turns on: password is hidden when reading and
    // required when writing.
    expect(fieldOf('password')?.provenance.isSelectByDefault).toBe(false);
    expect(fieldOf('password')?.provenance.isGenerated).toBe(false);
  });

  it('sets flags explicitly to false rather than leaving them undefined', () => {
    // "unknown" must never read as "no" (AD-14).
    const email = fieldOf('email')!;
    for (const value of Object.values(email.provenance)) {
      expect(typeof value).toBe('boolean');
    }
  });

  it('records a column default', () => {
    expect(fieldOf('active')?.provenance.hasDefault).toBe(true);
    expect(fieldOf('email')?.provenance.hasDefault).toBe(false);
  });
});

describe('describe() — relations', () => {
  it('reports the relation, its kind, and its join column', () => {
    const relation = adapter.describe(User).relations.find((r) => r.name === 'address');
    expect(relation?.kind).toBe('one');
    expect(relation?.target()).toBe(Address);
    expect(relation?.joinColumns).toEqual(['address_id']);
  });

  it('reports the inverse side as a collection', () => {
    const relation = adapter.describe(Address).relations.find((r) => r.name === 'users');
    expect(relation?.kind).toBe('many');
    expect(relation?.target()).toBe(User);
  });

  it('names the producing adapter, which diagnostics surface', () => {
    expect(adapter.describe(User).producedBy).toBe('typeorm');
  });
});

describe('toNativeProjection() against real metadata', () => {
  it('adds the primary key TypeORM needs', () => {
    const options = adapter.toNativeProjection?.({ fields: ['email'], relations: {} }, User) as {
      select: Record<string, unknown>;
    };
    expect(options.select).toEqual({ email: true, id: true });
  });
});
