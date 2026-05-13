import MANAGER_PROMPT_TEMPLATE from "../../prompts/manager.md";

export interface ManagerPromptArgs {
  projectId: string;
  repoFullName: string;
  cloneUrl: string;
  ceoFiles: {
    goal: string;
    context: string;
    decisions: string;
    board: string;
  };
}

/**
 * Assemble the manager system prompt. Format matches the template in
 * prompts/manager.md's own preamble.
 *
 * The `<recent worker job results, if any are unseen>` slot from the template
 * is omitted in Phase 3 — no execution_jobs exist yet. Phase 4 will fold those
 * in via the manager_seen_at semantics described in SPEC.md.
 */
export function buildManagerSystemPrompt(args: ManagerPromptArgs): string {
  const { projectId, repoFullName, cloneUrl, ceoFiles } = args;
  return [
    MANAGER_PROMPT_TEMPLATE,
    "",
    `## Current project: ${repoFullName}`,
    "",
    `Current project ID: ${projectId}`,
    `Repo: ${cloneUrl}`,
    "",
    "### Goal",
    ceoFiles.goal || "(empty)",
    "",
    "### Context",
    ceoFiles.context || "(empty)",
    "",
    "### Recent decisions",
    ceoFiles.decisions || "(empty)",
    "",
    "### Board",
    ceoFiles.board || "(empty)",
    "",
  ].join("\n");
}
