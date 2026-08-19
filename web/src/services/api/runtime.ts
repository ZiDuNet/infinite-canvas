import { nanoid } from "nanoid";

import type { AiConfig, ApiCallFormat, ModelChannel } from "@/stores/use-config-store";
import type { AiTextMessage } from "./image";

export type RuntimeApiFormat = Extract<ApiCallFormat, "modelscope" | "agnes">;
export type RuntimeResult = { text?: string; images?: Array<{ id?: string; dataUrl: string }>; videos?: string[]; raw?: unknown };

export function isRuntimeApiFormat(value: ApiCallFormat): value is RuntimeApiFormat {
    return value === "modelscope" || value === "agnes";
}

export async function fetchRuntimeChannelModels(channel: Pick<ModelChannel, "apiFormat" | "baseUrl" | "apiKey">) {
    const response = await fetch("/api/runtime/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ protocol: channel.apiFormat, baseUrl: channel.baseUrl, apiKey: channel.apiKey }),
    });
    const payload = (await response.json().catch(() => ({}))) as {
        models?: string[];
        error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message || "渠道模型列表加载失败");
    return payload.models || [];
}

export async function executeRuntime(config: AiConfig, input: { capability: "image" | "video" | "text"; prompt?: string; messages?: AiTextMessage[]; images?: string[] }) {
    const response = await fetch("/api/runtime/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            protocol: config.apiFormat,
            capability: input.capability,
            model: config.model,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            prompt: input.prompt,
            messages: input.messages,
            images: input.images,
            count: config.count,
            size: config.size,
            quality: config.quality,
            duration: config.videoSeconds,
            ratio: config.size,
        }),
    });
    const payload = (await response.json().catch(() => ({}))) as RuntimeResult & { error?: { message?: string } };
    if (!response.ok) throw new Error(payload.error?.message || "渠道调用失败");
    return { ...payload, images: payload.images?.map((item) => ({ id: item.id || nanoid(), dataUrl: item.dataUrl })) || [] };
}
