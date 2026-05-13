import { route, type Route } from "../lib/router";
import { handleListRepos } from "./repos";
import { handleClaimRepo, handleNewProject, handleGetProject } from "./projects";
import { handleManagerChatResolve, handleManagerChat } from "./manager";
import { handleListMessages } from "./messages";

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
];

// Kept under the old name to avoid touching imports elsewhere
export const phase2Routes = apiRoutes;
