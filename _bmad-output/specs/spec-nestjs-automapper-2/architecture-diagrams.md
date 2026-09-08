# Architecture diagrams

Companion to `SPEC.md`. Structural shape only; the decisions these illustrate are recorded in the kernel's Constraints and in `.memlog.md`.

## Pipeline spine

Metadata converges into one intermediate representation, and every consumer reads that IR rather than re-deriving from source. This is what keeps mapping, projection, and diagnostics from disagreeing about what a mapping does.

```mermaid
flowchart TD
  A1[Schema adapters<br/>TypeORM metadata] --> D[TypeDescriptor<br/>fields · relations · nullability · native names · provenance]
  A2[Decorator overrides<br/>optional] --> D
  A3[Explicit map config] --> D

  D --> P[MappingPlan<br/>one resolution node per destination field]

  P --> E1[Code emitter<br/>new Function, one fn per type pair]
  P --> E2[Projector<br/>neutral FieldSelection tree]
  P --> E3[Explainer<br/>per-field resolution trace]
  P --> E4[Plan validator<br/>boot-time sweep]

  E2 --> N[Adapter translation<br/>ORM-native select / relations]

  E1 -.->|CAP-1 CAP-2 CAP-6 CAP-7| O1[Mapped DTO]
  N  -.->|CAP-5| O2[Query options]
  E3 -.->|CAP-4| O3[Diagnostics]
  E4 -.->|CAP-3 CAP-10| O4[Boot failure or CI report]
```

`core` computes the neutral `FieldSelection` tree only. Translation into ORM-native shapes happens in the adapter package, which is what keeps the zero-dependency constraint on `core` enforceable.

## Package boundaries

```mermaid
flowchart LR
  subgraph pub["@nestjs-automapper/*"]
    C["core<br/>zero runtime deps"]
    T["typeorm<br/>peer: typeorm"]
    N["nestjs<br/>peer: @nestjs/common, @nestjs/core"]
  end
  T --> C
  N --> C
  U[Application] --> N
  U --> T
```

Adapter packages depend on `core`; `core` depends on nothing. An adapter never imports another adapter. Packages deferred to 2.1 and later — Prisma, Mongoose, Drizzle — attach at the same boundary as `typeorm`, which is the test of whether the adapter interface is genuinely decoupled.

## Where a mapping can fail

Failure moves as far left as the available information allows. This is the structural expression of the "prefer a compile error over a runtime throw" constraint.

```mermaid
flowchart LR
  S1["Compile time<br/>CAP-10 dep paths<br/>CAP-1 renamed column"] --> S2["Boot<br/>CAP-3 unresolved field<br/>CAP-6 underivable nested pair"]
  S2 --> S3["First map call<br/>last resort only"]
  S3 --> S4["Production<br/>must be unreachable"]

  style S1 fill:#1b4332,stroke:#2d6a4f,color:#d8f3dc
  style S2 fill:#344e41,stroke:#588157,color:#dad7cd
  style S3 fill:#6c584c,stroke:#a68a64,color:#f0ead2
  style S4 fill:#6a040f,stroke:#9d0208,color:#ffccd5
```

The incumbent's failures land in the two right-hand states. Every capability in this spec that looks like a developer-experience nicety is in fact a mechanism for moving a failure leftward.
