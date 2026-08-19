export type ChannelProbeFormat = "openai" | "gemini" | "modelscope" | "agnes" | "anthropic";

export type ChannelProtocolProbeInput = {
    apiFormat: ChannelProbeFormat;
    baseUrl: string;
    apiKey: string;
};

export type ChannelProtocolProbe = {
    url: string;
    method: "GET";
    headers: Record<string, string>;
};

export type ChannelProbeResult = {
    count: number;
    models: string[];
};

function normalizedBaseUrl(baseUrl: string) {
    return baseUrl.trim().replace(/\/+$/, "");
}

function compatibleModelsUrl(baseUrl: string) {
    const normalized = normalizedBaseUrl(baseUrl);
    const lower = normalized.toLowerCase();
    const apiBase = lower.endsWith("/v1") ? normalized : `${normalized}/v1`;
    return `${apiBase}/models`;
}

export function channelProtocolProbe(input: ChannelProtocolProbeInput): ChannelProtocolProbe {
    const apiKey = input.apiKey.trim();
    if (input.apiFormat === "gemini") {
        const url = new URL(`${normalizedBaseUrl(input.baseUrl)}/v1beta/models`);
        url.searchParams.set("key", apiKey);
        return { url: url.toString(), method: "GET", headers: {} };
    }
    if (input.apiFormat === "anthropic") {
        return {
            url: compatibleModelsUrl(input.baseUrl),
            method: "GET",
            headers: {
                "x-api-key": apiKey,
                "anthropic-version": "2023-06-01",
            },
        };
    }
    return {
        url: compatibleModelsUrl(input.baseUrl),
        method: "GET",
        headers: { Authorization: `Bearer ${apiKey}` },
    };
}

/** 请求上游模型列表，同时验证地址、凭据和所选协议的请求头是否能被接受。 */
export async function fetchChannelProbe(input: ChannelProtocolProbeInput, signal?: AbortSignal): Promise<ChannelProbeResult> {
    if (input.apiFormat === "modelscope" || input.apiFormat === "agnes") {
        const response = await fetch("/api/runtime/models", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ protocol: input.apiFormat, baseUrl: input.baseUrl, apiKey: input.apiKey }),
            signal,
        });
        const payload = (await response.json().catch(() => ({}))) as { count?: number; models?: string[]; error?: { message?: string } };
        if (!response.ok) throw new Error(payload.error?.message || `HTTP ${response.status}`);
        const models = payload.models || [];
        return { count: payload.count ?? models.length, models };
    }
    const probe = channelProtocolProbe(input);
    const response = await fetch(probe.url, { method: probe.method, headers: probe.headers, signal });
    if (!response.ok) {
        const detail = (await response.text()).trim().slice(0, 240);
        throw new Error(detail || `HTTP ${response.status}`);
    }
    const payload = (await response.json()) as { data?: Array<{ id?: string; name?: string }>; models?: Array<{ id?: string; name?: string }> };
    const models = (payload.data || payload.models || [])
        .map((model) => model.id || model.name || "")
        .map((name) => name.replace(/^models\//, "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    return { count: models.length, models };
}
