# 渠道网关精简实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 将干净的无限画布保留为本地优先工具，并仅为 ModelScope 和 Agnes AI 提供无状态服务端渠道转发。

**架构：** 前端继续将画布、素材、提示词和渠道 API Key 保存于浏览器本地。新增 Express 网关只接收单次渠道调用，不创建账号、Cookie、数据库或持久化资产；生产环境由同一服务提供前端静态资源与 `/api/runtime`。

**技术栈：** React、Vite、TypeScript、Express、Docker。

---

### 任务 1：创建无状态渠道网关

**文件：**
- 创建：`server/src/app.ts`
- 创建：`server/src/index.ts`
- 创建：`server/src/routes/runtime.ts`
- 创建：`server/package.json`
- 创建：`server/tsconfig.json`
- 创建：`server/tsconfig.build.json`

- [x] **步骤 1：定义仅允许的渠道**

```ts
type RuntimeProtocol = "modelscope" | "agnes";
```

- [x] **步骤 2：注册无认证调用接口**

```ts
app.get("/api/health", (_request, response) => response.json({ status: "ok" }));
registerRuntimeRoutes(app);
```

- [x] **步骤 3：移除所有 SaaS 依赖**

```json
"dependencies": {
  "dotenv": "^17.2.2",
  "express": "^5.1.0",
  "helmet": "^8.1.0"
}
```

- [x] **步骤 4：验证服务端类型检查**

运行：`npm run typecheck`

预期：退出码为 `0`。

### 任务 2：连接前端渠道配置与调用

**文件：**
- 创建：`web/src/services/api/runtime.ts`
- 修改：`web/src/stores/use-config-store.ts`
- 修改：`web/src/components/layout/channel-editor-drawer.tsx`
- 修改：`web/src/components/layout/app-config-modal.tsx`
- 修改：`web/src/services/api/image.ts`
- 修改：`web/src/services/api/video.ts`
- 修改：`web/vite.config.ts`

- [x] **步骤 1：定义运行时协议类型**

```ts
export type RuntimeApiFormat = Extract<ApiCallFormat, "modelscope" | "agnes">;
```

- [x] **步骤 2：将图片、文本和视频调用转发到网关**

```ts
if (isRuntimeApiFormat(requestConfig.apiFormat)) {
  return executeRuntime(requestConfig, { capability: "image", prompt });
}
```

- [x] **步骤 3：为开发服务器配置 API 代理**

```ts
server: { proxy: { "/api": { target: "http://127.0.0.1:3001" } } }
```

- [x] **步骤 4：验证前端类型检查和构建**

运行：`bun run typecheck; bun run build`

结果：`bun run build` 通过；`bun run typecheck` 保留基线错误
`canvas-generation-helpers.ts:51`（本次未修改该文件）。

### 任务 3：调整部署与文档

**文件：**
- 创建：`.env.example`
- 修改：`Dockerfile`
- 修改：`docker-compose.yml`
- 修改：`README.md`
- 修改：`CHANGELOG.md`
- 修改：`docs/content/docs/progress/pending-test.mdx`

- [x] **步骤 1：让 Node 服务同源托管构建后的前端**

```dockerfile
CMD ["node", "dist/index.js"]
```

- [x] **步骤 2：记录本地渠道数据边界**

```md
画布、素材、提示词和 API Key 继续保存在浏览器本地；服务端不保存账号、资产或生成记录。
```

- [x] **步骤 3：验证网关健康检查**

运行：`curl http://127.0.0.1:3001/api/health`

预期：响应为 `{"status":"ok"}`。
