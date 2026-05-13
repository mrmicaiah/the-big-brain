// Validated configuration loaded from .env. Fail loudly at startup if
// anything required is missing; the agent does nothing useful without all
// four values.

export interface AgentConfig {
  workerUrl: string;        // wss://... or ws://...
  agentToken: string;       // Bearer token matched against env.AGENT_TOKEN on Worker
  reposDir: string;         // Absolute path on this machine for repo checkouts
  anthropicApiKey: string;  // Picked up by the Claude Code SDK via process.env
}

export function loadConfig(): AgentConfig {
  const workerUrl = required("WORKER_URL");
  const agentToken = required("AGENT_TOKEN");
  const reposDir = required("REPOS_DIR");
  const anthropicApiKey = required("ANTHROPIC_API_KEY");

  if (!/^wss?:\/\//i.test(workerUrl)) {
    throw new Error(`WORKER_URL must start with ws:// or wss:// — got: ${workerUrl}`);
  }

  return { workerUrl, agentToken, reposDir, anthropicApiKey };
}

function required(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}
