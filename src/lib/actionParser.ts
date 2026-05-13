/**
 * Streaming action parser.
 *
 * Detects fenced action blocks like
 *
 *   ```dispatch_claude_code
 *   project: ...
 *   summary: ...
 *   prompt: |
 *     multi-line content
 *   ```
 *
 * in a streamed text feed and emits them as structured `action` events instead
 * of letting the raw fence markup leak through as text. Unknown fence keywords
 * (e.g., a regular ```typescript code block) pass through as plain text.
 *
 * State machine: TEXT (accumulating prose, watching for fence-open) ↔ ACTION
 * (buffering body, watching for fence-close).
 *
 * Edge cases handled:
 *   - fence split across deltas: lookback buffer holds back the trailing
 *     `LOOKBACK_BUFFER_CHARS` chars when they contain a backtick
 *   - unknown fence keyword: emitted as plain text (no action)
 *   - empty action body: emits action event with empty fields
 *   - two actions in one message: both emitted in order
 *   - fence open but stream ends before close: opener + body re-emitted as
 *     text fallback in finish()
 */

/** How many trailing characters of the streaming buffer to hold back when a
 * backtick is present in the tail. Tuned to cover any plausible fence-open
 * sequence ("\n```<keyword>\n"). Easy to tune, easy to find. */
export const LOOKBACK_BUFFER_CHARS = 80;

export type ParsedAction = {
  type: string;
  fields: Record<string, string>;
  raw: string;
};

export type ParserEvent =
  | { kind: "text"; text: string }
  | { kind: "action"; action: ParsedAction };

// Anchor at start-of-buffer OR newline. The original `\n` requirement missed
// fences when the model emits them at position 0 of the assistant message —
// no leading prose, no preceding newline — and the entire fence streamed
// through as raw text deltas (the bug found in production deploy verification).
// See docs/phase-4-plan.md §"Shared parser contract" — the frontend's
// splitMessageIntoParts already handles this by prepending "\n" to the
// content; this fixes the streaming parser to match the contract directly.
const FENCE_OPEN_RE = /(?:^|\n)```([a-z_][a-z0-9_]*)\n/;
const FENCE_CLOSE_RE = /(?:^|\n)```(?:\n|$)/;

export class ActionParser {
  private buffer = "";
  private mode: "text" | "action" = "text";
  private currentKeyword = "";
  private currentBody = "";

  constructor(private readonly knownActions: ReadonlySet<string>) {}

  /** Feed a text delta from the model; returns events to emit downstream. */
  feed(delta: string): ParserEvent[] {
    this.buffer += delta;
    return this.drain(false);
  }

  /** Called when the model's stream is complete. Flushes anything remaining. */
  finish(): ParserEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): ParserEvent[] {
    const events: ParserEvent[] = [];

    // Loop because one delta can contain multiple state transitions
    // (e.g., text → action close → text → another action open).
    while (true) {
      if (this.mode === "text") {
        const openMatch = this.buffer.match(FENCE_OPEN_RE);
        if (openMatch && openMatch.index !== undefined) {
          const keyword = openMatch[1]!;
          if (this.knownActions.has(keyword)) {
            // Emit text before the fence
            const before = this.buffer.slice(0, openMatch.index);
            if (before) events.push({ kind: "text", text: before });
            // Advance buffer past the opening "\n```keyword\n"
            this.buffer = this.buffer.slice(openMatch.index + openMatch[0].length);
            this.mode = "action";
            this.currentKeyword = keyword;
            this.currentBody = "";
            continue;
          } else {
            // Unknown keyword — treat as ordinary markdown. Emit through the
            // end of the opening line; advance past the opening "\n" only so
            // we don't re-match the same fence next iteration.
            const advanceTo = openMatch.index + openMatch[0].length;
            events.push({ kind: "text", text: this.buffer.slice(0, advanceTo) });
            this.buffer = this.buffer.slice(advanceTo);
            continue;
          }
        }
        // No fence open found. Emit as much text as safely possible.
        const safe = this.safeEmitLength();
        if (safe > 0) {
          events.push({ kind: "text", text: this.buffer.slice(0, safe) });
          this.buffer = this.buffer.slice(safe);
        }
        if (final && this.buffer) {
          events.push({ kind: "text", text: this.buffer });
          this.buffer = "";
        }
        break;
      } else {
        // mode === "action"
        const closeMatch = this.buffer.match(FENCE_CLOSE_RE);
        if (closeMatch && closeMatch.index !== undefined) {
          this.currentBody += this.buffer.slice(0, closeMatch.index);
          const raw = "```" + this.currentKeyword + "\n" + this.currentBody + "\n```";
          events.push({
            kind: "action",
            action: {
              type: this.currentKeyword,
              fields: parseActionBody(this.currentBody),
              raw,
            },
          });
          this.buffer = this.buffer.slice(closeMatch.index + closeMatch[0].length);
          this.mode = "text";
          this.currentKeyword = "";
          this.currentBody = "";
          continue;
        }
        if (final) {
          // Stream ended mid-action. Don't drop content — re-emit the opener
          // plus the partial body as text so the user can see what was lost.
          events.push({
            kind: "text",
            text:
              "\n```" + this.currentKeyword + "\n" + this.currentBody + this.buffer,
          });
          this.buffer = "";
          this.currentKeyword = "";
          this.currentBody = "";
          this.mode = "text";
        }
        break;
      }
    }

    return events;
  }

  /**
   * How much of the current buffer is safe to emit as text without risking
   * splitting a fence-open across two emissions. Three cases:
   *
   *   A. Buffer might be growing into a fence-open at position 0 of the
   *      buffer (e.g., "```", "```dispatch_claude") — hold the whole buffer
   *      until either the fence-open regex matches in drain() or enough
   *      non-fence chars accumulate to rule it out.
   *
   *   B. Buffer has a backtick preceded by `\n` somewhere in the lookback
   *      window — potential fence-open after newline. Hold from that `\n`
   *      onward; emit everything before.
   *
   *   C. Backtick mid-prose with no preceding `\n` and not at position 0
   *      (e.g., the `route` function — inline code) — safe to emit.
   */
  private safeEmitLength(): number {
    if (this.buffer.length === 0) return 0;

    const tail = this.buffer.slice(-LOOKBACK_BUFFER_CHARS);
    if (!tail.includes("`")) return this.buffer.length;

    // Case A: the whole buffer could still grow into a fence-open at start.
    if (isStartingFenceOpen(this.buffer)) return 0;

    // Case B: find the earliest backtick in the lookback window. Hold from
    // the preceding `\n` (if any).
    const tailStartInBuffer = Math.max(0, this.buffer.length - LOOKBACK_BUFFER_CHARS);
    const firstBacktickInTail = tail.indexOf("`");
    const backtickPosInBuffer = tailStartInBuffer + firstBacktickInTail;

    let nlPos = -1;
    for (let i = backtickPosInBuffer - 1; i >= 0; i--) {
      if (this.buffer[i] === "\n") {
        nlPos = i;
        break;
      }
    }
    if (nlPos !== -1) return nlPos;

    // Case C: inline backtick — safe to emit.
    return this.buffer.length;
  }
}

/**
 * True iff `buf` is a strict prefix of `\`\`\`<keyword>` — i.e., the whole
 * buffer could grow into a fence-open with additional incoming chars.
 *
 * Matches: `"`"`, `"``"`, `"```"`, `"```d"`, `"```dispatch_claude_code"`.
 * Does not match: `"`x"` (inline backtick + letter — can't grow into ```),
 * `"```dispatch_claude_code\n"` (already a complete fence-open; drain()
 * handles that branch).
 *
 * Exported for unit tests; not used outside this module.
 */
export function isStartingFenceOpen(buf: string): boolean {
  return /^`{1,3}$/.test(buf) || /^```[a-z_][a-z0-9_]*$/.test(buf);
}

/**
 * Minimal YAML-subset parser for action bodies. Handles:
 *   - `key: value` → string field
 *   - `key: |` followed by 2-space-indented lines → multi-line string
 *     (indent stripped, joined with newlines)
 *
 * Anything else is ignored. This is deliberately tiny — we don't want a YAML
 * dependency for this.
 */
function parseActionBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const m = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1]!;
    const value = m[2]!;
    if (value === "|") {
      const block: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (/^[a-z_][a-z0-9_]*:/.test(next)) break;
        block.push(next.replace(/^ {2}/, ""));
        i++;
      }
      // Trim a single trailing empty line if present (common with YAML blocks)
      while (block.length > 0 && block[block.length - 1] === "") block.pop();
      out[key] = block.join("\n");
    } else {
      out[key] = value;
      i++;
    }
  }
  return out;
}

/** Re-exported from shared/knownActions.ts so existing callers (chat.ts, etc.)
 *  don't need to change their import path. The single source of truth lives
 *  in the shared module — both Worker and frontend import from there. */
export { KNOWN_ACTIONS } from "../../shared/knownActions";
