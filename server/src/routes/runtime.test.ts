import assert from "node:assert/strict";
import test from "node:test";

import { errorMessage, extractModelNames, modelscopeImageDimensions, modelscopeImageHeaders, upstreamFailureStatus } from "./runtime.js";

test("ModelScope 图片任务带有异步和任务类型请求头", () => {
  assert.deepEqual(modelscopeImageHeaders("test-token"), {
    Authorization: "Bearer test-token",
    "Content-Type": "application/json",
    "X-ModelScope-Async-Mode": "true",
    "X-ModelScope-Task-Type": "image_generation",
  });
});

test("能够解析 ModelScope errors.message 错误格式", () => {
  assert.equal(
    errorMessage({ errors: { message: "Authentication failed" } }, "fallback"),
    "Authentication failed",
  );
});

test("能够解析 ModelScope 完整模型目录", () => {
  assert.deepEqual(
    extractModelNames({ data: [{ id: "Qwen/Qwen-Image" }, { id: "models/Qwen/Qwen3-235B-A22B" }] }),
    ["Qwen/Qwen-Image", "Qwen/Qwen3-235B-A22B"],
  );
});

test("保留 ModelScope 可诊断的上游客户端错误状态", () => {
  assert.equal(upstreamFailureStatus(400), 400);
  assert.equal(upstreamFailureStatus(401), 401);
  assert.equal(upstreamFailureStatus(429), 429);
  assert.equal(upstreamFailureStatus(503), 502);
});

test("ModelScope 将超出单边上限的 4K 尺寸等比缩小", () => {
  assert.deepEqual(modelscopeImageDimensions("3840x2160"), {
    width: 2048,
    height: 1152,
  });
  assert.deepEqual(modelscopeImageDimensions("2160x3840"), {
    width: 1152,
    height: 2048,
  });
});
