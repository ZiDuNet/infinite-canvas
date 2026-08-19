import { createServer } from "node:http";
import { resolve } from "node:path";

import { config as loadEnvFile } from "dotenv";

import { createChannelApplication } from "./app.js";

loadEnvFile({ path: resolve(process.cwd(), "../.env"), quiet: true });
loadEnvFile({ quiet: true });

const host = process.env.HOST || "0.0.0.0";
const port = Number.parseInt(process.env.PORT || "3001", 10) || 3001;
const server = createServer(createChannelApplication());

server.listen(port, host, () => {
  console.log(`Infinite Canvas 渠道网关已启动：http://${host}:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
