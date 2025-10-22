# @ns/custom-automapper

A powerful, type-safe object mapping library for TypeScript and NestJS.

## Features

- Automatic mapping of DTOs using decorators
- Supports arrays, enums, and polymorphic mapping
- Deep clone and transformation utilities
- Fully type-safe and NestJS friendly
- Mapper helpers for common transformations (mapFrom, ignore, transform, formatDate, etc.)
- Works seamlessly with NestJS modules, pipes, and interceptors

## Future Upgrades

- Enhanced polymorphic mapping with type inference
- Support for mapping complex nested objects with decorators
- Array and enum mapping strategies enhancements
- Built-in validation rules for mapped properties
- More utility functions for advanced mapping scenarios

## Comparison with @automapper/core

| Feature | Custom AutoMapper | @automapper/core |
|---------|-----------------|----------------|
| Nested object mapping | ❌ manual implementation needed | ✅ automatic via createMap & forMember |
| Custom property mapping (forMember / mapFrom) | ❌ not supported yet | ✅ supported |
| DI injection (@InjectMapper) | ❌ manual instantiation | ✅ automatic via NestJS DI |
| Mapping arrays | ✅ supported | ✅ supported |
| Multiple mapping layers | ✅ manually via chained map/mapArray | ✅ built-in |
| Auto-mapping via decorators | ✅ supported | ✅ supported |

### Summary

Custom AutoMapper handles:
- Object mapping (map) and array mapping (mapArray)
- Property-level mapping using decorators (@AutoMap, @MapFrom, @MapTo)
- Integration with NestJS Pipes & Interceptors

It does **not yet** support:
- Automatic nested/complex mappings
- Property-specific transformation functions
- Profiles for multiple type configurations
- DI integration for singleton mapper

### Recommendations

To fully match @automapper/core capabilities:
- Add nested mapping support
- Add custom property transformation functions
- Introduce mapper profiles for multiple type configuration
- Integrate with NestJS DI for singleton usage

## Installation

```bash
npm install @ns/custom-automapper
# or
yarn add @ns/custom-automapper
```

## Usage

```ts
import { Mapper, AutoMap } from '@ns/custom-automapper';

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

## Contributing

Feel free to open issues and pull requests.

## License

MIT