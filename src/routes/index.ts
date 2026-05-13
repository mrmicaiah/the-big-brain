import { route, type Route } from "../lib/router";
import { handleListRepos } from "./repos";
import { handleClaimRepo, handleNewProject, handleGetProject } from "./projects";

export const phase2Routes: Route[] = [
  route("GET", "/api/repos", handleListRepos),
  route("POST", "/api/projects/from-repo", handleClaimRepo),
  route("POST", "/api/projects/new", handleNewProject),
  route("GET", "/api/projects/:id", handleGetProject),
];
