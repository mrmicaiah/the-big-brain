export interface Repo {
  full_name: string;
  name: string;
  description: string | null;
  default_branch: string;
  clone_url: string;
  private: boolean;
  updated_at: string;
  isProject: boolean;
  projectId?: string;
}

export interface Project {
  id: string;
  repo_full_name: string;
  clone_url: string;
  default_branch: string;
  created_at: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  brain: "brain1" | "brain2" | null;
  content: string;
  created_at: string;
}

export interface ParsedAction {
  type: string;
  fields: Record<string, string>;
  raw: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  summary: string;
}

/** A streamed assistant message is an ordered list of segments. Text segments
 *  hold flowing prose; tool segments mark inline tool-call status lines;
 *  action segments are dispatch cards (Phase 4). */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string; ok: boolean }
  | {
      kind: "action";
      messageId: string;
      fenceIndex: number;
      actionType: string;
      fields: Record<string, string>;
      raw: string;
    };

/** Successful job: agent returned a captured diff. */
export interface DiffSummarySuccess {
  summary?: string;
  diffStat?: string;
  diff?: string;
  diffTruncated?: boolean;
}

/** Failed job: agent (or Worker) couldn't complete the run. */
export interface DiffSummaryFailure {
  error: string;
  stage: "workspace" | "execution" | "diff" | string;
}

export type DiffSummary = DiffSummarySuccess | DiffSummaryFailure;

export interface JobSnapshot {
  id: string;
  project_id: string;
  chat_id: string;
  prompt: string;
  summary: string;
  status: "queued" | "running" | "succeeded" | "failed";
  output_stream: string | null;
  diff_summary: string | null;
  created_at: string;
  completed_at: string | null;
  message_id: string | null;
  fence_index: number | null;
}

export interface JobOutputFrame {
  kind: "text" | "tool_use" | "tool_result";
  payload: string;
}
