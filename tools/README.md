# tools/

Every tool is a subcommand of `node tools/forge.js <command>`. Tools only talk to a running add-on over HTTP, so they work whatever language the add-on is written in.

## Conventions

- CommonJS, plain JavaScript, JSDoc on public functions.
- Each command is one file (`tools/<command>.js`) exporting `run(args: string[]): Promise<number>`.
- Exit codes come from `lib/exit-codes.js`: `0` success, `1` validation/test failure, `2` usage or environment error.
- Every command prints a short human-readable report and supports `--json`.
- No bash-only logic: everything must run on macOS, Linux and Windows.

## Validation rules

`forge validate` reports issues by rule id, each linking to the upstream doc section it comes from.

- `lib/rules.js`: every rule id with its severity (error fails, warning doesn't) and doc link.
- `lib/schemas/manifest.js`, `lib/schemas/responses.js`: object shapes, as plain JS objects in the JSON Schema subset of `lib/json-schema.js`. Update these when the protocol changes.
- `lib/schemas/docs.js`: the upstream links, in one place.
- `lib/check-manifest.js` (static rules) and `lib/check-live.js` (HTTP rules).

To add a rule: declare it in `lib/rules.js`, implement it, and add a broken fixture to `tests/validate.test.js`. The test suite fails if any rule has no fixture.

## Dependencies

Prefer the Node standard library (`node:http`, `node:test`, `fetch`). Each dependency is listed here with its reason.

| Package | Kind | Why |
|---|---|---|
| `eslint` | dev | Linting, required by the quality bar (SPEC §9) |
| `@eslint/js` | dev | ESLint's recommended rule set, used by `eslint.config.js` |
| `globals` | dev | Node global names for ESLint, instead of maintaining the list by hand |
