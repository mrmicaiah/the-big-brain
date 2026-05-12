# Phase 1 plan — Foundation

The smallest possible **working** state: a Worker that serves `/health` and gates `/api/*` behind a Bearer token, a D1 schema applied locally, a Vite + React + Tailwind v3 SPA that loads in the browser with the design language proven out and an editorial empty state. Nothing else. No DOs, no chat, no GitHub, no Anthropic, no agent.

When this phase is done:

- `npm run dev` brings up Vite (5173) and wrangler (8787) together
- `GET http://localhost:5173/health` → `{ ok: true, version: "dev" }`
- `GET http://localhost:5173/api/anything` without `Authorization: Bearer …` → `401`
- `GET http://localhost:5173/api/anything` with a valid token → `404 { error: "not_found" }` (gate passes, no route matches yet)
- `http://localhost:5173/` renders the empty-state shell — paper background, Fraunces wordmark, an inert top dock, an inert bottom bar, and a centered "No projects." line

That's the whole shippable surface for Phase 1.

---

## Files to create

Group by purpose. Anything not listed here is deferred to the phase that actually needs it (no empty stubs for ManagerDO, BrainstormDO, AgentHubDO, lib/github.ts, lib/claude.ts, etc.).

### Repo root

- `package.json` — npm workspaces (`web` is the only member), root dev deps (wrangler, typescript, @cloudflare/workers-types, concurrently), root scripts
- `wrangler.toml` — Worker config, D1 binding, `[assets]` block
- `tsconfig.json` — Worker TypeScript config (extends a base, includes `src/`)
- `.gitignore` — Node, Vite, wrangler, `.dev.vars`, `.wrangler/`, `web/dist/`, `web/node_modules/`
- `.dev.vars.example` — `AUTH_TOKEN=dev-token` and `GIT_SHA=dev` (committed; real `.dev.vars` is gitignored)

#### Local dev token — pinned

To avoid the "Vite sends one token, Worker expects another" trap, both example env files use the same literal in Phase 1:

| File | Variable | Value |
|---|---|---|
| `.dev.vars.example` | `AUTH_TOKEN` | `dev-token` |
| `web/.env.example` | `VITE_AUTH_TOKEN` | `dev-token` |

The operator copies each `.example` to its real path (`.dev.vars` and `web/.env`) on first setup; the tokens stay matched. In production they're set independently — `wrangler secret put AUTH_TOKEN` on the Worker, `VITE_AUTH_TOKEN` in the build env for the SPA — and the operator is responsible for keeping them equal.
- `scripts/deploy.mjs` — cross-platform deploy wrapper: shells out to `git rev-parse HEAD`, then spawns `wrangler deploy --var GIT_SHA:<sha>` with stdio inherited. Node-native, runs the same on Windows/macOS/Linux.

### Worker (`src/`)

- `src/index.ts` — `fetch` handler: route on pathname, auth gate, `/health`, fallthrough to `env.ASSETS.fetch(request)`
- `src/types.ts` — `Env` interface (Phase 1 fields only: `DB`, `ASSETS`, `AUTH_TOKEN`, `GIT_SHA`)
- `src/lib/auth.ts` — `requireAuth(request, env)` helper, returns `Response | null` (null = pass)
- `src/db/schema.sql` — the full schema from SPEC.md §"What lives in D1," applied via `wrangler d1 execute`

That's it for the Worker. The `src/lib/` and `src/durable-objects/` directories listed in the spec's repo layout will fill in over later phases.

### Frontend (`web/`)

- `web/package.json` — Vite, React, TypeScript, Tailwind v3, PostCSS, Autoprefixer
- `web/vite.config.ts` — React plugin + dev proxy for `/api` and `/health` → `http://localhost:8787`
- `web/tsconfig.json` + `web/tsconfig.node.json`
- `web/tailwind.config.js` — design tokens (paper/ink/accent/hairline, Fraunces/Geist/JetBrains Mono)
- `web/postcss.config.js` — tailwind + autoprefixer
- `web/index.html` — `<link>` tags for the three Google Fonts, mount node, app title
- `web/.env.example` — `VITE_AUTH_TOKEN=dev-token`
- `web/src/main.tsx` — React root
- `web/src/App.tsx` — the empty-state shell (described below)
- `web/src/index.css` — Tailwind directives, base styles, grain overlay
- `web/src/components/TopDock.tsx` — inert version (just the `+` chip on the right)
- `web/src/components/BottomBar.tsx` — inert version (dropnote-shaped input + two right-side buttons)
- `web/src/components/EmptyWorkspace.tsx` — the centered empty-state phrase

Components are split this way from the start because they're going to grow in every later phase; doing it now avoids a Phase 2 refactor.

---

## `wrangler.toml` shape

```toml
name = "the-big-brain"
main = "src/index.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]

[vars]
GIT_SHA = "dev"  # overridden in deploy script via --var GIT_SHA:$(git rev-parse HEAD)

[[d1_databases]]
binding = "DB"
database_name = "the-big-brain"
database_id = "<filled in after `wrangler d1 create`>"
migrations_dir = "src/db/migrations"

[assets]
directory = "./web/dist"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = true
```

Notes:

- `run_worker_first = true` so `/api/*` and `/health` always hit the Worker; the Worker explicitly delegates non-API paths to `env.ASSETS.fetch(request)`, which then honors the SPA fallback for client-side routes.
- `migrations_dir` is set even though Phase 1 only has one `schema.sql` — applying it via `wrangler d1 execute --file=src/db/schema.sql --local` for now. We'll move to formal numbered migrations the first time we change the schema.
- `database_id` is filled in once on first setup. I'll note in the README that the operator runs `wrangler d1 create the-big-brain` and pastes the ID in.
- Secrets (`AUTH_TOKEN`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `AGENT_TOKEN`) are NOT in wrangler.toml. They're set via `wrangler secret put` in prod and `.dev.vars` locally. Phase 1 only needs `AUTH_TOKEN`.
- DO bindings are deliberately absent. Adding a binding for a class that doesn't exist would break the build. They land in Phase 3 (`MANAGER_DO`), Phase 4 (`AGENT_HUB_DO`), and Phase 7 (`BRAINSTORM_DO`).

---

## Root `package.json` shape

```jsonc
{
  "name": "the-big-brain",
  "private": true,
  "workspaces": ["web"],
  "scripts": {
    "dev": "concurrently -n worker,web -c blue,magenta \"npm:dev:worker\" \"npm:dev:web\"",
    "dev:worker": "wrangler dev",
    "dev:web": "npm run dev -w web",
    "build:web": "npm run build -w web",
    "build": "npm run build:web",
    "deploy": "npm run build && node scripts/deploy.mjs",
    "db:apply:local": "wrangler d1 execute DB --local --file=src/db/schema.sql",
    "db:apply:remote": "wrangler d1 execute DB --remote --file=src/db/schema.sql",
    "typecheck": "tsc --noEmit && npm run typecheck -w web"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4",
    "concurrently": "^9",
    "typescript": "^5",
    "wrangler": "^4"
  }
}
```

The `deploy` script calls `scripts/deploy.mjs` — a small Node wrapper that resolves the commit SHA and spawns `wrangler deploy --var GIT_SHA:<sha>` with stdio inherited. Cross-platform from day one (no bash substitution, no Git Bash requirement on Windows). Phase 1 doesn't run deploy, but the wrapper exists so Phase 2 can deploy without a tooling detour.

### `scripts/deploy.mjs` shape

```js
#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";

const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const result = spawnSync(
  "wrangler",
  ["deploy", "--var", `GIT_SHA:${sha}`],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
```

`shell: true` on Windows so `wrangler` (a `.cmd` shim) resolves through the shell PATH the same way it does on POSIX. ~10 lines, no deps.

---

## `web/package.json` shape

```jsonc
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18",
    "react-dom": "^18"
  },
  "devDependencies": {
    "@types/react": "^18",
    "@types/react-dom": "^18",
    "@vitejs/plugin-react": "^4",
    "autoprefixer": "^10",
    "postcss": "^8",
    "tailwindcss": "^3",
    "typescript": "^5",
    "vite": "^5"
  }
}
```

No Zustand, no react-router, no @tanstack/query yet. Phase 1 doesn't need them. They go in when the phase that needs them lands.

---

## Worker scaffold

### `src/types.ts`

```ts
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  AUTH_TOKEN: string;
  GIT_SHA: string;
}
```

Phase 2 adds `GITHUB_TOKEN`. Phase 3 adds `ANTHROPIC_API_KEY` and the `MANAGER_DO` namespace. Etc.

### `src/lib/auth.ts`

```ts
import type { Env } from "../types";

export function requireAuth(request: Request, env: Env): Response | null {
  const header = request.headers.get("Authorization") ?? "";
  const expected = `Bearer ${env.AUTH_TOKEN}`;
  // Constant-time-ish compare. Not a true timing-safe compare; static token + single user means
  // the threat model doesn't warrant it. Just don't short-circuit on the obvious prefix.
  if (header.length !== expected.length || header !== expected) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
```

### `src/index.ts`

```ts
import type { Env } from "./types";
import { requireAuth } from "./lib/auth";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Open: health
    if (url.pathname === "/health") {
      return json({ ok: true, version: env.GIT_SHA });
    }

    // Gated: API
    if (url.pathname.startsWith("/api/")) {
      const denied = requireAuth(request, env);
      if (denied) return denied;
      // No routes yet — Phase 2 adds them.
      return json({ error: "not_found" }, 404);
    }

    // Everything else: static assets / SPA fallback
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
```

That's the entire Worker for Phase 1. ~25 lines.

### `src/db/schema.sql`

Verbatim from SPEC.md §"What lives in D1." All five tables + six indexes. Applied to the local D1 database with `npm run db:apply:local`. No data; no seed.

---

## Frontend scaffold

### Tailwind config

```js
// web/tailwind.config.js
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#F8F5EE",
        ink: "#1C1A17",
        accent: "#1E3A5F",
        hairline: "#E5DFD2",
      },
      fontFamily: {
        display: ['"Fraunces"', "serif"],
        sans: ['"Geist"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "monospace"],
      },
    },
  },
  plugins: [],
};
```

### `web/index.html`

Loads the three Google Fonts (Fraunces, Geist, JetBrains Mono) via `<link>` for Phase 1. Self-hosting can come later if we care about offline / privacy / weight. Sets `<html class="bg-paper text-ink">` so the page is paper-colored before React mounts.

### `web/src/index.css`

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html, body, #root { height: 100%; }
  body {
    @apply bg-paper text-ink font-sans antialiased;
    /* 4% noise grain overlay — SVG turbulence as a tiny data URI, fixed so it doesn't scroll */
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.04 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>");
    background-repeat: repeat;
  }
}
```

The grain SVG is tiny, tiled, sits at 4% alpha — applied to body so it composits over the warm paper color.

---

## The empty-state UI

This is what loads at `/` after `npm run dev`:

```
+-----------------------------------------------------------------+
|                                                            [ + ]|   ← top dock: just the + chip, far right, inert
+-----------------------------------------------------------------+
|                                                                 |   ← hairline rule under the dock
|                                                                 |
|                                                                 |
|                                                                 |
|                       No projects.                              |   ← Fraunces, large-ish, ink at ~60% opacity, centered
|        Open a project from the dock above to start.             |   ← Fraunces, smaller, ink at ~40% opacity
|                                                                 |
|                                                                 |
|                                                                 |
+-----------------------------------------+-----------------------+   ← hairline rule above the bottom bar
| [ drop a note…                       ^] | [ Brainstorm Room ]   |
|                                         | [ Board ]             |   ← buttons styled but inert
+-----------------------------------------+-----------------------+
```

Concretely:

- **Top dock** — A single row, paper background, ~44px tall, hairline rule along the bottom edge. Empty area on the left (where project tabs will live in Phase 2). A `+` button at the right, drawn as a small square with hairline border, ink glyph. Cursor stays default; clicking it does nothing. Native `title="coming next"` tooltip on hover so the button reads as intentional-but-not-yet-wired rather than broken.
- **Workspace** — Fills the rest of the height. Two centered lines:
  - **"No projects."** in Fraunces at ~`text-3xl`, ink at `opacity-60`.
  - **"Open a project from the dock above to start."** directly below, Fraunces at ~`text-base`, ink at `opacity-40`.
  Both centered both axes as a single block.
- **Bottom bar** — A single row, paper background, ~52px tall, hairline rule along the top edge.
  - **Left half:** the dropnote-shaped input. Placeholder text "drop a note…" in Geist italic at low opacity. A `^` chevron button at the right edge of the input. Input is `disabled` so the cursor doesn't even land in it — visible but plainly inert.
  - **Right half:** two text-button-styled affordances, "Brainstorm Room" and "Board," Geist small-caps, hairline border, ink color. Also `disabled`/inert.

No animations, no streaming pulses, no notification dots, no modals. Editorial restraint. The shell is the message: this is what the surface will be, and the rest hasn't been built yet — but the room has been measured.

---

## Verification (Phase 1 done = all of these pass)

1. `npm install` at the root installs everything (root + `web/` via workspaces).
2. `npm run db:apply:local` creates the local D1 file and applies all five tables.
3. `npm run dev` starts wrangler (8787) and Vite (5173) concurrently with no errors.
4. `curl http://localhost:5173/health` → `{"ok":true,"version":"dev"}` (proxied through Vite to wrangler).
5. `curl http://localhost:5173/api/foo` → `401 {"error":"unauthorized"}`.
6. `curl -H "Authorization: Bearer dev-token" http://localhost:5173/api/foo` → `404 {"error":"not_found"}`.
7. Open `http://localhost:5173/` in a browser — paper background with the visible grain, top dock with `+` on the right (tooltip "coming next" on hover), empty workspace with "No projects." and the muted second line below it, bottom bar with the inert dropnote and two buttons. Fraunces renders for the empty-state lines; Geist renders for the buttons and placeholder.
8. `npm run typecheck` passes for both Worker and web.
9. `npm run build` (frontend, via the root `build` script) completes cleanly. Catches broken Vite/Tailwind/TS config in Phase 1 rather than discovering it in Phase 7 when a future change happens to invoke it.

If any of these fail, Phase 1 isn't done.

### Phase 1 is local-only — no deploy

The `deploy` script exists and the `scripts/deploy.mjs` wrapper is wired, but Phase 1 does not run them. Deployment is its own verification step after you've reviewed the running local system. We'll cut a deploy as a separate change.

---

## Explicitly deferred (do not build in Phase 1)

- Any Durable Object (no `MANAGER_DO`, `BRAINSTORM_DO`, `AGENT_HUB_DO`, no class files, no bindings in wrangler.toml)
- Any GitHub or Anthropic client code
- Any data fetching on the frontend (no `lib/api.ts`, no store)
- The project picker dropdown (Phase 2)
- The dropnote backend or capture behavior (Phase 5)
- The Board drawer (Phase 6)
- The Brainstorm Room surface (Phase 7)
- Any deploy automation beyond the `deploy` script stub
- Self-hosted fonts (Google Fonts via `<link>` is fine for v0)
- Migration tooling beyond a single `schema.sql` (formal numbered migrations land the first time we change the schema)

---

## Resolved: who runs `wrangler d1 create`

You do, once, locally. You paste the returned `database_id` into `wrangler.toml` and commit it. I never need to touch your Cloudflare account from this environment.

**Build gate:** I will not start the Phase 1 build until that `database_id` is in `wrangler.toml` on `main`. Otherwise `npm run db:apply:local` won't work and the verification step that proves the schema applies cannot pass. The rest of the work depends on it, so the cleanest sequence is:

1. You run `wrangler d1 create the-big-brain` locally.
2. You paste the `database_id` into `wrangler.toml` (I'll commit the file with `database_id = "REPLACE_ME"` so the diff is one line; or I can wait and you commit it directly — your call).
3. You give the green light.
4. I execute the build in order: root config → Worker → schema apply → frontend → verification.
