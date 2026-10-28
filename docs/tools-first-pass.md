# Tools-first pass: a fresh Mindmap where the rules live in the tool calls

Status: spec for an experiment on branch `explore/tools-first`. Nothing here changes the
live app. The new app is built from scratch in `next/`; the current app in `src/` stays
as it is so the two can be compared.

## 1. Why

The current coach is boxed in step by step: a typed response format, a validator for
visible text, a recovery ladder, turn-shape and sparse-map advisories, working memory.
The question this pass tests:

> If the model reasons freely, and only its **actions** are checked, at the moment it
> attempts them, inside the tool that performs them, do we keep the design's guarantees
> with far less machinery, and get a better coach?

At its simplest the app is **a text chat that can change a map through tools, with or
without restrictions depending on the level**.

The model works the way any agent with tools works: it reasons, attempts an action, and
if the action is refused it sees why and decides what to do next (try differently, ask
the writer, or explain what it tried). Nothing walks it through the rules step by step;
the rules are stated, and enforced only when an action executes.

## 2. Decisions

| Topic | Decision |
|---|---|
| Where checks live | In each tool's handler, when the tool executes. Schemas carry shape only (types, required fields). No separate gateway or validator stage. |
| Interpretation | Handlers compare text ("is this inside that?", "does this come before that?"). They never decide what text means. No regexes or word lists for meaning. |
| Who writes card text | The model. The handler checks it against the writer's words. |
| What the model sees | The full conversation, plus the current map, draft, level and budget. No separate "source bank" view, no segment IDs. |
| What the handler checks against | A record of the writer's own messages exactly as sent, kept by the app. Never the model's own messages. |
| Partial quotes | Allowed. The writer's confirmation is the safety net. No negation check. |
| Map edits by the model | Every one is a tool call, and every result is a **proposal**. Nothing reaches the map without the writer's click. Several proposals per turn are fine. |
| Visibility | Every tool call shows in the chat with its result. Refusals show a reason the writer can expand. |
| Refusals | Say truthfully what failed. They don't tell the model what to do instead. |
| Attempt budget | At most 3 refused attempts per turn. The count is in every refusal. After the third, tools are removed and the model replies in text only. |
| `suggest_idea` below L2 | Offered, always refused, so the model learns the boundary and draws the idea out of the writer instead. |
| Memory between calls | None. Every call is stateless and sends everything (section 7), ordered so the provider's prompt cache covers the repeated part. No provider-side conversation storage. |
| Suggestion adoption | Kept as it works today, behind an on/off setting. |
| Out of v1 | i18n, a restating tool, working memory, the fuzz harness (after v1), L3 (after v1), the Think/Map slider, steering buttons, voice, Control Room diagnostics, sign-in and deploy. |

## 3. Levels

| | L0 | L1 | L2 | L3 (planned, after v1) |
|---|---|---|---|---|
| Model can read | chat + draft | chat + draft | chat + draft | chat + draft |
| Card text may come from | writer's chat messages | chat + draft | chat + draft | anything |
| Links and nesting | only if the writer stated them (section 5.2) | same as L0 | proposed freely | applied freely |
| Coach's own ideas (`suggest_idea`) | refused | refused | proposed, labelled | allowed |
| Checks in handlers | on | on | on (graph integrity only for links and nesting) | off |

At L0 the model **sees** the draft but cannot quote it on the map.

L3 exists for a study comparing writers' sense of ownership with and without
restrictions. It is the same tools with handler checks switched off. Build v1 so each
handler takes `{ checks: boolean }`; nothing else is needed now. Whether L3 shows
provenance labels is a study-design question for later.

## 4. App state (owned by code, not the model)

- **Writer record:** every message the writer sends, exactly as typed, with its turn
  number; plus the current draft. This is what handlers check against. The model's own
  messages are never in it.
- **Map:** cards `{ id, text, parentId, provenance, sources }` and links
  `{ id, from, to, label, provenance }`. The writer can add, edit, drag, delete, nest and
  undo directly; those are immediate (they are the writer's own actions).
- **Proposals:** pending `{ id, kind: card | link | nest | suggestion, ... }`, each
  accepted or rejected by the writer. A link or nest that refers to a pending card is
  dropped if that card is rejected.
- **Level** (fixed for the length of a turn) and **settings** (`suggestionAdoption`).
- **Provenance is set by code from what the handler found**, never passed by the model.

Saved in the browser, like today.

## 5. Tools

All tools return a result to the model:

```json
{ "ok": true,  "proposal": "p5", "shown_as": "card: \"X is bad\"" }
{ "ok": false, "reason": "\"X is good\" is not in your messages", "attempts_left": 2 }
```

### Matching rule (used by every check)

"Verbatim" means a plain substring match after mechanical normalization: Unicode NFC,
lower-case, whitespace runs collapsed to one space, and straight/curly quotes treated
alike. No other transformation.

When a piece matches in more than one message, record the most recent match, and all
matches.

### 5.1 `propose_card`

```json
{ "pieces": ["string", "..."] }
```

- **Card text** is the pieces in the model's order, joined with a single space. Code adds
  no words.
- **Checks (L0–L2):** every piece is non-empty and matches verbatim in the eligible text:
  the writer's chat messages at L0; chat plus the current draft at L1 and L2.
- **Provenance:** one source → the writer's own (no badge). More than one source → label
  `From 2 messages` (`From N messages`). Proposed for any piece from the draft: `From your
  draft`; confirm the wording when building.
- Refusal example: `"X is good" is not in your messages`.

### 5.2 `propose_link`

```json
{ "from_card": "c1", "to_card": "p5", "label": "because", "evidence": ["string", "..."] }
```

`from_card` and `to_card` may be existing cards or card proposals from this turn.

- **Always (L0–L2):** both cards exist (or are pending), they differ, and no identical
  link exists.
- **L0 and L1, the evidence rule:**
  1. `evidence` has one or two pieces, each verbatim in the writer's eligible messages.
  2. Two pieces must come from **two adjacent writer messages** (only the coach's turn
     between them), in order.
  3. Both cards' text appears inside the evidence.
  4. The label appears inside the evidence, **after** the `from` card's text and
     **before** the `to` card's text.

  Example: messages "I like X but I'm not sure", coach "why?", "because X is bad".
  Evidence `["I like X", "because X is bad"]`, label `because`, cards "I like X" and
  "X is bad" all pass. It's adjacency, not interpretation.
- **L2:** no evidence needed; the label is free; provenance `AI suggested`.

### 5.3 `propose_nest`

```json
{ "child": "c2", "parent": "c1", "evidence": ["string", "..."] }
```

- **Always:** both exist, differ, and nesting would not create a cycle.
- **L0 and L1:** the same evidence rule as links, steps 1–3 (no label).
- **L2:** no evidence needed.

### 5.4 `suggest_idea`

```json
{ "text": "string", "near_card": "c1" }
```

- **L0 and L1:** always refused: `suggest_idea isn't available at L0`.
- **L2:** creates a suggestion proposal; provenance `AI suggestion`.

### Known gaps (documented, covered by the writer's confirmation)

- A partial piece can drop a "not" and reverse the meaning.
- Both cards appearing in the evidence doesn't prove the evidence relates them ("I like X
  and I hate Y").
- For nesting, which card is the parent isn't checked.
- If the writer used "it" instead of repeating a card's words, a link can't be proven, so
  the coach has to ask.
- A card the writer has edited no longer matches their earlier words, so it can't be
  linked by evidence until they state the link again.
- Plain chat text is unchecked: the coach could paraphrase the writer in chat. Watch for
  it in v1; a restating tool is the v2 option if it happens often.

## 6. The tool loop and budget

1. The writer sends a message. Code records it.
2. Call the model with the full context (section 7) and the tools for this level.
3. For each tool call: run the handler, create a proposal or a refusal, and append the
   call and its result to the turn.
4. Refusals count against the budget. Each refusal includes `attempts_left`.
5. Call the model again with the results, until it replies with text and no tool calls.
6. When `attempts_left` reaches 0, the next call is made with `tool_choice: "none"`, so
   the reply is text only.
7. Safety cap: no more than 8 model calls in one turn, whatever happens.

The prompt permits honesty about refused actions. Example of the behaviour this is meant
to allow (not scripted): *"I tried to put something you said on the map, but I couldn't
tie it to your words. What do you want that point to be?"*

## 7. What the model sees on every call

Stateless: everything is sent every time, in this order (static first, so the provider's
prompt cache covers it):

1. **Instructions:** role (a thinking coach; the writer owns the map), this level's rules
   in plain words, the budget, permission to be honest about refusals, and a few
   conversation notes (e.g. "if the writer declined something, don't raise it again").
2. **Tool definitions:** name, a description that states the rule its handler enforces,
   and the fields.
3. **The conversation so far:** writer messages, coach replies, and earlier tool calls
   with their results, refusals included. For very long chats, the oldest messages are
   left out of what the model sees; the writer record keeps everything, so old quotes
   still check.
4. **Current state, rebuilt each call:** the map (cards and links with IDs and short
   provenance), pending proposals, outcomes of the writer's decisions since the last
   call ("accepted p3", "rejected p4"), the draft, and `level · attempts left`.
5. **The writer's new message.**

API: OpenAI Responses through the Writing Tools proxy (`/api/openai/responses`), the
same model setting as today (`VITE_MINDMAP_MODEL`). Local development uses the backend's
sessionless path, so v1 needs no sign-in.

## 8. What the writer sees

- **Chat**, with each tool call as one line: tool name, a one-line summary, and the
  result. Proposals have **Accept** and **Reject**; refusals have a collapsed **why**:

  ```
  ✕ suggest_idea · refused                          ▸ why
  ✓ propose_card · "X is bad"                       [Accept] [Reject]
  ✓ propose_link · I like X → because → X is bad    [Accept] [Reject]
  That sounds like the reason behind your doubt…
  ```

- **Map:** accepted proposals appear; pending ones are not on the map.
- **Level picker:** a change applies from the next turn.
- **Draft panel:** a box to paste the draft into.
- **Copy map** and **copy draft** out.

Keep it simple: no extra panels or diagnostics in v1.

## 9. v1 scope and build order

1. **Core loop with plain UI:** chat, writer record, the four tools and handlers, the
   budget, proposals with accept and reject, the map with direct editing and undo, level
   picker, draft panel, browser saving, copy out.
2. **Suggestion adoption** ported from `src/map/suggestion-adoption.ts`, behind its
   setting.
3. **Tests for every handler rule** in sections 5.1–5.4, including each refusal reason,
   adjacency, label position, cycles, the budget and the 8-call cap.
4. **Try it in real conversations** at each level, including the "I like X… because X
   is bad" case and a long rambling message.

After v1: port the adversarial fuzz harness to these tools; match the current app's
look by screenshot comparison; L3; sign-in (copy `src/platform/` as is) and deploy;
compare with the current app (code size, behaviour, how the coach feels) and decide.

## 10. Layout

```
next/
  package.json, vite.config.ts, tsconfig.json   own app, own scripts
  src/
    state/      writer record, map, proposals, settings, persistence
    tools/      one file per tool: schema, description, handler, tests
    loop/       context builder (section 7), tool loop and budget (section 6)
    ui/         chat, tool lines, map, level picker, draft panel
```

Merge `origin/main` into this branch whenever useful; `next/` never conflicts with
`src/`.
