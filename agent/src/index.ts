// Entrypoint. Loads .env, then starts the connection loop.

import "dotenv/config";
import { startAgent } from "./agent.js";
import { log } from "./log.js";

startAgent().catch((err) => {
  log.error("agent crashed:", err);
  process.exit(1);
});
