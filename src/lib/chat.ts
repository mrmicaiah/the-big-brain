import type Anthropic from "@anthropic-ai/sdk";
import type { Env } from "../types";
import { streamClaude } from "./claude";
import { ActionParser, KNOWN_ACTIONS } from "./actionParser";
import type { SseEvent } from "./sse";

/** Maximum tool round-trips per user turn before we force a wrap-up. */
const MAX_TOOL_ROUNDS = 5;

/** Synthetic message appended to the system prompt when we force the wrap-up
 *  call after hitting MAX_TOOL_ROUNDS. */
const WRAP_UP_INSTRUCTION =
  "Tool round limit reached. Respond with what you have. " +
  "Do not call any more tools — summarize and conclude.";

/** Result returned by a tool's executeTool callback. `content` flows to
 *  Anthropic as the tool_result content; `summary` flows to the frontend as
 *  the inline status line. */
export interface ToolExecutionResult {
  content: string;
  is_error?: boolean;
  summary: string;
}

export type ExecuteToolFn = (
  name: string,
  input: Record<string, unknown>,
) => Promise<ToolExecutionResult>;

export interface ChatTurnOpts {
  env: Env;
  system: string;
  history: Anthropic.MessageParam[];
  tools?: Anthropic.Tool[];
  executeTool?: ExecuteToolFn;
}

export interface ChatTurnRecord {
  /** Concatenated text the model emitted across all rounds (excluding raw
   *  action fences — those go through ActionParser and emit `event: action`
   *  separately). Used by the caller for D1 persistence. */
  rawAssistantText: string;
}

/**
 * Streamed chat turn supporting Anthropic-native tool use.
 *
 * Loop: open a stream → consume text + tool_use events → if stop_reason is
 * tool_use, execute the tools, append assistant + tool_result messages,
 * loop again. Cap at MAX_TOOL_ROUNDS rounds; on cap, fire one final
 * non-tool wrap-up call so the model concludes in prose rather than
 * cutting off mid-loop.
 *
 * The ActionParser runs across all rounds (fenced action blocks like
 * `dispatch_claude_code` are orthogonal to tool use). Text events are
 * post-action-parser; action events fire when a fenced block closes.
 */
export async function* streamChatTurn(
  opts: ChatTurnOpts,
): AsyncGenerator<SseEvent, ChatTurnRecord, unknown> {
  const parser = new ActionParser(KNOWN_ACTIONS);
  const messages: Anthropic.MessageParam[] = [...opts.history];
  let totalRaw = "";

  // Helper to drain parser events to SSE
  function* drainParser(events: ReturnType<typeof parser.feed>): Generator<SseEvent> {
    for (const ev of events) {
      if (ev.kind === "text") yield { event: "text", data: { delta: ev.text } };
      else yield { event: "action", data: ev.action };
    }
  }

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      let textInRound = "";
      const toolUses: { id: string; name: string; inputJson: string }[] = [];
      let stopReason: string | null = null;

      for await (const ev of streamClaude({
        env: opts.env,
        system: opts.system,
        messages,
        tools: opts.tools,
      })) {
        if (ev.type === "text_delta") {
          textInRound += ev.text;
          yield* drainParser(parser.feed(ev.text));
        } else if (ev.type === "tool_use_start") {
          toolUses.push({ id: ev.id, name: ev.name, inputJson: "" });
        } else if (ev.type === "tool_use_input_delta") {
          const last = toolUses[toolUses.length - 1];
          if (last) last.inputJson += ev.partial;
        } else if (ev.type === "stop") {
          stopReason = ev.reason;
        }
        // tool_use_stop is informational; we don't need it here
      }
      // Flush parser at end of round (text portion of this round is complete)
      yield* drainParser(parser.finish());
      totalRaw += textInRound;

      // Done conditions: model finished (end_turn / max_tokens / stop_sequence)
      // OR no tools to call OR no executeTool callback wired
      if (
        stopReason !== "tool_use" ||
        toolUses.length === 0 ||
        !opts.executeTool
      ) {
        yield { event: "done", data: {} };
        return { rawAssistantText: totalRaw };
      }

      // Append the assistant message (text + tool_use blocks) to history
      const assistantContent: Array<
        Anthropic.TextBlockParam | Anthropic.ToolUseBlockParam
      > = [];
      if (textInRound) {
        assistantContent.push({ type: "text", text: textInRound });
      }
      for (const tu of toolUses) {
        let input: Record<string, unknown>;
        try {
          input = tu.inputJson ? JSON.parse(tu.inputJson) : {};
        } catch {
          input = {};
        }
        assistantContent.push({
          type: "tool_use",
          id: tu.id,
          name: tu.name,
          input,
        });
      }
      messages.push({ role: "assistant", content: assistantContent });

      // Execute each tool, emit SSE events, collect tool_results
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        let input: Record<string, unknown>;
        try {
          input = tu.inputJson ? JSON.parse(tu.inputJson) : {};
        } catch {
          input = {};
        }
        let result: ToolExecutionResult;
        try {
          result = await opts.executeTool(tu.name, input);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          result = {
            content: `Tool execution threw: ${msg}`,
            is_error: true,
            summary: `${tu.name} — execution error`,
          };
        }
        yield {
          event: "tool",
          data: {
            id: tu.id,
            name: tu.name,
            input,
            ok: !result.is_error,
            summary: result.summary,
          },
        };
        toolResults.push({
          type: "tool_result",
          tool_use_id: tu.id,
          content: result.content,
          is_error: result.is_error ?? false,
        });
      }
      messages.push({ role: "user", content: toolResults });
    }

    // Hit MAX_TOOL_ROUNDS without natural end. Fire one final non-tool call
    // so the model wraps up gracefully rather than cutting off.
    const wrapUpSystem = `${opts.system}\n\n${WRAP_UP_INSTRUCTION}`;
    for await (const ev of streamClaude({
      env: opts.env,
      system: wrapUpSystem,
      messages,
      // tools omitted intentionally
    })) {
      if (ev.type === "text_delta") {
        totalRaw += ev.text;
        yield* drainParser(parser.feed(ev.text));
      }
      // We ignore any stop_reason / tool events here — the model can't call
      // tools without them being passed, and we're finalizing.
    }
    yield* drainParser(parser.finish());
    yield { event: "done", data: {} };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield { event: "error", data: { message } };
  }
  return { rawAssistantText: totalRaw };
}
