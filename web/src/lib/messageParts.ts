import { KNOWN_ACTIONS } from "../../../shared/knownActions";

/**
 * Split a persisted assistant message into ordered parts: text + action fences.
 *
 * Contract (per docs/phase-4-plan.md §"Shared parser contract"):
 *   1. KNOWN_ACTIONS imported from shared/knownActions.ts — single source of
 *      truth, shared with the Worker's streaming ActionParser.
 *   2. Unknown fence keywords pass through as text. Only fences whose keyword
 *      is in KNOWN_ACTIONS become structured action parts.
 *   3. Idempotent on already-parsed text — running this on the raw assistant
 *      content recovers the same actions the streaming parser emitted live.
 *
 * Action body fields are parsed with the same YAML-light approach as the
 * Worker parser (`key: value` and `key: |` multi-line). Keep both in sync.
 */

export type MessagePart =
  | { kind: "text"; text: string }
  | {
      kind: "action";
      actionType: string;
      fields: Record<string, string>;
      raw: string;
      fenceIndex: number;
    };

const FENCE_RE = /\n```([a-z_][a-z0-9_]*)\n([\s\S]*?)\n```(?=\n|$)/g;

export function splitMessageIntoParts(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  let fenceIndex = 0;

  // Prepend a newline so the regex can match a fence at the very start of the
  // message (regex needs a leading \n before the opening backticks).
  const buf = "\n" + content;
  FENCE_RE.lastIndex = 0;

  let m: RegExpExecArray | null;
  while ((m = FENCE_RE.exec(buf)) !== null) {
    const keyword = m[1]!;
    const body = m[2]!;
    if (!KNOWN_ACTIONS.has(keyword)) {
      // Unknown — let it stay in the text part below
      continue;
    }
    // Emit any preceding text (adjusting for the prepended "\n")
    const matchStart = m.index;
    if (matchStart > lastIndex) {
      const textChunk = buf.slice(lastIndex, matchStart);
      // Strip the leading "\n" we prepended if this is the first chunk
      const text = parts.length === 0 ? textChunk.replace(/^\n/, "") : textChunk;
      if (text) parts.push({ kind: "text", text });
    }
    parts.push({
      kind: "action",
      actionType: keyword,
      fields: parseActionBody(body),
      raw: m[0]!.replace(/^\n/, ""),
      fenceIndex: fenceIndex++,
    });
    lastIndex = matchStart + m[0]!.length;
  }
  // Trailing text after the last fence (or all text if no fences)
  if (lastIndex < buf.length) {
    const textChunk = buf.slice(lastIndex);
    const text = parts.length === 0 ? textChunk.replace(/^\n/, "") : textChunk;
    if (text) parts.push({ kind: "text", text });
  }
  // Empty input → return single empty-text part for caller convenience
  if (parts.length === 0) parts.push({ kind: "text", text: "" });
  return parts;
}

/**
 * Minimal YAML-subset parser for action bodies. Mirror of the Worker-side
 * parser in src/lib/actionParser.ts. If the two ever drift, the bug appears
 * as "the card on history reload shows different fields than the live card."
 */
function parseActionBody(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const km = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/);
    if (!km) {
      i++;
      continue;
    }
    const key = km[1]!;
    const value = km[2]!;
    if (value === "|") {
      const block: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i]!;
        if (/^[a-z_][a-z0-9_]*:/.test(next)) break;
        block.push(next.replace(/^ {2}/, ""));
        i++;
      }
      while (block.length > 0 && block[block.length - 1] === "") block.pop();
      out[key] = block.join("\n");
    } else {
      out[key] = value;
      i++;
    }
  }
  return out;
}
