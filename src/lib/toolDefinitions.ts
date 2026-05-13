/**
 * Anthropic tool schemas for read-only repo access.
 *
 * Shared between ManagerDO (Phase 3.5) and BrainstormDO (Phase 7). Implementations
 * are in src/lib/repoReadTools.ts; both DOs construct an `executeTool` closure
 * over their project's `(repoFullName, branch)` and dispatch by name.
 */

import type Anthropic from "@anthropic-ai/sdk";

export const listRepoFilesTool: Anthropic.Tool = {
  name: "list_repo_files",
  description:
    "List immediate children of a directory in this project's repo. Returns " +
    "an array of entries with name, type ('file' or 'dir'), and size (for files). " +
    "Use this to discover what's where before fetching specific files. Pass an " +
    "empty path or '.' to list the repo root.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Directory path relative to the repo root. Empty string or '.' lists " +
          "the root. Examples: 'src', 'src/lib', 'web/src/components'.",
      },
    },
    required: [],
  },
};

export const readRepoFileTool: Anthropic.Tool = {
  name: "read_repo_file",
  description:
    "Read the full contents of one file from this project's repo. Returns the " +
    "file as UTF-8 text. Refuses files over 256 KB or files that can't be decoded " +
    "as text. Prefer this when you need exact content; if you just need to know " +
    "what files exist, use list_repo_files.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "File path relative to the repo root. Required.",
      },
    },
    required: ["path"],
  },
};

export const readRepoFilesTool: Anthropic.Tool = {
  name: "read_repo_files",
  description:
    "Read multiple files in one call (parallel). Returns the contents of each " +
    "file concatenated with path headers. Caps at 10 paths per call. Use when " +
    "you need to look at a small set of related files together (e.g., 'check " +
    "the route, the handler, and the type').",
  input_schema: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "File paths relative to the repo root. Up to 10.",
      },
    },
    required: ["paths"],
  },
};

export const repoReadToolDefinitions: Anthropic.Tool[] = [
  listRepoFilesTool,
  readRepoFileTool,
  readRepoFilesTool,
];
