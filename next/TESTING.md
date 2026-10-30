# Trying the tools-first Mindmap locally

For colleagues who already have the Writing Tools repo with its backend set up
(dependencies installed, `OPENAI_API_KEY` in `backend/.env`). Calls are paid by that key.

## 1. Start your Writing Tools backend with sign-in off

From inside `writing-tools/backend` (it loads `.env` from the folder it starts in):

```powershell
$env:BETTER_AUTH_ENABLED='false'; npx tsx src/index.ts
```

On macOS/Linux: `BETTER_AUTH_ENABLED=false npx tsx src/index.ts`

It must be on port 8000, and your checkout must be from 2026-07-17 or later (that is
when `/api/openai/responses` was added; `git pull` if unsure). If something else is
already on port 8000, such as an old backend, stop it first, or the app will talk to it.

## 2. Run the app

```bash
git clone https://github.com/AIToolsLab/mindmap
cd mindmap
git checkout explore/tools-first
cd next
npm ci
npm run dev
```

Open http://localhost:5183.

## If something's off

- **"Couldn't reach the coach"** in the chat: the backend isn't running on port 8000, or
  sign-in is on.
- **A model error:** your key may not have access to the default model. Choose another
  with `VITE_MINDMAP_MODEL` (e.g. `$env:VITE_MINDMAP_MODEL='gpt-5'; npm run dev`).
- Your chat, map and draft are saved only in your browser. "New session" clears them.

What this app is and what it tests: `../docs/tools-first-pass.md`.
