/**
 * The .ceo/ scaffold — file contents committed when a repo is first claimed.
 *
 * Pinning rule: every entry is a string, including the deliberately-empty
 * goal.md and context.md (`""`). The Git Data API treats `content: ""` as
 * "create this file with zero bytes." Omitting `content` is interpreted as
 * "no change" and the file won't exist. See docs/phase-2-plan.md §"Empty-file
 * pinning" for the rationale.
 *
 * The manager's prompt logic treats empty goal.md/context.md as the signal to
 * ask the user for that information on the first message. Don't pre-fill them.
 */

export const CEO_README = `# .ceo/

This directory is the project's memory for The Big Brain.

A manager is bound to this repo through these files. They're committed to git, so the project's memory survives if the system's database is reset.

- \`goal.md\` — what this project is for, in your words
- \`context.md\` — what the manager needs to know to be useful here
- \`decisions.md\` — log of significant decisions, with dates
- \`board.md\` — current state snapshot (goal, state, next, blockers) with YAML frontmatter

The manager reads all of these at the start of every session. The manager can update them as housekeeping in its own workspace — you'll see those updates land as commits.

The \`uploads/\` directory is created lazily when you drag files into the manager chat.
`;

/** Intentionally empty. The manager's "ask the user" trigger is an empty goal.md. */
export const CEO_GOAL = "";

/** Intentionally empty. The manager asks for orientation when context.md is empty
 *  and the project has any complexity. */
export const CEO_CONTEXT = "";

export const CEO_DECISIONS = `# Decisions

<!-- The manager appends here when significant decisions get made. Format: dated entries. -->
`;

export function ceoBoardInitial(now: Date = new Date()): string {
  return `---
goal: ""
state: ""
next_move: ""
blockers: ""
updated_at: ${now.toISOString()}
---

# Board

<!-- The manager posts here. Edit through the manager chat, not directly. -->
`;
}

/**
 * Build the full path→content map for a scaffold commit.
 *
 * Asserts every value is a string (including ""). This is the belt-and-suspenders
 * check the plan requires — if any constant accidentally becomes undefined,
 * we want the request to fail loud at the Worker, not silently in GitHub's tree
 * API as "missing entry."
 */
export function buildCeoFiles(opts?: { now?: Date }): Record<string, string> {
  const files: Record<string, string> = {
    ".ceo/README.md": CEO_README,
    ".ceo/goal.md": CEO_GOAL,
    ".ceo/context.md": CEO_CONTEXT,
    ".ceo/decisions.md": CEO_DECISIONS,
    ".ceo/board.md": ceoBoardInitial(opts?.now),
  };
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== "string") {
      throw new Error(
        `.ceo/ scaffold: ${path} has non-string content (${typeof content})`,
      );
    }
  }
  return files;
}
