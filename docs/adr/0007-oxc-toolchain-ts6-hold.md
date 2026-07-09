# Lint/format is the oxc suite; TypeScript stays at 6 until vue-tsc runs on 7

Linting and formatting are oxlint and oxfmt (both pinned exactly — formatter
output must be deterministic in CI). The repo had neither before, so this is
greenfield adoption, not a migration: oxlint runs correctness rules plus the
Vue plugin over the whole repo in ~1.5s, and oxfmt owns every file type it
supports (ts, vue, json, yaml, md, css) with `singleQuote` and
`printWidth: 100` matching the prevailing style. The one-time reformat is a
single style-only commit recorded in `.git-blame-ignore-revs`.

Module boundaries are real rules, not convention: every workspace package
carries a `scope:*` tag and `@nx/enforce-module-boundaries` runs through
oxlint's ESLint jsPlugins bridge, encoding the hexagon exactly — `contracts`
is a leaf, `domain` and `ai` may only depend on `contracts`, apps never
import each other. The bridge is alpha, so it was spiked before adoption:
verified it flags forbidden imports in both `.ts` and `.vue` files. If the
bridge breaks on an oxlint upgrade, the fallback is native
`no-restricted-imports` overrides per project — same constraints, no plugin.

TypeScript is deliberately held at 6.0.3 even though 7.0 (the 10x Go-native
compiler) is stable: `apps/web` typechecks with vue-tsc, which drives
TypeScript's JS compiler API — an API TS 7 does not ship. Alternatives
rejected: split versions (7 for the four tsc projects, 6 pinned for web —
two compilers in the lockfile for a speedup the repo's size doesn't need)
and the community vue-tsgo shim (young, unendorsed; a wrong-negative
typecheck costs more than a slower one). Revisit trigger:
vuejs/language-tools#5381 — when vue-tsc supports TS 7, upgrade everything
at once.

Status: accepted
