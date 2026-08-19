import { existsSync } from "node:fs";
import { resolve } from "node:path";

import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";

import { registerPromptSourceRoutes } from "./routes/prompt-sources.js";
import { registerRuntimeRoutes } from "./routes/runtime.js";

function webDistDirectory() {
  return resolve(process.env.WEB_DIST_DIR || resolve(process.cwd(), "../web/dist"));
}

function runtimeConfigScript() {
  const sanitize = (value: string | undefined) => (value || "").replace(/[^A-Za-z0-9-]/g, "");
  return `window.__RUNTIME_CONFIG__ = {\n  ANALYTICS_GA4_ID: "${sanitize(process.env.ANALYTICS_GA4_ID)}",\n  ANALYTICS_BAIDU_ID: "${sanitize(process.env.ANALYTICS_BAIDU_ID)}"\n};`;
}

/** 创建仅处理渠道调用和静态资源的应用。 */
export function createChannelApplication() {
  const app = express();
  const webDistDir = webDistDirectory();

  app.disable("x-powered-by");
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(express.json({ limit: "32mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok" });
  });
  registerPromptSourceRoutes(app);
  registerRuntimeRoutes(app);
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: { code: "API_NOT_FOUND", message: "接口不存在" } });
  });

  if (existsSync(webDistDir)) {
    app.get("/config.js", (_request, response) => {
      response.type("application/javascript").set("cache-control", "no-store").send(runtimeConfigScript());
    });
    app.use(express.static(webDistDir));
    app.get("/{*path}", (request, response, next) => {
      if (!request.accepts("html")) {
        next();
        return;
      }
      response.sendFile(resolve(webDistDir, "index.html"));
    });
  }

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    console.error(error);
    response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "服务器内部错误" } });
  };
  app.use(errorHandler);
  return app;
}
