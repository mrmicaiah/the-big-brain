export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MANAGER_DO: DurableObjectNamespace;
  AUTH_TOKEN: string;
  GIT_SHA: string;
  GITHUB_TOKEN: string;
  ANTHROPIC_API_KEY: string;
}
