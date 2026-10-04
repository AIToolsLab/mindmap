# Mindmap

Mindmap is a standalone writing-support app for externalizing a draft into a
user-controlled node graph. The AI can ask questions, reflect the writer's own
language, and propose structure, but map changes remain inert until the writer
confirms them.

The current product loop is deliberately manual:

1. Copy text from Word, Google Docs, or another editor into the Draft panel.
2. Think with the coach and shape the map.
3. Use **Copy draft** or **Copy map** to move the result back to the editor.

The app does not read or store a remote document. Drafts, maps, and conversation
state persist in the browser's local storage.

## Local development

```sh
npm install
npm run dev
```

Development opens at `http://localhost:5181/` without a login prompt. Requests
without a bearer token use Writing Tools' capped sessionless development path.
To exercise the login gate locally, set `VITE_REQUIRE_LOGIN=true`; this flag is
development-only and can never disable login in a production build.

The development defaults are:

- backend: `http://localhost:8000/api`
- OAuth client: `writing-tools-mindmap`
- callback: `http://localhost:5181/`
- resource: `http://localhost:8000`

## Production authentication

Production always requires **Connect to Writing Tools**. Mindmap uses OAuth
Authorization Code with PKCE S256 as a public client and requests only
`openai:chat`. The PKCE transaction and 12-hour JWT are stored in session
storage; local map work is stored separately and survives expiry, failed login,
403 access denial, and Disconnect.

The production bundle pins:

- backend: `https://app.thoughtful-ai.com/api`
- client: `writing-tools-mindmap`
- callback: `https://mindmap.thoughtful-ai.com/`
- resource/audience: `https://app.thoughtful-ai.com`

The resource is the backend origin only—no `/api` path and no trailing slash—and
is sent on both authorize and token requests. Browser requests use
`credentials: "omit"`; Disconnect clears only Mindmap's local OAuth state and
never signs the user out of Writing Tools.

Before production login can work, the Writing Tools backend deployment must set:

```text
MINDMAP_OAUTH_CLIENT_ID=writing-tools-mindmap
MINDMAP_OAUTH_REDIRECT_URIS=https://mindmap.thoughtful-ai.com/
```

Restart the backend after setting them so startup provisioning creates or
updates the fixed client. Do not register localhost on the production server.

## Source layout

| Folder | Responsibility |
| --- | --- |
| `src/` | Entry point and shared definitions |
| `src/coach/` | One model turn: prompt, transport, response parsing, and turn loop |
| `src/grounding/` | Code checks on AI output |
| `src/map/` | Map, Source Bank, proposal state, and provenance |
| `src/session/` | Persistence, logging, and diagnostics |
| `src/platform/` | Writing Tools sign-in |
| `src/ui/` | React components, UI copy, and DOM helpers |
| `src/i18n/` | Translation dictionaries |

## Verification

```sh
npm test
npm run build
npm run test:e2e
npm run test:e2e:pages
```

`test:e2e` runs against the ungated development server. `test:e2e:pages` builds
the production artifact, verifies its compiled backend/client configuration,
and runs login, auth-failure, persistence, and clipboard smoke tests against a
local preview with mocked OAuth endpoints.

## GitHub Pages

The Pages workflow builds and verifies pull requests but cannot publish them.
A deployment can run only through a manual `workflow_dispatch` from `main`.
The build job has read-only repository permission; Pages write and OIDC token
permissions exist only on the deployment job.

The custom domain serves the app from `/`, so Vite's base remains root. The
artifact verifier rejects missing or non-HTTPS production configuration, an
empty build, a bundle missing the backend URL or OAuth client ID, and any
accidentally copied `.env` file.

Rooms, automatic document handoff, and refresh tokens are intentionally outside
this release. They can be revisited without weakening the standalone OAuth or
browser-local persistence boundaries.
