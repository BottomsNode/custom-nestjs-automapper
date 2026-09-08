# Changesets

`pnpm changeset` to record a change, `pnpm version-packages` to apply it.

The three packages are **fixed**: they version and publish together. They share
an IR and a `MappingPlan` shape, so a core change that an adapter must follow
is not something a consumer should be able to half-upgrade.
