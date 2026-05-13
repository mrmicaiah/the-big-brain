// Main WebSocket lifecycle: connect, send `ready`, listen for jobs, heartbeat,
// reconnect on close. One agent process, one persistent connection.
//
// Reconnect policy: 3-second delay between attempts. The Worker's AgentHub
// will close any prior socket when this one connects, so we don't have to
// negotiate session takeover.

import WebSocket from "ws";
import type { AgentConfig } from "./config.js";
import { runJob } from "./executor.js";
import { log } from "./log.js";

const AGENT_VERSION = "0.1.0";
const RECONNECT_DELAY_MS = 3_000;
const HEARTBEAT_MS = 30_000;

interface JobMessage {
  type: "job";
  jobId: string;
  repoName: string;
  cloneUrl: string | null;
  prompt: string;
  projectId: string;
  chatId: string;
}

interface PingMessage {
  type: "ping";
}

type WorkerMessage = JobMessage | PingMessage | { type: string };

export async function startAgent(): Promise<void> {
  const config = await loadConfigOrExit();
  log.info(`agent ${AGENT_VERSION} starting`);
  log.info(`worker: ${config.workerUrl}`);
  log.info(`repos:  ${config.reposDir}`);

  // Reconnect loop. Each iteration is one full lifetime of a connection.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await connectAndServe(config);
    } catch (err) {
      log.error("connection error:", (err as Error).message);
    }
    log.info(`reconnecting in ${RECONNECT_DELAY_MS / 1000}s…`);
    await sleep(RECONNECT_DELAY_MS);
  }
}

async function loadConfigOrExit(): Promise<AgentConfig> {
  try {
    const { loadConfig } = await import("./config.js");
    return loadConfig();
  } catch (err) {
    log.error("config error:", (err as Error).message);
    process.exit(1);
  }
}

function connectAndServe(config: AgentConfig): Promise<void> {
  return new Promise((resolve) => {
    log.info("connecting…");
    const ws = new WebSocket(config.workerUrl, {
      headers: {
        Authorization: `Bearer ${config.agentToken}`,
      },
    });

    let heartbeat: NodeJS.Timeout | null = null;
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      resolve();
    };

    ws.on("open", () => {
      log.info("connected");
      try {
        ws.send(JSON.stringify({ type: "ready", agentVersion: AGENT_VERSION }));
      } catch (err) {
        log.warn("failed to send ready:", (err as Error).message);
      }
      heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "heartbeat" }));
          } catch (err) {
            log.warn("heartbeat send failed:", (err as Error).message);
          }
        }
      }, HEARTBEAT_MS);
    });

    ws.on("message", (data) => {
      let msg: WorkerMessage;
      try {
        msg = JSON.parse(data.toString()) as WorkerMessage;
      } catch {
        return;
      }
      if (msg.type === "job") {
        const job = msg as JobMessage;
        // Run async; don't await — multiple jobs could theoretically pipeline,
        // though for v0 the Worker enforces one-per-project at the queue level.
        void runJob(job, ws, config).catch((err) => {
          log.error(`job ${job.jobId} unhandled:`, err);
        });
      }
      // pings are silently ignored.
    });

    ws.on("close", (code, reason) => {
      log.info(`disconnected (code ${code}${reason?.length ? `: ${reason.toString()}` : ""})`);
      settle();
    });

    ws.on("error", (err) => {
      log.error("ws error:", (err as Error).message);
      // Always settle on error so the reconnect loop runs.
      settle();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
