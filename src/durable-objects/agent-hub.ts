import type { Env } from "../types";
import { newId as _newId } from "../lib/ids";

// Suppress unused-warning in case future code uses it
const _unused = _newId;
void _unused;

/**
 * AgentHubDO — singleton. Holds the single WebSocket to the local agent,
 * dispatches jobs to it, broadcasts agent output frames to SSE subscribers,
 * and writes terminal state to D1.
 *
 * Routes (internal to the DO):
 *   GET  /connect            → agent WebSocket upgrade (Worker checks Bearer first)
 *   POST /dispatch           → Worker hands off a fresh job
 *   GET  /subscribe?jobId=…  → frontend SSE stream for one job
 *
 * In-memory state is rebuilt on DO restart from D1 — only live output frames
 * between agent send and terminal are lost. Acceptable v0.
 */

interface AgentJobMessage {
  type: "job";
  jobId: string;
  repoName: string;
  cloneUrl: string;
  prompt: string;
  projectId: string;
  chatId: string;
}

interface AgentOutboundOutput {
  type: "output";
  jobId: string;
  kind: "text" | "tool_use" | "tool_result";
  payload: string;
}

interface AgentOutboundCompleted {
  type: "completed";
  jobId: string;
  diffStat: string;
  diff: string;
  diffTruncated: boolean;
  summary: string;
}

interface AgentOutboundFailed {
  type: "failed";
  jobId: string;
  error: string;
  stage: "workspace" | "execution" | "diff";
}

interface AgentOutboundReady {
  type: "ready";
  agentVersion?: string;
}

interface AgentOutboundHeartbeat {
  type: "heartbeat";
}

type AgentMessage =
  | AgentOutboundReady
  | AgentOutboundHeartbeat
  | AgentOutboundOutput
  | AgentOutboundCompleted
  | AgentOutboundFailed;

interface ProjectMeta {
  id: string;
  repo_full_name: string;
  clone_url: string;
}

interface JobRow {
  id: string;
  project_id: string;
  chat_id: string;
  prompt: string;
  summary: string;
  status: "queued" | "running" | "succeeded" | "failed";
  output_stream: string | null;
  diff_summary: string | null;
  created_at: string;
  completed_at: string | null;
  message_id: string | null;
  fence_index: number | null;
}

interface SubscriberEntry {
  controller: ReadableStreamDefaultController<Uint8Array>;
  encoder: TextEncoder;
}

export class AgentHubDO {
  private agentSocket: WebSocket | null = null;
  /** Accumulated output frames per running job; persisted to D1 on terminal. */
  private outputBuffers: Map<string, string[]> = new Map();
  /** Live SSE subscribers per job. */
  private subscribers: Map<string, Set<SubscriberEntry>> = new Map();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/connect") return this.handleConnect(request);
    if (path === "/dispatch") return this.handleDispatch(request);
    if (path === "/subscribe") return this.handleSubscribe(request);

    return new Response("not found", { status: 404 });
  }

  // ── WebSocket lifecycle ────────────────────────────────────────────────

  private handleConnect(request: Request): Response {
    const upgrade = request.headers.get("upgrade");
    if (upgrade?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    // Close prior socket if any — single-agent-at-a-time.
    if (this.agentSocket) {
      try {
        this.agentSocket.close(1000, "new agent connected");
      } catch {
        /* ignore */
      }
      this.agentSocket = null;
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.agentSocket = server;

    server.addEventListener("message", (ev: MessageEvent) => {
      const raw = typeof ev.data === "string" ? ev.data : "";
      if (!raw) return;
      let msg: AgentMessage;
      try {
        msg = JSON.parse(raw) as AgentMessage;
      } catch {
        return;
      }
      // Fire-and-forget — DO methods can be async, but message handlers can't await
      void this.handleAgentMessage(msg);
    });

    server.addEventListener("close", () => {
      if (this.agentSocket === server) this.agentSocket = null;
    });
    server.addEventListener("error", () => {
      if (this.agentSocket === server) this.agentSocket = null;
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  private async handleAgentMessage(msg: AgentMessage): Promise<void> {
    switch (msg.type) {
      case "ready":
        await this.flushQueuedJobs();
        return;
      case "heartbeat":
        return; // no-op; could record last_seen if we ever care
      case "output":
        this.handleAgentOutput(msg);
        return;
      case "completed":
        await this.handleAgentTerminal(msg.jobId, "succeeded", {
          summary: msg.summary,
          diffStat: msg.diffStat,
          diff: msg.diff,
          diffTruncated: msg.diffTruncated,
        });
        return;
      case "failed":
        await this.handleAgentTerminal(msg.jobId, "failed", {
          error: msg.error,
          stage: msg.stage,
        });
        return;
    }
  }

  private handleAgentOutput(msg: AgentOutboundOutput): void {
    const frame = `${msg.kind}: ${msg.payload}\n`;
    const buf = this.outputBuffers.get(msg.jobId) ?? [];
    buf.push(frame);
    this.outputBuffers.set(msg.jobId, buf);
    this.broadcast(msg.jobId, "output", { kind: msg.kind, payload: msg.payload });
  }

  private async handleAgentTerminal(
    jobId: string,
    status: "succeeded" | "failed",
    diff: Record<string, unknown>,
  ): Promise<void> {
    const buf = this.outputBuffers.get(jobId) ?? [];
    const outputStream = buf.join("");
    const diffSummary = JSON.stringify(diff);

    await this.env.DB.prepare(
      `UPDATE execution_jobs SET status = ?, output_stream = ?, diff_summary = ?, completed_at = datetime('now') WHERE id = ?`,
    )
      .bind(status, outputStream, diffSummary, jobId)
      .run();

    this.broadcast(jobId, "terminal", { status, ...diff });
    this.closeSubscribers(jobId);
    this.outputBuffers.delete(jobId);

    // Dispatch the next queued job if any (per-project serialization).
    await this.dispatchNextQueued();
  }

  // ── Dispatch ───────────────────────────────────────────────────────────

  private async handleDispatch(request: Request): Promise<Response> {
    let body: {
      jobId?: string;
      projectId?: string;
      chatId?: string;
      repoName?: string;
      cloneUrl?: string;
      prompt?: string;
    };
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: "invalid_json" }, 400);
    }
    if (
      !body.jobId ||
      !body.projectId ||
      !body.chatId ||
      !body.repoName ||
      !body.cloneUrl ||
      !body.prompt
    ) {
      return jsonResponse({ error: "invalid_dispatch_body" }, 400);
    }

    // Per-project serialization: hold back if another job for this project
    // is queued/running. We don't send to the agent until the prior one lands.
    const otherInFlight = await this.env.DB.prepare(
      `SELECT 1 FROM execution_jobs WHERE project_id = ? AND status IN ('queued', 'running') AND id != ? LIMIT 1`,
    )
      .bind(body.projectId, body.jobId)
      .first();

    if (otherInFlight || !this.agentSocket) {
      // Job already exists in D1 as 'queued' (the Worker route inserted it
      // before dispatch). Leave it; the next dispatch-cycle picks it up.
      return jsonResponse({ ok: true, dispatched: false });
    }

    const sent = this.sendJobToAgent({
      jobId: body.jobId,
      repoName: body.repoName,
      cloneUrl: body.cloneUrl,
      prompt: body.prompt,
      projectId: body.projectId,
      chatId: body.chatId,
    });

    if (sent) {
      await this.env.DB.prepare(
        `UPDATE execution_jobs SET status = 'running' WHERE id = ?`,
      )
        .bind(body.jobId)
        .run();
    }
    return jsonResponse({ ok: true, dispatched: sent });
  }

  private sendJobToAgent(job: Omit<AgentJobMessage, "type">): boolean {
    if (!this.agentSocket) return false;
    try {
      this.agentSocket.send(JSON.stringify({ type: "job", ...job }));
      return true;
    } catch {
      return false;
    }
  }

  /** Flush all 'queued' jobs when an agent (re)connects. */
  private async flushQueuedJobs(): Promise<void> {
    const rows = await this.env.DB.prepare(
      `SELECT id, project_id, chat_id, prompt FROM execution_jobs WHERE status = 'queued' ORDER BY created_at ASC`,
    ).all<{ id: string; project_id: string; chat_id: string; prompt: string }>();

    for (const job of rows.results ?? []) {
      // Don't dispatch if another job for the same project is already running
      const running = await this.env.DB.prepare(
        `SELECT 1 FROM execution_jobs WHERE project_id = ? AND status = 'running' LIMIT 1`,
      )
        .bind(job.project_id)
        .first();
      if (running) continue;

      const project = await this.env.DB.prepare(
        `SELECT id, repo_full_name, clone_url FROM projects WHERE id = ?`,
      )
        .bind(job.project_id)
        .first<ProjectMeta>();
      if (!project) continue;

      const repoName = repoNameFromFullName(project.repo_full_name);
      const sent = this.sendJobToAgent({
        jobId: job.id,
        repoName,
        cloneUrl: project.clone_url,
        prompt: job.prompt,
        projectId: job.project_id,
        chatId: job.chat_id,
      });
      if (sent) {
        await this.env.DB.prepare(
          `UPDATE execution_jobs SET status = 'running' WHERE id = ?`,
        )
          .bind(job.id)
          .run();
        // Only one at a time globally (we re-enter via terminal handler)
        return;
      }
    }
  }

  /** After a terminal, see if there's another queued job whose project is now idle. */
  private async dispatchNextQueued(): Promise<void> {
    if (!this.agentSocket) return;
    const queued = await this.env.DB.prepare(
      `SELECT id, project_id, chat_id, prompt FROM execution_jobs WHERE status = 'queued' ORDER BY created_at ASC`,
    ).all<{ id: string; project_id: string; chat_id: string; prompt: string }>();

    for (const job of queued.results ?? []) {
      const running = await this.env.DB.prepare(
        `SELECT 1 FROM execution_jobs WHERE project_id = ? AND status = 'running' LIMIT 1`,
      )
        .bind(job.project_id)
        .first();
      if (running) continue;

      const project = await this.env.DB.prepare(
        `SELECT id, repo_full_name, clone_url FROM projects WHERE id = ?`,
      )
        .bind(job.project_id)
        .first<ProjectMeta>();
      if (!project) continue;

      const repoName = repoNameFromFullName(project.repo_full_name);
      const sent = this.sendJobToAgent({
        jobId: job.id,
        repoName,
        cloneUrl: project.clone_url,
        prompt: job.prompt,
        projectId: job.project_id,
        chatId: job.chat_id,
      });
      if (sent) {
        await this.env.DB.prepare(
          `UPDATE execution_jobs SET status = 'running' WHERE id = ?`,
        )
          .bind(job.id)
          .run();
        return;
      }
    }
  }

  // ── SSE subscribe ──────────────────────────────────────────────────────

  private async handleSubscribe(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const jobId = url.searchParams.get("jobId");
    if (!jobId) return new Response("missing jobId", { status: 400 });

    const job = await this.env.DB.prepare(
      `SELECT * FROM execution_jobs WHERE id = ?`,
    )
      .bind(jobId)
      .first<JobRow>();
    if (!job) return new Response("not found", { status: 404 });

    const encoder = new TextEncoder();
    const subs = this.subscribers;
    let entry: SubscriberEntry | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        entry = { controller, encoder };
        // Send snapshot
        controller.enqueue(
          encoder.encode(`event: snapshot\ndata: ${JSON.stringify(job)}\n\n`),
        );

        // If terminal, send terminal frame and close.
        if (job.status === "succeeded" || job.status === "failed") {
          const diff = job.diff_summary ? safeJsonParse(job.diff_summary) : {};
          controller.enqueue(
            encoder.encode(
              `event: terminal\ndata: ${JSON.stringify({ status: job.status, ...diff })}\n\n`,
            ),
          );
          controller.close();
          return;
        }

        // Live job — register for broadcasts.
        let set = subs.get(jobId);
        if (!set) {
          set = new Set<SubscriberEntry>();
          subs.set(jobId, set);
        }
        set.add(entry);
      },
      cancel: () => {
        if (!entry) return;
        const set = subs.get(jobId);
        if (set) {
          set.delete(entry);
          if (set.size === 0) subs.delete(jobId);
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

  private broadcast(jobId: string, eventName: string, data: unknown): void {
    const set = this.subscribers.get(jobId);
    if (!set) return;
    const frame = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const sub of set) {
      try {
        sub.controller.enqueue(sub.encoder.encode(frame));
      } catch {
        // controller closed; will be removed when its stream cancels
      }
    }
  }

  private closeSubscribers(jobId: string): void {
    const set = this.subscribers.get(jobId);
    if (!set) return;
    for (const sub of set) {
      try {
        sub.controller.close();
      } catch {
        /* ignore */
      }
    }
    this.subscribers.delete(jobId);
  }
}

function repoNameFromFullName(fullName: string): string {
  const i = fullName.indexOf("/");
  return i < 0 ? fullName : fullName.slice(i + 1);
}

function safeJsonParse(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s);
    return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
