import { route, type Route } from "../lib/router";
import { handleListRepos } from "./repos";
import { handleClaimRepo, handleNewProject, handleGetProject } from "./projects";
import { handleManagerChatResolve, handleManagerChat } from "./manager";
import { handleListMessages } from "./messages";
import { handleDispatchClaudeCode } from "./dispatch";
import { handleGetJob, handleStreamJob, handleListJobsForChat } from "./jobs";
import { handleAgentWebSocket } from "./agent";

export const apiRoutes: Route[] = [
  // Phase 2
  route("GET", "/api/repos", handleListRepos),
  route("POST", "/api/projects/from-repo", handleClaimRepo),
  route("POST", "/api/projects/new", handleNewProject),
  route("GET", "/api/projects/:id", handleGetProject),
  // Phase 3
  route("GET", "/api/projects/:id/manager-chat", handleManagerChatResolve),
  route("POST", "/api/projects/:id/manager/chat", handleManagerChat),
  route("GET", "/api/chats/:chatId/messages", handleListMessages),
  // Phase 4
  route("POST", "/api/projects/:id/dispatch-claude-code", handleDispatchClaudeCode),
  route("GET", "/api/jobs/:id/stream", handleStreamJob),
  route("GET", "/api/jobs/:id", handleGetJob),
  route("GET", "/api/chats/:chatId/jobs", handleListJobsForChat),
  route("GET", "/api/agent/ws", handleAgentWebSocket),
];

// Kept under the old name to avoid touching imports elsewhere
export const phase2Routes = apiRoutes;
