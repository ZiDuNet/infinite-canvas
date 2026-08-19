import { randomUUID } from "node:crypto";

import type { Express, NextFunction, Request, Response } from "express";

type RuntimeProtocol = "modelscope" | "agnes";
type RuntimeCapability = "image" | "video" | "text";

type RuntimeRequest = {
  protocol?: RuntimeProtocol;
  capability?: RuntimeCapability;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  prompt?: string;
  messages?: Array<{ role: "system" | "user" | "assistant"; content: unknown }>;
  images?: string[];
  count?: number;
  size?: string;
  duration?: string;
  ratio?: string;
};

type RuntimeImage = { id: string; dataUrl: string };
type JsonRecord = Record<string, unknown>;

const MODELSCOPE_IMAGE_MODELS = [
  "Qwen/Qwen-Image",
  "Qwen/Qwen-Image-Edit",
  "MusePublic/Qwen-Image-Edit",
];
const MODELSCOPE_TEXT_MODELS = [
  "Qwen/Qwen3-235B-A22B",
  "Qwen/Qwen3-VL-235B-A22B-Instruct",
  "MiniMax/MiniMax-M3",
];
const AGNES_IMAGE_MODELS = ["agnes-image-2.1-flash", "agnes-image-2.0-flash"];
const AGNES_VIDEO_MODELS = ["agnes-video-v2.0"];
const MODELSCOPE_BASE_URL = "https://api-inference.modelscope.cn/v1";
const AGNES_BASE_URL = "https://apihub.agnes-ai.com";
const IMAGE_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_POLL_TIMEOUT_MS = 30 * 60 * 1000;

class RuntimeError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "RuntimeError";
  }
}

function protocolFrom(value: unknown): RuntimeProtocol {
  const protocol = String(value || "").trim().toLowerCase();
  if (protocol === "modelscope" || protocol === "agnes") return protocol;
  throw new RuntimeError(400, "UNSUPPORTED_PROTOCOL", "暂不支持该渠道协议");
}

function capabilityFrom(value: unknown): RuntimeCapability {
  const capability = String(value || "text").trim().toLowerCase();
  if (capability === "image" || capability === "video" || capability === "text") return capability;
  throw new RuntimeError(400, "UNSUPPORTED_CAPABILITY", "暂不支持该能力类型");
}

function defaultModel(protocol: RuntimeProtocol, capability: RuntimeCapability) {
  if (protocol === "modelscope" && capability === "image") return MODELSCOPE_IMAGE_MODELS[0];
  if (protocol === "modelscope" && capability === "text") return MODELSCOPE_TEXT_MODELS[0];
  if (protocol === "agnes" && capability === "image") return AGNES_IMAGE_MODELS[0];
  if (protocol === "agnes" && capability === "video") return AGNES_VIDEO_MODELS[0];
  throw new RuntimeError(400, "UNSUPPORTED_CAPABILITY", `${protocol === "modelscope" ? "ModelScope" : "Agnes AI"} 不支持该能力类型`);
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

function requireApiKey(input: RuntimeRequest, name: string) {
  const apiKey = input.apiKey?.trim();
  if (!apiKey) throw new RuntimeError(400, "API_KEY_REQUIRED", `${name} 通道需要 API Key`);
  return apiKey;
}

function requirePrompt(input: RuntimeRequest) {
  const messagePrompt = [...(input.messages || [])]
    .reverse()
    .map((message) => typeof message.content === "string" ? message.content : "")
    .find((content) => content.trim());
  const prompt = String(input.prompt || messagePrompt || "").trim();
  if (!prompt) throw new RuntimeError(400, "PROMPT_REQUIRED", "请输入提示词");
  return prompt;
}

function apiRoot(value: string | undefined, fallback: string) {
  return (value?.trim() || fallback).replace(/\/+$/, "");
}

function modelscopeRoot(value: string | undefined) {
  const base = apiRoot(value, MODELSCOPE_BASE_URL);
  return /\/v\d+$/i.test(base) ? base : `${base}/v1`;
}

function agnesRoot(value: string | undefined) {
  return apiRoot(value, AGNES_BASE_URL).replace(/\/v1$/i, "");
}

function headers(apiKey: string, additional: Record<string, string> = {}) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...additional,
  };
}

export function modelscopeImageHeaders(apiKey: string) {
  return headers(apiKey, {
    "X-ModelScope-Async-Mode": "true",
    "X-ModelScope-Task-Type": "image_generation",
  });
}

async function responsePayload(response: globalThis.Response) {
  const text = await response.text();
  if (!text) return {} as JsonRecord;
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    return { message: text };
  }
}

export function extractModelNames(payload: JsonRecord) {
  const items = Array.isArray(payload.data) ? payload.data : Array.isArray(payload.models) ? payload.models : [];
  return Array.from(new Set(items
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as JsonRecord;
      return typeof record.id === "string" ? record.id : typeof record.name === "string" ? record.name : "";
    })
    .map((name) => name.replace(/^models\//, "").trim())
    .filter(Boolean)))
    .sort((a, b) => a.localeCompare(b));
}

export function errorMessage(payload: JsonRecord, fallback: string) {
  const error = payload.error;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object" && typeof (error as JsonRecord).message === "string") return String((error as JsonRecord).message);
  const errors = payload.errors;
  if (typeof errors === "string" && errors.trim()) return errors;
  if (errors && typeof errors === "object" && typeof (errors as JsonRecord).message === "string") return String((errors as JsonRecord).message);
  for (const key of ["message", "msg", "detail", "error_info"]) {
    if (typeof payload[key] === "string" && String(payload[key]).trim()) return String(payload[key]);
  }
  return fallback;
}

export function upstreamFailureStatus(status: number) {
  return status >= 400 && status < 500 ? status : 502;
}

function providerFailureMessage(provider: string, operation: string, model: string, status: number, payload: JsonRecord) {
  return `${provider}${operation}失败（HTTP ${status}，模型：${model}）：${errorMessage(payload, "上游未返回详细错误")}`;
}

function imageDimensions(size: string | undefined) {
  const direct = String(size || "").match(/^(\d{2,5})x(\d{2,5})$/i);
  if (direct) return { width: Number(direct[1]), height: Number(direct[2]) };
  const ratio = String(size || "1:1").replace(/\s/g, "");
  const dimensions: Record<string, [number, number]> = {
    "1:1": [1024, 1024],
    "16:9": [1344, 768],
    "9:16": [768, 1344],
    "4:3": [1152, 864],
    "3:4": [864, 1152],
    "3:2": [1152, 768],
    "2:3": [768, 1152],
  };
  const [width, height] = dimensions[ratio] || dimensions["1:1"];
  return { width, height };
}

export function modelscopeImageDimensions(size: string | undefined) {
  const dimensions = imageDimensions(size);
  const maxEdge = 2048;
  const largestEdge = Math.max(dimensions.width, dimensions.height);
  if (largestEdge <= maxEdge) return dimensions;

  const scale = maxEdge / largestEdge;
  return {
    width: Math.max(64, Math.round(dimensions.width * scale)),
    height: Math.max(64, Math.round(dimensions.height * scale)),
  };
}

function agnesVideoDimensions(ratio: string | undefined) {
  const dimensions: Record<string, [number, number]> = {
    "16:9": [1152, 648],
    "9:16": [648, 1152],
    "4:3": [1024, 768],
    "3:4": [768, 1024],
    "1:1": [768, 768],
    "21:9": [1280, 544],
    "9:21": [544, 1280],
  };
  const [width, height] = dimensions[String(ratio || "16:9").replace(/\s/g, "")] || dimensions["16:9"];
  return { width, height };
}

function agnesFrameCount(duration: string | undefined) {
  const seconds = Math.max(1, Math.min(18, Math.floor(Number(duration) || 5)));
  const target = Math.min(441, Math.max(9, seconds * 24));
  return Math.min(441, Math.max(9, 8 * Math.round((target - 1) / 8) + 1));
}

function collectUrls(value: unknown, keys: string[], urls: string[] = []): string[] {
  if (typeof value === "string") {
    if (/^(https?:\/\/|data:)/i.test(value)) urls.push(value);
    return urls;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectUrls(item, keys, urls));
    return urls;
  }
  if (!value || typeof value !== "object") return urls;
  const record = value as JsonRecord;
  for (const key of keys) collectUrls(record[key], keys, urls);
  return urls;
}

function extractImages(payload: JsonRecord): RuntimeImage[] {
  const results: string[] = [];
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      if (/^(https?:\/\/|data:)/i.test(value)) results.push(value);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as JsonRecord;
    if (typeof record.b64_json === "string" && record.b64_json) results.push(`data:image/png;base64,${record.b64_json}`);
    for (const key of ["url", "image_url", "output_images", "images", "data", "result", "output"]) {
      const item = record[key];
      if (typeof item === "string" && /^(https?:\/\/|data:)/i.test(item)) results.push(item);
      else visit(item);
    }
  };
  visit(payload);
  return Array.from(new Set(results)).map((dataUrl) => ({ id: randomUUID(), dataUrl }));
}

function extractVideos(payload: JsonRecord) {
  return Array.from(new Set(collectUrls(payload, ["url", "video_url", "result_url", "video", "videos", "output", "outputs", "data", "result"])));
}

function extractText(payload: JsonRecord) {
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const message = (choices[0] as JsonRecord | undefined)?.message;
  if (message && typeof message === "object" && typeof (message as JsonRecord).content === "string") return String((message as JsonRecord).content);
  for (const key of ["text", "content", "response", "message", "output"]) {
    if (typeof payload[key] === "string" && String(payload[key]).trim()) return String(payload[key]);
  }
  return "";
}

function taskId(payload: JsonRecord) {
  const data = payload.data && typeof payload.data === "object" ? payload.data as JsonRecord : {};
  for (const value of [payload.task_id, payload.taskId, data.task_id, data.taskId]) {
    if (typeof value === "string" && value) return value;
  }
  return "";
}

async function sleep(ms: number) {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function pollModelScopeImage(root: string, apiKey: string, id: string, model: string) {
  const deadline = Date.now() + IMAGE_POLL_TIMEOUT_MS;
  let lastPayload: JsonRecord = {};
  while (Date.now() < deadline) {
    await sleep(1800);
    const response = await fetch(`${root}/tasks/${encodeURIComponent(id)}`, {
      headers: headers(apiKey, { "X-ModelScope-Task-Type": "image_generation" }),
    });
    const payload = await responsePayload(response);
    lastPayload = payload;
    if (!response.ok) {
      throw new RuntimeError(
        upstreamFailureStatus(response.status),
        "PROVIDER_FAILED",
        providerFailureMessage("ModelScope", "图片任务查询", model, response.status, payload),
      );
    }
    const status = String(payload.task_status || "").toUpperCase();
    if (status === "SUCCEED") {
      const images = extractImages(payload);
      if (images.length) return { images };
      throw new RuntimeError(502, "NO_MEDIA", `ModelScope 图片任务完成但没有返回图片（模型：${model}）`);
    }
    if (["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT", "REVOKED"].includes(status)) {
      throw new RuntimeError(502, "PROVIDER_FAILED", `ModelScope图片任务失败（模型：${model}）：${errorMessage(payload, "上游未返回详细错误")}`);
    }
  }
  throw new RuntimeError(504, "RUNTIME_TIMEOUT", `ModelScope 图片任务超时（模型：${model}）：${errorMessage(lastPayload, "上游未返回详细错误")}`);
}

async function modelscopeRequest(input: RuntimeRequest, capability: RuntimeCapability, model: string) {
  const apiKey = requireApiKey(input, "ModelScope");
  const prompt = requirePrompt(input);
  const root = modelscopeRoot(input.baseUrl);
  if (capability === "video") throw new RuntimeError(400, "UNSUPPORTED_CAPABILITY", "当前 ModelScope 推荐渠道仅支持图片和文本模型");
  if (capability === "text") {
    const response = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ model, messages: input.messages?.length ? input.messages : [{ role: "user", content: prompt }], stream: false }),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new RuntimeError(502, "PROVIDER_FAILED", errorMessage(payload, `ModelScope 对话请求失败（${response.status}）`));
    const text = extractText(payload);
    if (!text) throw new RuntimeError(502, "NO_CONTENT", "ModelScope 没有返回文本内容");
    return { text };
  }

  const { width, height } = modelscopeImageDimensions(input.size);
  const body: JsonRecord = { model, prompt, width, height, size: `${width}x${height}` };
  const references = (input.images || []).filter(Boolean).slice(0, 6);
  if (references.length) body.image_url = references;
  const response = await fetch(`${root}/images/generations`, {
    method: "POST",
    headers: modelscopeImageHeaders(apiKey),
    body: JSON.stringify(body),
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new RuntimeError(
      upstreamFailureStatus(response.status),
      "PROVIDER_FAILED",
      providerFailureMessage("ModelScope", "图片请求", model, response.status, payload),
    );
  }
  const images = extractImages(payload);
  if (images.length) return { images };
  const id = taskId(payload);
  if (!id) throw new RuntimeError(502, "INVALID_RESPONSE", "ModelScope 未返回任务 ID 或图片结果");
  return pollModelScopeImage(root, apiKey, id, model);
}

async function providerModels(input: RuntimeRequest) {
  const protocol = protocolFrom(input.protocol);
  const apiKey = requireApiKey(input, protocol === "modelscope" ? "ModelScope" : "Agnes AI");
  const endpoint = protocol === "modelscope"
    ? `${modelscopeRoot(input.baseUrl)}/models`
    : `${agnesRoot(input.baseUrl)}/v1/models`;
  const response = await fetch(endpoint, { headers: headers(apiKey) });
  const payload = await responsePayload(response);
  if (!response.ok) throw new RuntimeError(502, "PROVIDER_FAILED", errorMessage(payload, `${protocol === "modelscope" ? "ModelScope" : "Agnes AI"} 模型列表请求失败（${response.status}）`));
  const models = extractModelNames(payload);
  if (!models.length) throw new RuntimeError(502, "INVALID_RESPONSE", "上游没有返回可用模型列表");
  return { count: models.length, models };
}

async function pollAgnesVideo(root: string, apiKey: string, id: string, model: string, agnesTask: boolean) {
  const deadline = Date.now() + VIDEO_POLL_TIMEOUT_MS;
  let lastPayload: JsonRecord = {};
  const endpoint = agnesTask
    ? `${root}/agnesapi?${new URLSearchParams({ video_id: id, model_name: model }).toString()}`
    : `${root}/v1/videos/${encodeURIComponent(id)}`;
  while (Date.now() < deadline) {
    await sleep(3000);
    const response = await fetch(endpoint, { headers: headers(apiKey) });
    const payload = await responsePayload(response);
    lastPayload = payload;
    if (!response.ok) throw new RuntimeError(502, "PROVIDER_FAILED", errorMessage(payload, `Agnes 视频任务查询失败（${response.status}）`));
    const videos = extractVideos(payload);
    if (videos.length) return { videos };
    const task = payload.data && typeof payload.data === "object" ? payload.data as JsonRecord : payload;
    const status = String(task.status || payload.status || "").toUpperCase();
    if (["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "TIMEOUT"].includes(status)) {
      throw new RuntimeError(502, "PROVIDER_FAILED", errorMessage(payload, "Agnes 视频任务失败"));
    }
  }
  throw new RuntimeError(504, "RUNTIME_TIMEOUT", errorMessage(lastPayload, "Agnes 视频任务超时"));
}

async function agnesRequest(input: RuntimeRequest, capability: RuntimeCapability, model: string) {
  const apiKey = requireApiKey(input, "Agnes AI");
  const prompt = requirePrompt(input);
  const root = agnesRoot(input.baseUrl);
  if (capability === "text") throw new RuntimeError(400, "UNSUPPORTED_CAPABILITY", "当前 Agnes AI 渠道仅预置图片和视频模型");
  if (capability === "image") {
    const extraBody: JsonRecord = { response_format: "url" };
    const references = (input.images || []).filter(Boolean).slice(0, 6);
    if (references.length) extraBody.image = references;
    const response = await fetch(`${root}/v1/images/generations`, {
      method: "POST",
      headers: headers(apiKey),
      body: JSON.stringify({ model, prompt, size: input.size || "1:1", extra_body: extraBody }),
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new RuntimeError(502, "PROVIDER_FAILED", errorMessage(payload, `Agnes 图片请求失败（${response.status}）`));
    const images = extractImages(payload);
    if (!images.length) throw new RuntimeError(502, "NO_MEDIA", "Agnes 没有返回图片");
    return { images };
  }

  const references = (input.images || []).filter((value) => /^https?:\/\//i.test(value)).slice(0, 4);
  if (input.images?.length && !references.length) {
    throw new RuntimeError(400, "PUBLIC_REFERENCE_REQUIRED", "Agnes 视频参考图需要公网 URL；本地素材在无云存储模式下不能作为参考图");
  }
  const { width, height } = agnesVideoDimensions(input.ratio || input.size);
  const body: JsonRecord = {
    model,
    prompt,
    width,
    height,
    num_frames: agnesFrameCount(input.duration),
    frame_rate: 24,
  };
  if (references.length === 1) body.image = references[0];
  if (references.length > 1) body.extra_body = { image: references, mode: "keyframes" };
  const response = await fetch(`${root}/v1/videos`, {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify(body),
  });
  const payload = await responsePayload(response);
  if (!response.ok) throw new RuntimeError(502, "PROVIDER_FAILED", errorMessage(payload, `Agnes 视频请求失败（${response.status}）`));
  const videos = extractVideos(payload);
  if (videos.length) return { videos };
  const videoId = typeof payload.video_id === "string" ? payload.video_id : "";
  const id = videoId || taskId(payload) || (typeof payload.id === "string" ? payload.id : "");
  if (!id) throw new RuntimeError(502, "INVALID_RESPONSE", "Agnes 未返回视频任务 ID 或视频结果");
  return pollAgnesVideo(root, apiKey, id, model, Boolean(videoId));
}

async function execute(request: RuntimeRequest) {
  const protocol = protocolFrom(request.protocol);
  const capability = capabilityFrom(request.capability);
  const model = String(request.model || defaultModel(protocol, capability)).trim();
  return protocol === "modelscope"
    ? modelscopeRequest(request, capability, model)
    : agnesRequest(request, capability, model);
}

function providerStatus(protocol: RuntimeProtocol) {
  if (protocol === "modelscope") {
    return {
      protocol,
      models: [
        ...MODELSCOPE_IMAGE_MODELS.map((name) => ({ name, capability: "image" })),
        ...MODELSCOPE_TEXT_MODELS.map((name) => ({ name, capability: "text" })),
      ],
    };
  }
  return {
    protocol,
    models: [
      ...AGNES_IMAGE_MODELS.map((name) => ({ name, capability: "image" })),
      ...AGNES_VIDEO_MODELS.map((name) => ({ name, capability: "video" })),
    ],
  };
}

export function registerRuntimeRoutes(app: Express) {
  app.get("/api/runtime/providers", route(async (_request, response) => {
    response.json({ providers: (["modelscope", "agnes"] as RuntimeProtocol[]).map(providerStatus) });
  }));
  app.post("/api/runtime/models", route(async (request, response) => {
    try {
      response.json(await providerModels((request.body || {}) as RuntimeRequest));
    } catch (error) {
      if (error instanceof RuntimeError) {
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));
  app.post("/api/runtime/execute", route(async (request, response) => {
    try {
      response.json(await execute((request.body || {}) as RuntimeRequest));
    } catch (error) {
      if (error instanceof RuntimeError) {
        console.warn(`[runtime] protocol=${String(request.body?.protocol || "")} capability=${String(request.body?.capability || "")} model=${String(request.body?.model || "")} status=${error.status} code=${error.code} message=${error.message}`);
        response.status(error.status).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  }));
}
