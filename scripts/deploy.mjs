#!/usr/bin/env node
// Deploy wrapper: resolve current commit SHA and spawn wrangler deploy with it
// as a runtime var. Cross-platform — no bash substitution required.
import { execSync, spawnSync } from "node:child_process";

const sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
const result = spawnSync(
  "wrangler",
  ["deploy", "--var", `GIT_SHA:${sha}`],
  { stdio: "inherit", shell: process.platform === "win32" },
);
process.exit(result.status ?? 1);
