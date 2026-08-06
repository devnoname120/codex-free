import { parseCli, loadConfig } from "./src/config.js";
import { startHttpServer } from "./src/server.js";

const cli = parseCli();
const config = await loadConfig(cli);
await startHttpServer(config);
