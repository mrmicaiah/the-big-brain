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

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamClaudeOpts {
  env: Env;
  system: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

/**
 * Stream a Claude completion. Yields only the text deltas; other event types
 * (`message_start`, `content_block_start`, etc.) are dropped because Phase 3
 * doesn't use tools. Tool-use events would surface here later.
 */
export async function* streamClaude(
  opts: StreamClaudeOpts,
): AsyncGenerator<string, void, unknown> {
  const client = claudeClient(opts.env);
  const stream = await client.messages.create({
    model: MODEL_ID,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages: opts.messages,
    stream: true,
  });
  for await (const event of stream) {
    if (
      event.type === "content_block_delta" &&
      event.delta.type === "text_delta"
    ) {
      yield event.delta.text;
    }
  }
}
