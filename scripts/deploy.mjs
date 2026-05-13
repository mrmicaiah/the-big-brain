#!/usr/bin/env node
// Deploy wrapper: resolve current commit SHA and spawn wrangler deploy with it
// as a runtime var. Cross-platform — no bash substitution required.
//
// Invokes via `npx wrangler ...` so this works whether the script is called
// from an npm script (which prepends node_modules/.bin to PATH) or directly
// via `node scripts/deploy.mjs` (which doesn't). npx finds the locally-
// installed wrangler instantly.
import { execSync, spawnSync } from "node:child_process";

const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const result = spawnSync(
  "npx",
  ["wrangler", "deploy", "--var", `GIT_SHA:${sha}`],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
