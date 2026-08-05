# Spec — Track B: convert Mindmap from launch-gated to login-gated

Repo: `AIToolsLab/mindmap` (extracted 2026-08-05, 132 commits of history).
Companion: Track A in `AIToolsLab/writing-tools`
(`docs/oauth-standalone-login-spec.md`).

## What changed

Mindmap is no longer a tool launched by the Writing Tools taskpane. It is a
standalone public web app on its own origin. Nobody hands it a document or a
credential — a person visits the URL, signs in, and **pastes their text in
manually.**

The document-handoff direction was abandoned because every hard problem it
produced came from storing the user's document on the backend. Manual
copy/paste removes that entire problem class rather than deferring it.

```
Word / Google Docs
    ↕  manual copy / paste          ← deliberate, not a gap
Mindmap  (this repo, GitHub Pages, own origin)
    ↕  OAuth PKCE token, scope: openai:chat only
Writing Tools backend
```

## Out of scope

Do not build, and delete on sight: room parsing, `room_id` claims, room
fetching, grant exchange (`/handoff/exchange`), launch-decision logic, any
automatic document reading. There is no `doc:read` scope any more.

---

## Tasks

### 1. Replace the launch gate with a login gate

Today `launchRequired()` in `src/platform-session.ts` refuses to start unless
Writing Tools launched the app. Replace it with `loginRequired()` **keeping the
exact same shape**:

```ts
if (env?.PROD === true) return true;          // NOT overridable in prod
return env?.VITE_REQUIRE_LOGIN === "true";    // dev opts in, default false
```

**Carry the existing comment across.** It explains why prod ignores the
override: one stray env var would otherwise ship an ungated bundle with nothing
at runtime to signal the gate was disabled. That reasoning is unchanged.

**Dev must not do the login dance.** It already works untokened — with no
`Authorization` header the backend's sessionless path spends the capped demo
key. Preserve that: `npm run dev` should open a working Mindmap with no OAuth.

Direct visit in production shows a **"Connect to Writing Tools"** screen instead
of the current "launch required" refusal.

### 2. The PKCE flow

On the connect action:

1. generate a random verifier, keep it in **session storage**
2. generate a random `state` (plain random — there is no room id to embed any
   more)
3. redirect to `${VITE_BACKEND_URL}/auth/oauth2/authorize` with `client_id`,
   `redirect_uri`, `response_type=code`, `scope=openai:chat`,
   `code_challenge` (S256), `state`

On callback:

4. validate returned `state` matches byte-for-byte; reject otherwise
5. **scrub `code`/`state`/`error` from the URL synchronously, before the
   exchange and on every failure path.** #594 got this wrong first: scrubbing
   only in the success branch left authorization material in history whenever
   an exchange failed.
6. exchange `code` + verifier at `/auth/oauth2/token`
7. store the access token in session storage

Config: `VITE_OAUTH_CLIENT_ID` (build-time, fail closed in production the same
way `VITE_BACKEND_URL` does at ~`platform-session.ts:21`). A public OAuth client
id **is not a secret** — it is an identifier, safe in the compiled bundle. Do
not add a secret-handling path for it.

The callback URI is `window.location.origin + window.location.pathname` and must
match what Track A registers exactly.

### 3. Token handling

- Tokens last **12 hours** (Track A's setting). Expect expiry, do not assume it
  won't happen mid-session.
- On expiry or auth failure: clear the token and show the connect screen —
  **without destroying local map work.** The user's thinking lives in browser
  storage and must survive a logout. This is the single most important
  behavioural requirement in this spec.
- Accept only a plausible token shape when reading from storage (compact JWT:
  three base64url segments). Do not accept "any string over N characters."

### 4. Delete the old path

Remove grant-from-hash parsing, `/handoff/exchange`, launch-required states,
and any room code. `PlatformBootstrap`'s state machine is built around
launched-or-blocked — the error boundary, the storage-unavailable path, and the
resume/start-new choice all key off it.

**This is the largest piece of real work in this spec.** Everything else is
mechanical. Rework the state machine deliberately rather than patching around
it; if it starts sprouting special cases, stop and re-shape it.

### 5. Copy in and out

Pasting into the Draft panel already works. Copying results back out does not,
beyond browser text selection.

Add: **"Copy draft"**, and **"Copy map as outline/Markdown."**

This is not polish. If the product loop is paste-in → work → copy-out, the
copy-out affordance *is* half the integration. Treat it accordingly.

### 6. Pages deployment

The domain is attached with an approved certificate (through 2026-10-30) and
Pages is in GitHub Actions mode. Nothing has ever been deployed.

Adapt the workflow from the closed PR #593 in `writing-tools` (commit
`cb44362f`), rewritten for a **repo-root** app — no `working-directory`, no
`prototype-mindmap/` cache prefixes.

Keep #593's two safety properties:

- top-level `permissions: contents: read`, with `pages: write` / `id-token:
  write` scoped to the deploy job only
- deploy on **manual `workflow_dispatch` from `main`** only; pull requests build
  and verify but structurally cannot publish

Port the artifact verification script (backend URL present, HTTPS, `dist/`
non-empty, no `.env*` files shipped) and add a check that
`VITE_OAUTH_CLIENT_ID` is present and appears in the compiled bundle.

Production config: `VITE_BACKEND_URL=https://app.thoughtful-ai.com/api`,
`VITE_OAUTH_CLIENT_ID=<fixed public client id>`, and **remove**
`VITE_REQUIRE_LAUNCH`.

`base` stays root — correct once the custom domain is attached, since the site
serves from an origin root rather than a `/repo/` sub-path.

### 7. Tests

The old production smoke tests enter through `#wt_grant` and mock
`/handoff/exchange`. Under this design they would **pass while testing a launch
path that no longer exists.** Rewrite all of them:

- direct visit shows the connect screen, no console or asset errors
- a mocked full login round trip reaches a working Mindmap
- callback params are scrubbed from the URL, including on failure
- the bearer is attached to subsequent AI calls
- local map work survives a token clear

The skipped `wt_api` test is obsolete — delete it.

---

## Repo hygiene

`README.md` still describes the monorepo prototype. Rewrite for the standalone
app: what it is, how to run it in dev without logging in, and how the OAuth
login works in production.

---

## Verification

- `npm test`, `npm run build`, lint/format all pass
- `npm run dev` opens a working Mindmap with **no login prompt**
- a production build refuses to start unauthenticated
- `git diff --check`

Commit; do not push. Report what was verified versus assumed, and flag anything
where the Track A contract (backend URL, client id, redirect URI, scope) turned
out not to match.
