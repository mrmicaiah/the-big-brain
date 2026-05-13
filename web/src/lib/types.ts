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
