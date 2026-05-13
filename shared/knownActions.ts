/**
 * Single source of truth for the set of fence keywords the system treats as
 * actions (machine-readable, parsed out of model prose). Both the Worker's
 * streaming ActionParser and the frontend's history splitMessageIntoParts
 * import from this file so they can never disagree on what counts as an action.
 *
 * Pin three contracts (per docs/phase-4-plan.md):
 *   1. Single source of truth — defined once, here.
 *   2. Unknown fence keywords pass through as text (both parsers ignore them).
 *   3. Idempotent on already-parsed text — running splitMessageIntoParts on
 *      persisted assistant content recovers the same action parts that the
 *      streaming parser emitted during the live turn.
 *
 * Adding a new action keyword? Add it here. Both sides pick it up automatically.
 */
export const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
  // Manager tools
  "dispatch_claude_code",
  "post_to_board",
  "update_ceo_file",
  "request_file_upload",
  // Brain tools (parser-ready; renders in Phase 7)
  "tag_brain_1",
  "tag_brain_2",
  "read_project_briefing",
  "read_repo_file",
  "list_repo_files",
  "read_project_chat",
  "propose_new_project",
  "archive_dropnote",
]);
