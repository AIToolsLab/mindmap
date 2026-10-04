# `src/` Folder Refactor — Implementation Spec

Status: **SPEC READY — decided 2026-10-04 (Nhyira).** Audience: implementer (Codex).
Branch: `refactor/src-folders` (off `main` at `ae55265`). This spec is the first
commit on that branch.

## Goal

`src/` is one flat list of 41 modules plus their tests. Group them into folders
by responsibility so a reader can find the coach, the grounding checks, the map
state and the UI without opening every file.

**This is a move-only change.** After it, the app, the prompt, the validator,
the tests and the build behave exactly as before. Reviewers should be able to
confirm that from the diff alone.

## Non-goals (do not do any of these)

- Do not rename any file. Only its folder changes.
- Do not change, add or remove any export, function, type, comment or string.
- Do not delete the deprecated shims `controller.ts` and `map-commands.ts`.
  Move them like any other file.
- Do not fix the `types.ts` ↔ `assistance-contract.ts` import cycle, or the
  type-only import from `session-persistence.ts` into `Map.tsx`. Both are known
  and out of scope.
- **Do not edit any regular expression**, anywhere. That includes the one in
  `ui-strings.ts` and the ones in `ui-locale.test.ts`; see "Traps" below.
- Do not reformat, reorder imports, or touch lines other than import paths.
- Do not add a path alias (`@/…`), barrel `index.ts` files, or tsconfig/vite
  changes.

## Target layout

Every module moves with its co-located test (`x.ts` → same folder as
`x.test.ts`). Files not listed stay where they are.

| Folder | Responsibility | Modules (tests move with them) |
| --- | --- | --- |
| `src/` (root) | entry point and shared definitions | `main.tsx`, `types.ts`, `config.ts`, `assistance-contract.ts` |
| `src/coach/` | one model turn: prompt, transport, response parsing, turn loop | `stage1-loop.ts`, `controller.ts`, `api.ts`, `provider-tools.ts`, `llm-contract.ts`, `assistant-response.ts`, `turn-shape.ts`, `language-context.ts` |
| `src/grounding/` | code checks on AI output | `validator.ts`, `normalize.ts`, `unicode-scripts.ts`, `action-gateway.ts`, `map-commands.ts` |
| `src/map/` | map, Source Bank and proposal state; provenance | `map-store.ts`, `store.ts`, `proposal-store.ts`, `map-layout.ts`, `map-export.ts`, `provenance-summary.ts`, `suggestion-adoption.ts` |
| `src/session/` | persistence, logging, diagnostics | `session-persistence.ts`, `event-ledger.ts`, `trace.ts`, `understanding.ts` |
| `src/platform/` | Writing Tools sign-in | `platform-session.ts`, `PlatformBootstrap.tsx`, `platform.css` |
| `src/ui/` | React components, UI copy, DOM helpers | `App.tsx`, `ControlRoom.tsx`, `Map.tsx`, `reader-view.tsx`, `reader-translation.ts`, `mutation-policy.tsx`, `useSpeechToText.ts`, `draft-anchor.ts`, `ui-locale.tsx`, `ui-strings.ts` |
| `src/i18n/` | translation dictionaries (unchanged) | existing `*.json` and `README.md` stay exactly where they are |

Tests whose names don't match a module:

| Test | Goes to |
| --- | --- |
| `candidate-store.test.ts` (tests `store.ts`) | `src/map/` |
| `proposal-fuzz.test.ts` | `src/map/` |
| `provider-tools.integration.test.ts` | `src/coach/` |
| `App.test.ts` | `src/ui/` |
| `useSpeechToText.test.tsx` | `src/ui/` |

`assistance-contract.ts` stays at the root because nearly every folder imports
it and it shares the import cycle with `types.ts`. Keeping both at the root
stops that cycle from crossing folders.

## Mechanics

1. Use `git mv` for every move so `git log --follow` and rename detection keep
   each file's history.
2. Fix every relative path that the moves break. There are five kinds; search
   for all of them, not only `from "./…"`:
   - static imports and re-exports: `import … from "./x"`, `export … from "./x"`
   - inline type imports: `import("./x").SomeType` (present in `action-gateway.ts`,
     `api.ts`, `stage1-loop.ts`, `types.ts`, `App.tsx`, `Map.tsx`,
     `stage1-loop.test.ts`; check with `grep -rn 'import("\.' src` after moving)
   - Vitest mocks: `vi.mock("./api", …)` in `reader-view.test.ts`
   - side-effect imports: `import "./platform.css"` in `main.tsx` becomes
     `import "./platform/platform.css"`
   - the Vite glob in `ui-strings.ts` (see Traps)
3. Fix imports outside `src/`: `eval/run.ts`, `eval/reporting.ts` and
   `eval/scenarios/*.ts` import `../src/<file>` / `../../src/<file>`. Point them
   at the new folders.
4. Do **not** change: `index.html` (still loads `/src/main.tsx`, which stays at
   the root), `scripts/generate-i18n.mjs` (it writes to `src/i18n/`, which does
   not move), `tsconfig*.json`, `vite.config.ts`, `.github/workflows/*`.
5. If `tsc -b` complains about stale paths, delete `tsconfig.tsbuildinfo` (a
   build cache) and rebuild. Do not commit it if it is untracked.

## Traps

**1. `ui-strings.ts` translation glob (silent failure).** It loads dictionaries
with

```ts
const DICTIONARIES = import.meta.glob<Record<string, string>>("./i18n/*.json", { … });
…
const code = /\.\/i18n\/([\w-]+)\.json$/.exec(path)?.[1];
```

After moving to `src/ui/`, change **only** the glob string to
`"../i18n/*.json"`. Leave the regex untouched. The glob keys become
`"../i18n/zh.json"`, and the regex is not anchored at the start, so it still
matches `./i18n/zh.json` inside that key and extracts `zh`. If the glob is
wrong, every language silently falls back to English with no error. That is
why the guard test below is required.

**2. `ui-locale.test.ts` reads source files by relative URL.** It calls
`new URL("./App.tsx" | "./Map.tsx" | "./PlatformBootstrap.tsx", import.meta.url)`
and `new URL("./i18n/source.json", import.meta.url)`. After it moves to
`src/ui/`, `App.tsx` and `Map.tsx` stay as `./…`. Change the other two to
`"../platform/PlatformBootstrap.tsx"` and `"../i18n/source.json"`. Change only
the path strings, not the regexes in that test.

**3. Comment references.** Doc comments that mention a sibling path (e.g.
`ui-strings.ts`: "See ./i18n/README.md") may be updated to the new relative
path (`../i18n/README.md`). This is the only comment change allowed.

## Guard test (the one new test)

Add to `src/ui/ui-locale.test.ts`:

```ts
it("loads a dictionary for every translation file in src/i18n", () => {
  const files = readdirSync(new URL("../i18n/", import.meta.url))
    .filter((name) => name.endsWith(".json") && name !== "source.json")
    .map((name) => name.slice(0, -".json".length))
    .sort();
  expect(files.length).toBeGreaterThan(0);
  expect(translatedLanguages()).toEqual(files);
});
```

(Import `readdirSync` from `node:fs` and `translatedLanguages` from
`./ui-strings`, matching how the file already imports.) This fails if the glob
or the code extraction breaks, which today's tests only catch for Chinese.

## Docs

Update `src/<file>` path mentions in these docs to the new folders:
- `docs/login-bootstrap-spec.md:38` (`src/platform-session.ts`)
- `docs/multilingual-grounding-pass.md:40` (`src/ui-strings.ts`)
- `docs/polish-sweeps-pass.md:62` (`src/ui-strings.ts`)

Leave the other path mentions alone. They name files that no longer exist
(`src/language.ts`, `src/translate.ts`, …) or `prototype-mindmap/src/…` in the
old repo, so they are historical.

Add a short "Source layout" section to `README.md` with the folder table above
(folder + one-line responsibility only).

## Commits

1. `docs: spec the src folder refactor` (this file; already on the branch)
2. `refactor: group src modules into folders`: all `git mv`s plus import-path
   fixes in **one** commit, so no commit leaves the tree broken
3. `test(i18n): guard that every dictionary file loads`
4. `docs: point path references at the new folders`

Do not push. Report back when done.

## Verification (all must pass; paste the output)

```bash
npm test
npx tsc --noEmit
npm run eval:typecheck
npm run build:pages
npm run verify:pages
```

- Baseline on `main` (`ae55265`): **37 test files, 393 tests**. After: 37 files,
  **394 tests** (the guard test is the only addition).
- Optional if Playwright browsers are installed: `npm run test:e2e`.

**Move-only proof.** Rename detection must show every module as a rename:

```bash
git diff -M --summary main..HEAD -- src | grep -c "rename"
```

The count should equal the number of moved files (modules plus tests plus
`platform.css`).

Every changed line must be an import path, the glob string, a test-file path
string, the guard test, or the allowed comment path. This command should print
only the guard test's lines and the allowed comment/path-string lines:

```bash
git diff -M main..HEAD -- src eval | grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
  | grep -vE 'from "|import\(|vi\.mock\(|import\.meta\.glob|^[+-]\s*$'
```

**Picture.** If `codemap` is available:

```bash
codemap C:\Users\nhyir\Linux_Folder\mindmap-extract --name mindmap-folders
```

The Folders tab should show the seven folders. The only circular import should
still be `types.ts` ↔ `assistance-contract.ts`.

## Report format

- the commands above with their output
- the rename count, and the full output of the move-only grep
- any file you could not place by this table, and where you put it
- anything in this spec that turned out to be wrong
