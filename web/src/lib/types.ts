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
 *  hold flowing prose; tool segments mark inline tool-call status lines. */
export type Segment =
  | { kind: "text"; text: string }
  | { kind: "tool"; name: string; summary: string; ok: boolean };
