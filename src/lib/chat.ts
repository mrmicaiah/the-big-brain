import type { Env } from "../types";
import { streamClaude, type ChatMessage } from "./claude";
import { ActionParser, KNOWN_ACTIONS } from "./actionParser";
import type { SseEvent } from "./sse";

export interface ChatTurnOpts {
  env: Env;
  system: string;
  history: ChatMessage[];
}

export interface ChatTurnRecord {
  /** Full assistant text including raw action fences, for persistence. */
  rawAssistantText: string;
}

/**
 * Streamed chat turn. Yields SSE events in protocol order:
 *   event: text  → as deltas arrive from Claude, run through the action parser
 *   event: action → emitted when a complete known fence block is detected
 *   event: done   → at clean stream completion
 *   event: error  → on any exception (the sseResponse layer will then close)
 *
 * Returns the raw assistant text so the caller can persist it.
 */
export async function* streamChatTurn(
  opts: ChatTurnOpts,
): AsyncGenerator<SseEvent, ChatTurnRecord, unknown> {
  const parser = new ActionParser(KNOWN_ACTIONS);
  let raw = "";
  try {
    for await (const delta of streamClaude({
      env: opts.env,
      system: opts.system,
      messages: opts.history,
    })) {
      raw += delta;
      for (const ev of parser.feed(delta)) {
        if (ev.kind === "text") {
          yield { event: "text", data: { delta: ev.text } };
        } else {
          yield { event: "action", data: ev.action };
        }
      }
    }
    for (const ev of parser.finish()) {
      if (ev.kind === "text") {
        yield { event: "text", data: { delta: ev.text } };
      } else {
        yield { event: "action", data: ev.action };
      }
    }
    yield { event: "done", data: {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { event: "error", data: { message } };
  }
  return { rawAssistantText: raw };
}
