# Phase 3 plan — Manager chat

End state: clicking a project pane shows a real chat with that project's manager. The manager reads `.ceo/goal.md`, `context.md`, `decisions.md`, and `board.md` from the repo on every session (via a 60s DO storage cache), takes user messages, streams replies, and persists the whole conversation to D1. Action fenced blocks the manager emits (`dispatch_claude_code`, `post_to_board`, `update_ceo_file`, etc.) get parsed out of the stream as structured events — but Phase 3 doesn't render them or act on them. Phase 3 just gets the parser right so that later phases can light them up without changing the streaming protocol.

When this phase is done:

- `ManagerDO` (one per repo, addressed by `idFromName(repo_full_name)`) exists with the 60s `.ceo/` cache
- `GET /api/projects/:id/manager-chat` resolves the canonical chat for the project (idempotent — same chat ID on repeat calls)
- `POST /api/projects/:id/manager/chat` runs a streamed chat turn (SSE: `text` / `action` / `done` / `error`)
- `GET /api/chats/:chatId/messages` returns the full message history for a chat
- Clicking a project pane fetches its chat, renders the conversation, focuses a composer, and streams the next assistant turn as the user types-and-sends
- Manager-emitted action fenced blocks are parsed and emitted as `action` SSE events; the frontend silently absorbs them; raw text (with fences intact) is persisted so future phases can re-parse on history reload

Phase 3 is local-only. No deploy.

---

## Operator prerequisites — required before build starts

Two pieces, same pattern as Phase 1 (`database_id`) and Phase 2 (`GITHUB_TOKEN`):

1. **Cloudflare Worker secret:**
   ```
   wrangler secret put ANTHROPIC_API_KEY
   ```
   Paste the `sk-ant-...` key from console.anthropic.com.

2. **Local `.dev.vars`** — **keep the existing three lines** (`AUTH_TOKEN`, `GIT_SHA`, `GITHUB_TOKEN`) and **append** a fourth:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
   Phase 2 verification turned up a near-miss where the PAT got pasted onto the `AUTH_TOKEN` line; explicit reminder to add a new line rather than overwrite an existing one.

Build does not start until both are in place. Confirm when done.

---

## Files

### New (Worker)

- `src/durable-objects/manager.ts` — `ManagerDO` class
- `src/lib/claude.ts` — `MODEL_ID = "claude-opus-4-5"` constant, Anthropic SDK client factory, `streamClaude()` generator that yields text deltas
- `src/lib/chat.ts` — `streamChatTurn()` generator that wraps `streamClaude` with an `ActionParser` and yields SSE-shaped events
- `src/lib/actionParser.ts` — the streaming fenced-block detector (state machine, lookback buffer; see §"Action parser")
- `src/lib/managerPrompt.ts` — `buildManagerSystemPrompt({ promptTemplate, projectId, repoFullName, cloneUrl, ceoFiles })` — assembles the system prompt verbatim from `prompts/manager.md` plus the project context block
- `src/lib/githubFiles.ts` — `readCeoFiles(env, repoFullName, branch)` — 4 parallel `GET /repos/:o/:r/contents/.ceo/<file>?ref=<branch>` calls, base64-decode, return `{ goal, context, decisions, board }`
- `src/lib/sse.ts` — `sseResponse(generator)` that turns an async generator of `{ type, data }` events into a streamed `Response` with `text/event-stream`
- `src/routes/manager.ts` — `handleManagerChatResolve`, `handleManagerChat`
- `src/routes/messages.ts` — `handleListMessages`
- `src/types.d.ts` — `declare module "*.md" { const content: string; export default content; }` (ambient declaration for text imports)

### Modified (Worker)

- `wrangler.toml` — add `MANAGER_DO` binding, the migration declaring the class, and the `[[rules]]` block enabling Markdown text imports
- `src/types.ts` — add `ANTHROPIC_API_KEY: string` and `MANAGER_DO: DurableObjectNamespace` to `Env`
- `src/index.ts` — export `{ ManagerDO }` for the runtime to find
- `src/routes/index.ts` — add the three new routes
- `.dev.vars.example` — add `ANTHROPIC_API_KEY=sk-ant-replace_me` line with a comment

### New (frontend)

- `web/src/components/ChatView.tsx` — top-level chat surface for one pane: resolves chat ID, loads history, renders list + composer
- `web/src/components/MessageList.tsx` — auto-scrolls to bottom on new messages
- `web/src/components/MessageItem.tsx` — single message; speaker label in Fraunces, body in Geist, no bubbles
- `web/src/components/Composer.tsx` — textarea with Enter-to-send / Shift+Enter for newline, send button
- `web/src/components/StreamingMessage.tsx` — the in-progress assistant message (pulses while streaming)
- `web/src/hooks/useChatStream.ts` — SSE consumer hook (POST `/manager/chat`, parses events, manages streaming state)
- `web/src/lib/sse.ts` — `parseSseStream(reader)` async iterator that yields `{ event, data }` objects from a `ReadableStreamDefaultReader<Uint8Array>`

### Modified (frontend)

- `web/src/lib/api.ts` — add `apiFetchRaw(path, init)` that returns the un-parsed `Response` (used by `useChatStream` to read the SSE body directly)
- `web/src/lib/types.ts` — add `Message` type
- `web/src/components/ProjectPane.tsx` — render `<ChatView projectId={…} repoFullName={…} />` in the body instead of the Phase 2 placeholder

### Dependencies

- Add `@anthropic-ai/sdk` to root `package.json` (Worker side)
- No new frontend deps

---

## `wrangler.toml` changes

Add three blocks. Keeping the existing content unchanged.

```toml
[[durable_objects.bindings]]
name = "MANAGER_DO"
class_name = "ManagerDO"

[[migrations]]
tag = "v1"
new_classes = ["ManagerDO"]

[[rules]]
type = "Text"
globs = ["**/*.md"]
fallthrough = true
```

The migration tag `v1` is the canonical first-migration marker. Adding new DO classes in later phases (BrainstormDO, AgentHubDO) bumps to `v2`, `v3`, etc., each as separate `[[migrations]]` blocks — never edit `v1` in place once shipped.

The `[[rules]]` block lets us `import MANAGER_PROMPT from "../../prompts/manager.md"` in TypeScript and have esbuild inline the file contents at bundle time. `fallthrough = true` keeps Markdown files visible to other potential loaders (we don't have any, but it's the conservative default).

---

## Endpoint behaviors

### `GET /api/projects/:id/manager-chat`

Resolve (and idempotently create) the canonical manager chat for a project.

**Worker handler:**

1. `SELECT * FROM projects WHERE id = ?` → 404 if missing.
2. `MANAGER_DO.idFromName(project.repo_full_name)` → DO stub.
3. Forward to DO via `stub.fetch(new Request("https://do/resolve", { headers: contextHeaders }))` where `contextHeaders` carry `x-project-id`, `x-repo-full-name`, `x-default-branch`. (The DO stashes these in storage on first call so subsequent requests don't need to re-send them.)

**DO `/resolve` handler:**

1. Persist project context to storage if not already present.
2. Read `canonicalChatId` from storage. If present, return it with `created: false`.
3. Otherwise: `INSERT INTO chats (id, surface, project_id) VALUES (?, 'manager', ?)`, store the new chat ID, return with `created: true`.

**Response:**

```json
{ "chatId": "<uuid>", "projectId": "<uuid>", "created": true | false }
```

### `POST /api/projects/:id/manager/chat`

Streamed chat turn.

**Request body:**

```json
{ "chatId": "<uuid>", "message": "<user text>" }
```

`chatId` must match the project's canonical chat (resolved via `/manager-chat`). Mismatch → 400.

**Worker handler:** same project-lookup + DO-forward dance as resolve. The DO's `/chat` handler does the real work.

**DO `/chat` handler:**

1. Validate the chat ID belongs to this project.
2. `INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'user', ?)` — the user's message lands first.
3. Refresh the `.ceo/` cache if stale (>60s); see §"`.ceo/` cache" below.
4. Load chat history: `SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC` — full history for v0; we'll tier or compact later if context gets uncomfortable.
5. Build the system prompt via `buildManagerSystemPrompt(...)` — verbatim `manager.md` + project context block.
6. Stream from Claude via `streamChatTurn(...)` (see §"Streaming protocol" + §"Action parser").
7. As events arrive, write them to the SSE response stream. Accumulate the raw assistant text (including action fence blocks).
8. On `done`: `INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'assistant', ?)` with the **raw text** (fences and all). Future history reloads re-parse the same way.
9. On error: emit `event: error`, do NOT persist a partial assistant message (the user can re-send).

**Response:** `text/event-stream`, see §"Streaming protocol."

### `GET /api/chats/:chatId/messages`

Returns the message list for a chat. Used when a pane mounts to render history.

**Worker handler:** no DO involvement — straight D1 read.

**Response:**

```json
{
  "messages": [
    {
      "id": "<uuid>",
      "role": "user" | "assistant",
      "content": "<raw text, fences intact>",
      "created_at": "<iso>"
    },
    ...
  ]
}
```

`brain` is omitted for Phase 3 (manager surface; always null). It'll appear when the Brainstorm Room ships.

---

## ManagerDO design

### Addressing

`idFromName(repo_full_name)` — the spec-pinned natural key. Survives D1 wipes (re-claiming the same repo reaches the same DO instance with its stored chat ID and `.ceo/` cache).

### Storage keys

| Key | Value | Purpose |
|---|---|---|
| `projectContext` | `{ id, repoFullName, defaultBranch }` | Stashed on first contact so the DO doesn't need it in every request header thereafter |
| `canonicalChatId` | `string` | The single manager chat for this project |
| `ceoCache` | `{ files: { goal, context, decisions, board }, fetchedAt: number }` | 60s TTL cache of the four `.ceo/` content files |

### `.ceo/` cache

On cache miss (no entry or `Date.now() - fetchedAt >= 60_000`):

```ts
async function readCeoFiles(env, repoFullName, branch) {
  const paths = [".ceo/goal.md", ".ceo/context.md", ".ceo/decisions.md", ".ceo/board.md"];
  const results = await Promise.all(
    paths.map((p) => ghContents(env, repoFullName, p, branch)),
  );
  return {
    goal: results[0],
    context: results[1],
    decisions: results[2],
    board: results[3],
  };
}
```

Four parallel `GET /repos/:o/:r/contents/.ceo/<file>?ref=<branch>` calls. Each response is `{ content: base64, encoding: "base64", ... }`; decode and trim trailing whitespace.

**404 on any file:** treat as empty string. New scaffolds have empty `goal.md` / `context.md` (the manager's prompt uses empty as a signal to ask the user); we don't want a 404 on those to fail the chat.

**Cache invalidation:** Phase 3 doesn't write to `.ceo/` (the `update_ceo_file` and `post_to_board` actions are absorbed silently — see §"What we DON'T render yet"). So the only invalidation path is TTL expiry. When Phase 6 ships `post_to_board` for real, we'll add explicit invalidation on `board-post`.

### Prompt construction

`buildManagerSystemPrompt` assembles:

```
<verbatim contents of prompts/manager.md>

## Current project: <repo_full_name>

Current project ID: <project_uuid>
Repo: <clone_url>

### Goal
<contents of .ceo/goal.md>

### Context
<contents of .ceo/context.md>

### Recent decisions
<contents of .ceo/decisions.md>

### Board
<contents of .ceo/board.md>
```

Matches the format the manager prompt itself documents.

The `<recent worker job results, if any are unseen>` slot from the prompt template stays empty in Phase 3 — no execution_jobs rows exist yet. We don't even run the query (no point). When Phase 4 ships workers, that slot lights up alongside `manager_seen_at` bookkeeping.

---

## Streaming protocol

Per SPEC.md §"Streaming protocol." SSE events the Worker emits:

```
event: text
data: {"delta": "..."}

event: action
data: {"type": "dispatch_claude_code", "fields": {...}, "raw": "..."}

event: done
data: {}

event: error
data: {"message": "..."}
```

- `text` deltas are emitted as they stream from Claude (with the lookback buffer described in §"Action parser" — a few characters of latency to avoid splitting fenced blocks across events).
- `action` events fire once per complete fenced action block, after the closing fence has been seen. The `raw` field preserves the original fenced text in case future-us wants it.
- `done` fires when Claude's stream ends cleanly.
- `error` fires on any thrown exception during the turn. The Worker still closes the response cleanly after.

`event: speaker` is **not** emitted in Phase 3 (manager surface; single voice). It arrives in Phase 7 with the Brainstorm Room.

### `sseResponse` shape

```ts
export function sseResponse(
  gen: AsyncGenerator<{ event: string; data: unknown }>,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of gen) {
          controller.enqueue(
            encoder.encode(`event: ${ev.event}\ndata: ${JSON.stringify(ev.data)}\n\n`),
          );
        }
      } catch (err) {
        controller.enqueue(
          encoder.encode(
            `event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`,
          ),
        );
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      "connection": "keep-alive",
    },
  });
}
```

`no-transform` matters — some intermediaries will buffer or modify SSE if it isn't there.

---

## Action parser

The meaty part. Streaming text deltas come in from Claude; the parser detects fenced action blocks and emits them as structured events instead of text. The frontend shouldn't see raw fence markup for known actions; persistence keeps the raw form for re-parse on history reload.

### Recognized keywords

Phase 3 wires the full Phase-1-thru-7 set into a `KNOWN_ACTIONS` constant so the parser doesn't choke on anything the manager or brains can emit:

```ts
const KNOWN_ACTIONS = new Set([
  // Manager tools
  "dispatch_claude_code",
  "post_to_board",
  "update_ceo_file",
  "request_file_upload",
  // Brain tools (Phase 7 — parser ready early)
  "tag_brain_1",
  "tag_brain_2",
  "read_project_briefing",
  "read_repo_file",
  "list_repo_files",
  "read_project_chat",
  "propose_new_project",
  "archive_dropnote",
]);
```

Unknown fence keywords (e.g., a regular `\`\`\`typescript` code block) pass through as plain `text` events. The parser doesn't claim them.

### State machine

Two modes:

- **`TEXT`** — accumulating prose to emit as `text` events. Watching for fence-open.
- **`ACTION`** — inside a recognized action fence, buffering the body. Watching for fence-close.

Transitions:

```
TEXT  --[ \n```<known-keyword>\n ]-->  ACTION
ACTION --[ \n```\n  or  \n```$ ]-->  TEXT
```

When unknown keyword matched in TEXT mode, advance the parser past the fence-open line and treat as ordinary text (don't enter ACTION mode).

### Lookback buffer

Text deltas come in unpredictable chunks; a fence open like `\n\`\`\`dispatch_claude_code\n` can split across deltas. The parser holds back the last ~80 characters of the buffer before emitting, but only when those trailing characters *contain a backtick* — otherwise it emits everything. This gives:

- Normal prose streams with no perceptible latency (most chunks won't end near a backtick)
- Pre-fence chunks delay by tens of characters until the parser confirms what's coming

### Body parsing

Once an ACTION block closes, body is parsed as a tiny YAML subset:

- `key: value` → string-valued field
- `key: |` followed by 2-space-indented lines → multi-line string (indent stripped)

Enough for every action the spec defines. We don't pull in a full YAML library — the parser is ~40 lines.

Each action event carries:

```ts
{
  type: "dispatch_claude_code", // or whichever keyword
  fields: { project: "...", summary: "...", prompt: "..." },
  raw: "```dispatch_claude_code\nproject: ...\n...\n```",
}
```

### Edge cases the parser handles correctly

| Case | Behavior |
|---|---|
| Fence at end of message, no body or partial body | Emit raw text fallback in `finish()`; don't lose data |
| Fence open with unknown keyword | Pass through as text |
| Fence with empty body | Emit action event with `fields: {}` |
| Two fenced actions in one assistant turn | Both emitted in order |
| Delta lands mid-`\`\`\``  | Lookback buffer holds back; emit when next delta arrives |
| Claude stream errors mid-action | `finish()` flushes the partial back to the client as text with the opening fence preserved, then emits `error` |

I'll document the test scenarios as inline comments in the parser file so the next person editing it knows what to preserve.

---

## Frontend chat view

### `ChatView` lifecycle

When a `ProjectPane` mounts:

1. `apiFetch<{ chatId, projectId, created }>("/api/projects/:id/manager-chat")` → store `chatId` in local state.
2. `apiFetch<{ messages: Message[] }>("/api/chats/:chatId/messages")` → render history.
3. Show composer.

When the user sends a message:

1. Optimistically append the user message to local state.
2. Call `useChatStream` hook with `{ chatId, projectId, message }`.
3. As the SSE stream produces events:
   - `text` deltas accumulate into a `streamingMessage` state
   - `action` events are collected silently (not rendered yet)
   - `done` → push `streamingMessage` as a real assistant message in local state, clear streaming state
   - `error` → show inline error band under the composer, clear streaming state

### `useChatStream` hook

```ts
function useChatStream(): {
  streaming: { text: string; actions: ParsedAction[] } | null;
  error: string | null;
  send: (opts: { projectId: string; chatId: string; message: string }) => Promise<void>;
}
```

Internally uses `apiFetchRaw` (POST), reads `res.body` with `getReader()`, feeds chunks into the `parseSseStream` async iterator.

### Composer

- Single `textarea`, Geist
- Hairline border, no bubble, no shadow
- Enter sends; Shift+Enter inserts newline
- Disabled while streaming
- Submit button: paper background, ink text, ink border, hover swaps to ink fill / paper text (same affordance shape as the New Project modal's primary button — keeps the visual vocabulary tight)

### Message rendering

No bubbles. Per the design language:

```
─────────────────────────────────────
 You · 2:14 PM                       ← Fraunces small-caps speaker, time on the side, low opacity
 What's the cleanest way to scaffold
 .ceo/ when the repo already has it?

─────────────────────────────────────
 Manager · 2:14 PM
 Idempotent claim path is already in
 src/routes/projects.ts. The path
 you'd want to extend is …
```

- Speaker labels in Fraunces, small-caps tracking
- Body in Geist, normal paragraphs with proper spacing
- Hairline rules between messages (1px)
- Streaming message gets a soft pulse animation on the text (per SPEC.md "Streaming responses pulse with a soft ink-marker animation") — implementation: a subtle `text-shadow` or opacity oscillation via CSS keyframes
- Code blocks (when the manager produces `\`\`\`typescript` etc., NOT action fences) render in JetBrains Mono with a hairline border, no syntax highlighting in v0

### Auto-scroll

`MessageList` auto-scrolls to the bottom when:
- New messages arrive
- Streaming text grows
- ...unless the user has manually scrolled up (a common chat UX cue). Detect via scroll position vs. bottom-distance threshold (e.g., within 100px of bottom = "follow"; otherwise = "let user read").

### Per-pane state

Chat state lives in `ChatView` local `useState` — not in the Zustand store. Each `ProjectPane` instance owns its own chat state. Unmount drops it; remount re-fetches from the server. Simpler than per-pane Zustand slices and the server is the source of truth.

---

## What we DON'T render yet

Phase 3 absorbs every recognized action event silently:

- `dispatch_claude_code` — parsed, not rendered. The "Run Claude Code →" affordance lands in Phase 4 with the AgentHubDO.
- `post_to_board` — parsed, not rendered. The Board lands in Phase 6.
- `update_ceo_file` — parsed, not rendered. The manager housekeeping write path lands in Phase 6 (alongside `post_to_board` — both are `.ceo/` writes).
- `request_file_upload` — parsed, not rendered. File uploads land in Phase 8.
- All brain tools — parsed, not rendered. They live in Phase 7.

**UX consequence to flag:** the manager will sometimes say things like "I'll dispatch a worker to do that" and emit a `dispatch_claude_code` block — and the user will see only the prose, with nothing actually happening. This is a known Phase 3 limitation. Two ways to address:

1. **Silent absorption** (what's currently planned) — clean stream, but confusing if the manager promises action.
2. **Disabled-chip rendering** — render the action block as a small `[dispatch_claude_code: coming in Phase 4]` chip so the user can see the manager tried.

**Recommending (1)** for the cleanest Phase 3 ship. The manager prompt is also pretty good about not over-promising — it tends to describe what it'd do rather than just doing. We can revisit if testing shows the UX is too confusing.

---

## Verification

Steps 1–9 are mine. Steps 10–13 are yours (need the browser + actual manager conversation).

| # | Check | Who |
|---|---|---|
| 1 | `npm install` (adds `@anthropic-ai/sdk`) | me |
| 2 | `npm run typecheck` clean | me |
| 3 | `npm run build` clean | me |
| 4 | `npm run dev` brings up both servers | me |
| 5 | `GET /api/projects/<id>/manager-chat` with auth → 200 with `{ chatId, projectId, created: true }`. Use the project ID of a project you already claimed in Phase 2 verification | me |
| 6 | Same request again → 200 with same `chatId`, `created: false` (idempotency) | me |
| 7 | `GET /api/chats/<chatId>/messages` → 200 with `{ messages: [] }` (empty for a fresh chat) | me |
| 8 | `POST /api/projects/<id>/manager/chat` with `{ chatId, message: "hi" }` and `Accept: text/event-stream`. Capture the raw SSE stream — should see `event: text` lines (multiple), then `event: done`. No errors | me |
| 9 | `GET /api/chats/<chatId>/messages` again → 200 with the user message + the assistant message. Assistant content includes the streamed text. `created_at` ordering correct | me |
| 10 | Open `http://localhost:5173/`. Picker → open a claimed project → ChatView mounts with empty history + composer | you |
| 11 | Type a message, hit Enter → user message renders, assistant message streams in with a visible pulse animation | you |
| 12 | Send a message that the manager might respond to with an action (e.g., "could you scaffold a hello-world Worker?" — likely triggers `dispatch_claude_code`). The text streams and renders; no error appears; nothing visible happens for the action (per the silent-absorption decision); refresh the page and verify the conversation persists | you |
| 13 | Open a second project pane, hold its own separate conversation, switch back to the first — each pane has its own thread, no cross-talk | you |

If 1–9 pass on my end, I'll do the single commit + push you've been asking for; you run 10–13.

---

## Resolved decisions

**1. Anthropic SDK vs. raw fetch to Anthropic.** Use the SDK. Works in Workers with `nodejs_compat` (already set). The SDK's typed streaming iterator is worth the dep weight.

**2. Markdown text imports via `[[rules]]`.** Cleaner than copying the manager prompt into a TS string — keeps `prompts/manager.md` as the single source of truth that you can edit without touching code.

**3. Chat history depth.** Send the entire chat history to Claude every turn. v0 acceptable — no compaction, no summarization. Will revisit if a project's chat gets long enough that token cost or context window matters.

**4. Per-pane state in local `useState`, not Zustand.** The store stays small and the server is the source of truth.

**5. `update_ceo_file` and `post_to_board` parsed but absorbed silently.** Their handlers ship in Phase 6 alongside the Board (both write `.ceo/`). The action parser is wired now so the streaming protocol is settled before Phase 6 needs it.

**6. No `manager_seen_at` plumbing yet.** No execution_jobs rows exist until Phase 4. The query is omitted entirely from Phase 3 to keep the DO simple.

---

## Surprises / things to flag

**1. SSE through the Vite dev proxy.** Vite's `http-proxy` passes chunked responses through without buffering by default, so SSE should "just work" through the dev proxy at `localhost:5173` → `localhost:8787`. Calling it out because if I see line-buffering in step 11, this is the first place I'd look.

**2. Cloudflare buffers responses < 1 KB.** A real production deploy may show a delay before the first SSE event reaches the client if the initial event is tiny. For local dev (wrangler dev) it's fine. For prod we may want to prime the stream with a `:` comment line to force flush. Not a Phase 3 concern (we're local-only) but worth recording.

**3. The Anthropic SDK's `messages.create({ stream: true })` returns a stream where each event needs to be matched on `type` first.** Specifically `content_block_delta` events with `delta.type === "text_delta"` are where text comes from. Other event types (`message_start`, `content_block_start`, `message_stop`, etc.) we ignore in Phase 3. If the SDK adds tool-use events later, we'd want to handle them — for now, text-only.

**4. Repo rename / default-branch rename invalidates DO state.** If you rename a claimed repo on GitHub, the DO addressed by the old `repo_full_name` becomes orphaned and a new DO gets created for the new name (with no chat history). v0 doesn't handle this — flag for the day it bites.

**5. The chat composer pulse animation.** Implementation choice: an `@keyframes` opacity oscillation or a translucent ink-marker drawn behind. I'll prototype both in Phase 3 build and pick the one that feels right. Will report back with what shipped.
