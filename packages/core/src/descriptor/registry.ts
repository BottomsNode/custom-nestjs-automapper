/**
 * Adapter arbitration (AD-17) and the built-in DTO adapter.
 *
 * Ordered list, first match wins, never a merge of two descriptors. Adapters
 * are identified by instance identity — `name` is display-only, and duplicates
 * are legal because a project can run two DataSources.
 */

import { fail } from '../diagnose/automapper-error.js';
import { FIELDS, RESOLVERS, isDtoClass } from '../dto/pick.js';
import { schemaAdapter } from './schema.js';
import { NO_PROVENANCE, type AnySource, type ClassLike, type SchemaAdapter, type TypeDescriptor } from './types.js';

/**
 * Describes classes produced by `Pick`/`extend` from their runtime field
 * registry. Always last in the order, imports nothing, so AD-6's
 * adapter-to-adapter rule does not apply to it.
 *
 * It reports every field as `unknown`/nullable: a DTO's *declared* types live
 * only in the type system. Real types come from the source entity's adapter,
 * which is what the planner actually reads.
 */
export const dtoAdapter: SchemaAdapter = {
  name: 'dto',
  supports: isDtoClass,
  describe(type: AnySource): TypeDescriptor {
    const dto = type as unknown as { [FIELDS]: readonly string[]; [RESOLVERS]: object };
    return {
      type,
      fields: dto[FIELDS].map((name) => ({
        name,
        type: 'unknown' as const,
        nullable: true,
        provenance: NO_PROVENANCE,
      })),
      relations: [],
      producedBy: 'dto',
    };
  },
};

export class AdapterRegistry {
  /** Order is the app's explicit responsibility; `dtoAdapter` is always last. */
  private readonly adapters: SchemaAdapter[] = [];

  use(adapter: SchemaAdapter): this {
    this.adapters.push(adapter);
    return this;
  }

  /** First adapter whose `supports()` returns true. `supports()` must not throw (AD-17). */
  find(type: AnySource): SchemaAdapter | undefined {
    return [...this.adapters, schemaAdapter, dtoAdapter].find((a) => a.supports(type));
  }

  describe(type: AnySource): TypeDescriptor {
    const adapter = this.find(type);
    if (!adapter) {
      throw fail('NO_ADAPTER', { type: type as ClassLike, registered: this.names() });
    }
    return adapter.describe(type);
  }

  names(): string[] {
    return [...this.adapters.map((a) => a.name), schemaAdapter.name, dtoAdapter.name];
  }
}
