// Quick local test for the ActionParser fix. Run with: node scripts/test-action-parser.mjs
//
// Three scenarios from docs/phase-4-plan.md diagnosis:
//   1. Fence at message start (the prod bug — no leading prose)
//   2. Same content fed one byte at a time (stress lookback buffer)
//   3. Fence after prose (the case that worked locally in Phase 4)

import { ActionParser, KNOWN_ACTIONS } from "../src/lib/actionParser.ts";

let failures = 0;

function run(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(`  ${err.message}`);
    failures++;
  }
}

function collectAll(parser, input, chunkSize = input.length) {
  const events = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    events.push(...parser.feed(input.slice(i, i + chunkSize)));
  }
  events.push(...parser.finish());
  return events;
}

function assertOneAction(events, expectedType, expectedFields) {
  const actions = events.filter((e) => e.kind === "action");
  if (actions.length !== 1) {
    throw new Error(`expected 1 action, got ${actions.length}. events: ${JSON.stringify(events, null, 2)}`);
  }
  const a = actions[0];
  if (a.action.type !== expectedType) {
    throw new Error(`expected type=${expectedType}, got ${a.action.type}`);
  }
  for (const [k, v] of Object.entries(expectedFields)) {
    if (a.action.fields[k] !== v) {
      throw new Error(`expected field ${k}="${v}", got "${a.action.fields[k]}"`);
    }
  }
}

// Scenario 1: fence at message start (the prod bug)
run("scenario 1: fence at message start, single feed", () => {
  const p = new ActionParser(KNOWN_ACTIONS);
  const input = "```dispatch_claude_code\nproject: x\nsummary: hello\n```\n";
  const events = collectAll(p, input);
  assertOneAction(events, "dispatch_claude_code", { project: "x", summary: "hello" });
});

// Scenario 2: same content fed one byte at a time
run("scenario 2: fence at message start, byte-by-byte feed", () => {
  const p = new ActionParser(KNOWN_ACTIONS);
  const input = "```dispatch_claude_code\nproject: x\nsummary: hello\n```\n";
  const events = collectAll(p, input, 1);
  assertOneAction(events, "dispatch_claude_code", { project: "x", summary: "hello" });
});

// Scenario 3: fence after prose (case that worked locally in Phase 4)
run("scenario 3: fence after prose", () => {
  const p = new ActionParser(KNOWN_ACTIONS);
  const input = "Got it. Let me try.\n\n```dispatch_claude_code\nproject: y\nsummary: world\n```\n";
  const events = collectAll(p, input);
  const texts = events.filter((e) => e.kind === "text").map((e) => e.text).join("");
  if (!texts.startsWith("Got it. Let me try.")) {
    throw new Error(`expected leading prose preserved, got: ${JSON.stringify(texts)}`);
  }
  assertOneAction(events, "dispatch_claude_code", { project: "y", summary: "world" });
});

// Scenario 4: inline backticks in prose must NOT trigger an action
run("scenario 4: inline `code` doesn't trigger action", () => {
  const p = new ActionParser(KNOWN_ACTIONS);
  const input = "The `route` function in `src/lib/router.ts` handles dispatching.\n";
  const events = collectAll(p, input);
  const actions = events.filter((e) => e.kind === "action");
  if (actions.length !== 0) {
    throw new Error(`expected 0 actions, got ${actions.length}`);
  }
  const texts = events.filter((e) => e.kind === "text").map((e) => e.text).join("");
  if (texts !== input) {
    throw new Error(`expected text="${input}", got "${texts}"`);
  }
});

// Scenario 5: unknown fence keyword passes through as text
run("scenario 5: unknown fence keyword (```typescript) passes as text", () => {
  const p = new ActionParser(KNOWN_ACTIONS);
  const input = "```typescript\nconst x = 1;\n```\n";
  const events = collectAll(p, input);
  const actions = events.filter((e) => e.kind === "action");
  if (actions.length !== 0) {
    throw new Error(`expected 0 actions for unknown keyword, got ${actions.length}`);
  }
});

// Scenario 6: multi-line value with embedded indented backticks (the prompt: | case
// from the persisted prod message) — outer fence opens at start, inner backticks
// in the prompt body shouldn't fool the close-fence detector.
run("scenario 6: nested indented backticks in prompt: | body", () => {
  const p = new ActionParser(KNOWN_ACTIONS);
  const input = [
    "```dispatch_claude_code",
    "project: abc",
    "summary: nested",
    "prompt: |",
    "  Edit the file.",
    "  ```",
    "  inserted code block",
    "  ```",
    "  After.",
    "```",
    "",
  ].join("\n");
  const events = collectAll(p, input);
  assertOneAction(events, "dispatch_claude_code", { project: "abc", summary: "nested" });
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall pass");
