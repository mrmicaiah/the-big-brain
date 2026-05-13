import Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";

/**
 * All Claude calls in The Big Brain use this model. Pinned as a single
 * exported constant so a future change is one line.
 */
export const MODEL_ID = "claude-opus-4-5";

export function claudeClient(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

/** Structured events the streaming generator yields. chat.ts is the only
 *  caller; it maps these into SSE events for the wire. */
export type ClaudeStreamEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_use_start"; id: string; name: string }
  | { type: "tool_use_input_delta"; partial: string }
  | { type: "tool_use_stop" }
  | { type: "stop"; reason: string | null };

export interface StreamClaudeOpts {
  env: Env;
  system: string;
  messages: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  maxTokens?: number;
}

/**
 * Stream a Claude completion. Yields structured events covering text deltas,
 * tool-use block boundaries + input deltas, and the final stop_reason.
 *
 * Caller (chat.ts) reconstructs the assistant message from the tool_use
 * events and decides whether to loop (tool_use stop) or finalize (end_turn).
 */
export async function* streamClaude(
  opts: StreamClaudeOpts,
): AsyncGenerator<ClaudeStreamEvent, void, unknown> {
  const client = claudeClient(opts.env);
  const stream = await client.messages.create({
    model: MODEL_ID,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: opts.messages,
    ...(opts.tools && opts.tools.length > 0 ? { tools: opts.tools } : {}),
    stream: true,
  });

  // Track which kind of block is currently open so we know whether
  // content_block_stop should yield tool_use_stop.
  let currentBlock: "text" | "tool_use" | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        currentBlock = "tool_use";
        yield {
          type: "tool_use_start",
          id: event.content_block.id,
          name: event.content_block.name,
        };
      } else {
        currentBlock = "text";
      }
    } else if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        yield { type: "text_delta", text: event.delta.text };
      } else if (event.delta.type === "input_json_delta") {
        yield { type: "tool_use_input_delta", partial: event.delta.partial_json };
      }
    } else if (event.type === "content_block_stop") {
      if (currentBlock === "tool_use") yield { type: "tool_use_stop" };
      currentBlock = null;
    } else if (event.type === "message_delta") {
      yield { type: "stop", reason: event.delta.stop_reason ?? null };
    }
  }
}
