# Functional programming and linting

The monorepo uses a single root `eslint.config.mjs` and `tsconfig.eslint.json`.
Do not add per-application ESLint configurations. The lint TypeScript project
includes source, tests, operator scripts, and build configuration; it does not
change the applications' compiler settings.

## Commands

```sh
npm run lint
npm run lint:report
npm run lint:fix
```

`lint:report` writes machine-readable results to `work/eslint-report.json`.
All three commands return a failing exit code when lint errors remain. Fix
violations without weakening normal rules, changing errors to warnings, excluding
sources, or adding `|| true`. Review automatic fixes before committing them.

At actual runtime boundaries such as HTTP, D1, browser storage, timers, DOM, and
lifecycle callbacks, narrowly scoped rule exceptions are allowed only when needed
for that interaction. State the reason beside each directive or override. Pure
validation, calculations, and data transformations retain the full ruleset.

Lint is deliberately separate from `check`, `test`, builds, and GitHub Actions.
No lint CI step, commit hook, or scheduled cleanup job is installed. A separate
scheduled task can later run the report command and address violations in small
changes with the existing checks and tests.

## Rules

The base configuration uses `eslint-plugin-functional`'s `all` preset. It enables
all nondeprecated rules, including every rule in `strict` plus the additional
promise, property signature, readonly syntax, and tacit programming rules.
`prefer-tacit`, which the preset normally reports as a warning, is an error here.
TypeScript's type-aware recommended rules and the Svelte/Astro recommended rules
also apply.

The API, shared package, tests, and tools retain the full functional ruleset.
Web has explicit overrides for lifecycle and event effects:

- Allow expression statements and void returns for `onMount`, cleanup callbacks,
  event handlers, DOM calls, and browser storage.
- Allow `let` and mutation for Svelte state, bindings, and DOM properties.
- Allow parameterless callbacks passed to other functions. The parameter-count
  rule remains enabled for non-callback functions, and the rest-parameter and
  `arguments` restrictions remain.

The other functional rules remain active in Web. Astro's extracted inline
browser scripts are virtual files outside the TypeScript project, so only their
type-aware rules are disabled; syntax rules still run. Astro frontmatter and
Svelte components retain type-aware checking.

## Coding approach

Keep calculations and data transformations in pure functions. Prefer readonly
inputs and return new values instead of mutating shared state. Keep network,
database, storage, timers, and UI updates at explicit effect boundaries. Avoid
rewriting unrelated behavior solely to make a lint count smaller.

Ramda is a runtime dependency of `@little/shared`. Use named imports for useful
pure operations and composition; the progress calculation already uses `clamp`.
Declare a direct Ramda dependency in another workspace if that workspace starts
importing it directly. Ramda's TypeScript declarations are installed in the root
development dependencies.

Validation returns readonly error values rather than throwing from business logic.
`validateEvent` returns an event or `{ error: string }`; username validation returns
a name or the same error shape. HTTP handlers translate these outcomes into status
codes. Malformed HTTP JSON still rejects at the request decoding boundary. Starter
events are an ordered readonly record; use `Object.values` when iterating them.
