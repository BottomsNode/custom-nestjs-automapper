# @custom-automapper

A **powerful, type-safe, extensible object mapping library** for **TypeScript** and **NestJS**, built for real-world production use.  
It supports decorators, caching, async mapping, validation, and more — all without the @automapper/core dependency.

---

## ✨ Features

- 🧩 **Automatic mapping** of DTOs using decorators
- ⚡ **Caching support** for high-performance repeated mappings
- 🌀 **Async & sync** mapping support
- 🧠 **Type-safe mapping configurations**
- 🪄 **Deep clone and transformation utilities**
- 🏗️ **Nested, array, and enum mapping**
- 💉 **NestJS-friendly integration**
- 🛠️ **Mapper helpers** (`mapFrom`, `ignore`, `transform`, etc.)
- 🧰 **Validation rules** per property

---

## 📦 Installation

```bash
npm install @custom-automapper
# or
yarn add @custom-automapper
```

---

## ⚙️ Basic Usage

```ts
import { Mapper, AutoMap } from '@custom-automapper';

// DTOs
class SourceDTO {
  @AutoMap()
  name: string;

  @AutoMap()
  age: number;
}

class TargetDTO {
  @AutoMap()
  name: string;

  @AutoMap()
  age: number;
}

// Mapper
const mapper = new Mapper();
mapper.createMap(SourceDTO, TargetDTO);

const source = new SourceDTO();
source.name = 'John';
source.age = 30;

const target = mapper.map(source, TargetDTO);

console.log(target); // { name: 'John', age: 30 }
```

---

## 🧠 Advanced Usage

### 1️⃣ Configuring Mapper in Constructor

You can configure **global options** like caching, cloning, or naming conventions in the constructor:

```ts
import { Mapper } from '@custom-automapper';

const mapper = new Mapper({
  globalOptions: {
    deepClone: true,
    skipUndefined: true,
  },
  cache: {
    enabled: true,          // Enable caching globally
    strategy: 'memory',     // 'memory' (default) or custom
  }
});
```

### 2️⃣ Enabling or Disabling Cache at Runtime

```ts
mapper.setCacheEnabled(true);
console.log(mapper.isGlobalCacheEnabled()); // true

mapper.setCacheEnabled(false);
```

---

## 🧩 Custom Mappings

You can explicitly define property mappings using `mapFrom`:

```ts
mapper.createMap(SourceDTO, TargetDTO, {
  name: mapper.mapFrom(src => src.name.toUpperCase()), // transform source value
  age: mapper.mapFrom('age') // map directly by key
});
```

---

## 🔁 Reverse Mapping

Generate reverse mapping automatically:

```ts
mapper.createMap(SourceDTO, TargetDTO, {
  name: src => src.name,
  age: src => src.age,
});

// Create reverse mapping (TargetDTO → SourceDTO)
mapper.createReverseMap(SourceDTO, TargetDTO);
```

---

## ⚡ Async Mapping

When mapping data that involves async transforms (e.g., fetching data or calling async functions):

```ts
await mapper.createMap(UserEntity, UserDTO, {
  profileUrl: async src => await getProfileUrl(src.id)
});

const result = await mapper.mapAsync(userEntity, UserDTO);
```

---

## 🧱 Array Mapping

```ts
const users = [user1, user2, user3];
const dtos = mapper.mapArray(users, UserDTO);

// Or async version
const dtosAsync = await mapper.mapArrayAsync(users, UserDTO);
```

---

## 🧩 Conditional Mapping

Apply conditional mapping logic dynamically:

```ts
const target = mapper.mapConditional(source, TargetDTO, [
  {
    condition: src => src.age > 18,
    map: src => ({ status: 'Adult' })
  },
  {
    condition: src => src.age <= 18,
    map: src => ({ status: 'Minor' })
  }
]);
```

---

## ✅ Validation Rules

Attach validation rules per class property and validate mapped objects.

```ts
mapper.addValidation(UserDTO, 'email', {
  validate: value => value.includes('@'),
  message: 'Email must contain @ symbol'
});

await mapper.validate(new UserDTO()); // throws if invalid
```

---

## 🧠 Metadata Mapping with Decorators

Decorators like `@AutoMap`, `@MapFrom`, and `@MapTo` automatically handle property mapping.

```ts
class AddressDTO {
  @AutoMap()
  city: string;
}

class UserDTO {
  @AutoMap()
  name: string;

  @AutoMap(() => AddressDTO)
  address: AddressDTO;
}
```

---

## 🪄 Map with Metadata Summary

Get detailed insights into which properties were mapped or skipped.

```ts
const result = mapper.mapWithMetadata(source, TargetDTO);

console.log(result.metadata);
/*
{
  mappedProperties: ['name', 'age'],
  skippedProperties: [],
  errors: [],
  executionTime: 2
}
*/
```

---

## 🔥 Cache Behavior

Each mapped source object is cached by reference using a `WeakMap`, minimizing re-computation on repeated mapping calls.

### Example:
```ts
mapper.setCacheEnabled(true);

const src = new SourceDTO();
src.name = 'Cached User';
src.age = 25;

const first = mapper.map(src, TargetDTO);
const second = mapper.map(src, TargetDTO); // served from cache
```

---

## 🧹 Utility Methods

| Method | Description |
|--------|--------------|
| `map()` | Maps an object synchronously |
| `mapAsync()` | Maps asynchronously |
| `mapArray()` | Maps an array synchronously |
| `mapArrayAsync()` | Maps an array asynchronously |
| `createReverseMap()` | Generates reverse mapping |
| `clear()` | Clears registry and cache |
| `getMappings()` | Lists registered mappings |
| `mapWithMetadata()` | Maps with runtime metadata |

---

## 🧱 Example: Full Flow

```ts
class UserEntity {
  @AutoMap()
  id: number;

  @AutoMap()
  fullName: string;

  @AutoMap()
  email: string;
}

class UserDTO {
  @AutoMap()
  id: number;

  @AutoMap()
  name: string;

  @AutoMap()
  email: string;
}

const mapper = new Mapper({ cache: { enabled: true } });

mapper.createMap(UserEntity, UserDTO, {
  name: src => src.fullName
});

const entity = { id: 1, fullName: 'Nishit Shiv', email: 'nishit@example.com' };

const dto = mapper.map(entity, UserDTO);
console.log(dto); // { id: 1, name: 'Nishit Shiv', email: 'nishit@example.com' }
```

---

## 📊 Comparison with `@automapper/core`

| Feature | Custom AutoMapper | @automapper/core |
|----------|------------------|------------------|
| Decorator-driven mapping | ✅ | ✅ |
| Nested object mapping | ✅ | ✅ |
| Custom property mapping | ✅ | ✅ |
| Async mapping | ✅ | ✅ |
| Caching | ✅ | ❌ |
| Validation | ✅ | ❌ |
| DI integration | Manual | Built-in |

---

## 🧩 Future Roadmap

- Enhanced polymorphic mapping with type inference  
- NestJS DI integration for singleton mappers  
- Profiles for multi-context mapping  
- Built-in transformations (`formatDate`, `uppercase`, etc.)

---

## 🤝 Contributing

Pull requests, discussions, and suggestions are welcome.  
Open an issue or PR with a clear description of improvement.

---

## 🪪 License

**MIT License**  
© 2025 Nishit Shiv
