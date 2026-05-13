import type { Env } from "../types";

export type Handler = (
  request: Request,
  env: Env,
  params: Record<string, string>,
) => Response | Promise<Response>;

export interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

/**
 * Compile a route definition. `path` may contain `:name` segments, which
 * become regex groups and are exposed to the handler via `params`.
 *
 *   route("GET", "/api/projects/:id", h)
 *     → matches /api/projects/abc → params = { id: "abc" }
 */
export function route(method: string, path: string, handler: Handler): Route {
  const paramNames: string[] = [];
  // Escape regex-meaningful chars OTHER than the `:` placeholders we want to expand.
  const escaped = path.replace(/[.+*?^${}()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return "([^/]+)";
  });
  return {
    method,
    pattern: new RegExp(`^${regexSource}$`),
    paramNames,
    handler,
  };
}

/**
 * Dispatch a request against a route list. Returns the matched handler's
 * Response, or null if no route matched (caller decides 404 shape).
 */
export async function dispatch(
  routes: Route[],
  request: Request,
  env: Env,
): Promise<Response | null> {
  const url = new URL(request.url);
  for (const r of routes) {
    if (request.method !== r.method) continue;
    const match = url.pathname.match(r.pattern);
    if (match) {
      const params: Record<string, string> = {};
      for (let i = 0; i < r.paramNames.length; i++) {
        params[r.paramNames[i]!] = decodeURIComponent(match[i + 1]!);
      }
      return r.handler(request, env, params);
    }
  }
  return null;
}
