import type { Env } from "../types";
import { readCeoFiles, type CeoFiles } from "../lib/githubFiles";
import { buildManagerSystemPrompt } from "../lib/managerPrompt";
import { streamChatTurn } from "../lib/chat";
import { sseResponse } from "../lib/sse";
import { newId } from "../lib/ids";
import type { ChatMessage } from "../lib/claude";

const CEO_CACHE_TTL_MS = 60_000;

interface ProjectContext {
  id: string;
  repoFullName: string;
  defaultBranch: string;
}

interface CeoCache {
  files: CeoFiles;
  fetchedAt: number;
}

interface MessageRow {
  id: string;
  chat_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

/**
 * ManagerDO — one instance per project, addressed by
 * `MANAGER_DO.idFromName(repo_full_name)`. Survives D1 wipes: re-claiming the
 * same repo returns the same DO with its stored chat ID and `.ceo/` cache.
 *
 * Storage:
 *   projectContext   { id, repoFullName, defaultBranch }  — stashed on first contact
 *   canonicalChatId  string                                 — the single manager chat for this project
 *   ceoCache         { files, fetchedAt }                   — 60s TTL of the four .ceo/ content files
 */
export class ManagerDO {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/resolve" && request.method === "GET") {
      return this.handleResolve(request);
    }
    if (url.pathname === "/chat" && request.method === "POST") {
      return this.handleChat(request);
    }
    return new Response("not found", { status: 404 });
  }

  private async ensureContext(request: Request): Promise<ProjectContext> {
    const stored = await this.state.storage.get<ProjectContext>("projectContext");
    if (stored) return stored;

    const id = request.headers.get("x-project-id");
    const repoFullName = request.headers.get("x-repo-full-name");
    const defaultBranch = request.headers.get("x-default-branch");
    if (!id || !repoFullName || !defaultBranch) {
      throw new Error("missing project context headers on first DO contact");
    }
    const ctx: ProjectContext = { id, repoFullName, defaultBranch };
    await this.state.storage.put("projectContext", ctx);
    return ctx;
  }

  private async handleResolve(request: Request): Promise<Response> {
    const ctx = await this.ensureContext(request);
    const existing = await this.state.storage.get<string>("canonicalChatId");
    if (existing) {
      return jsonResponse({ chatId: existing, projectId: ctx.id, created: false });
    }
    const chatId = newId();
    await this.env.DB.prepare(
      "INSERT INTO chats (id, surface, project_id) VALUES (?, 'manager', ?)",
    )
      .bind(chatId, ctx.id)
      .run();
    await this.state.storage.put("canonicalChatId", chatId);
    return jsonResponse({ chatId, projectId: ctx.id, created: true });
  }

  private async handleChat(request: Request): Promise<Response> {
    const ctx = await this.ensureContext(request);

    let body: { chatId?: unknown; message?: unknown };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (typeof body.chatId !== "string" || typeof body.message !== "string") {
      return jsonResponse({ error: "invalid_body" }, 400);
    }
    const chatId = body.chatId;
    const userMessage = body.message;

    // Validate chat belongs to this project
    const canonical = await this.state.storage.get<string>("canonicalChatId");
    if (canonical !== chatId) {
      return jsonResponse({ error: "chat_mismatch" }, 400);
    }

    // Persist the user message first
    await this.env.DB.prepare(
      `INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'user', ?)`,
    )
      .bind(newId(), chatId, userMessage)
      .run();

    // Refresh .ceo/ cache if stale
    const ceoFiles = await this.getCeoFilesCached(ctx);

    // Load full history (newest user message is now in there)
    const historyRows = await this.env.DB.prepare(
      "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY created_at ASC, id ASC",
    )
      .bind(chatId)
      .all<{ role: string; content: string }>();
    const history: ChatMessage[] = (historyRows.results ?? [])
      .filter((r) => r.role === "user" || r.role === "assistant")
      .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));

    // Build system prompt
    const project = await this.env.DB.prepare(
      "SELECT clone_url FROM projects WHERE id = ?",
    )
      .bind(ctx.id)
      .first<{ clone_url: string }>();
    const cloneUrl = project?.clone_url ?? "";

    const system = buildManagerSystemPrompt({
      projectId: ctx.id,
      repoFullName: ctx.repoFullName,
      cloneUrl,
      ceoFiles,
    });

    // Stream the turn. We need to persist the raw assistant text after the
    // stream completes — wrap the generator so we can capture it.
    const env = this.env;
    const db = this.env.DB;

    async function* wrappedGen(): AsyncGenerator<
      { event: string; data: unknown },
      void,
      unknown
    > {
      const inner = streamChatTurn({ env, system, history });
      let raw = "";
      let result: IteratorResult<{ event: string; data: unknown }, unknown>;
      while (!(result = await inner.next()).done) {
        const ev = result.value;
        // Capture text deltas for persistence (raw text). We persist the raw
        // text including action fences so re-parse on history reload yields
        // the same events.
        if (ev.event === "text") {
          const data = ev.data as { delta: string };
          raw += data.delta;
        } else if (ev.event === "action") {
          const data = ev.data as { raw?: string };
          if (data.raw) raw += "\n" + data.raw + "\n";
        }
        yield ev;
      }
      // result.value here is the ChatTurnRecord from the inner generator
      const record = result.value as { rawAssistantText: string } | undefined;
      const finalRaw = record?.rawAssistantText ?? raw;
      // Persist only if we got real output (avoid persisting empty on errors).
      if (finalRaw) {
        await db
          .prepare(
            "INSERT INTO messages (id, chat_id, role, content) VALUES (?, ?, 'assistant', ?)",
          )
          .bind(newId(), chatId, finalRaw)
          .run();
      }
    }

    return sseResponse(wrappedGen());
  }

  private async getCeoFilesCached(ctx: ProjectContext): Promise<CeoFiles> {
    const cached = await this.state.storage.get<CeoCache>("ceoCache");
    if (cached && Date.now() - cached.fetchedAt < CEO_CACHE_TTL_MS) {
      return cached.files;
    }
    const files = await readCeoFiles(this.env, ctx.repoFullName, ctx.defaultBranch);
    await this.state.storage.put("ceoCache", { files, fetchedAt: Date.now() });
    return files;
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Suppress unused-warning for the imported type that's used in JSDoc/comments only
export type _MessageRow = MessageRow;
