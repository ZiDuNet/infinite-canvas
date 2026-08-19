import i18n from "@/i18n";
import type { PromptSource } from "./prompt-source-presets";

export type RawPrompt = {
    id: string;
    title: string;
    prompt: string;
    description: string;
    coverUrl: string;
    referenceImageUrls: string[];
    tags: string[];
    preview: string;
    createdAt: string;
    updatedAt: string;
    author?: string;
    sourceUrl?: string;
    sourceSite?: string;
    imageMode?: string;
    imageModel?: string;
    imageSize?: string;
    imageCount?: number;
};

type RunOptions = { signal?: AbortSignal };

export type RawPromptPage = {
    items: RawPrompt[];
    hasMore: boolean;
    total?: number;
};

async function fetchSource(url: string, options?: RunOptions) {
    const response = await fetch(url, { cache: "no-store", signal: options?.signal });
    if (!response.ok) throw new Error(i18n.t("config.promptSources.runtime.requestFailed", { status: response.status }));
    return { data: await response.json(), response };
}

export async function runPromptSource(source: PromptSource, options?: RunOptions): Promise<RawPrompt[]> {
    return (await runPromptSourcePage(source, 1, options)).items;
}

export async function runPromptSourcePage(source: PromptSource, page = 1, options?: RunOptions): Promise<RawPromptPage> {
    if (!source.url.trim()) throw new Error(i18n.t("config.promptSources.runtime.urlRequired"));
    let data: unknown;
    let hasMore = false;
    let total: number | undefined;
    try {
        const result = await fetchSource(sourcePageUrl(source, page), options);
        data = result.data;
        hasMore = source.pagination === "remote" && result.response.headers.get("x-prompt-source-has-more") === "true";
        const headerTotal = Number(result.response.headers.get("x-prompt-source-total"));
        total = Number.isFinite(headerTotal) && headerTotal >= 0 ? headerTotal : undefined;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw error;
        throw new Error(i18n.t("config.promptSources.runtime.fetchFailed", { name: source.name, error: error instanceof Error ? error.message : String(error) }));
    }

    const items = parseJsonSource(data, source);
    if (source.builtIn && !items.length) throw new Error(i18n.t("config.promptSources.runtime.noPrompts", { name: source.name }));
    return { items, hasMore, total };
}

function sourcePageUrl(source: PromptSource, page: number) {
    if (source.pagination !== "remote") return source.url;
    const url = new URL(source.url, window.location.origin);
    url.searchParams.set("page", String(Math.max(1, page)));
    return url.toString();
}

function parseJsonSource(data: unknown, source: PromptSource) {
    if (!Array.isArray(data)) throw new Error(i18n.t("config.promptSources.runtime.invalidRoot", { name: source.name }));
    return normalizeItems(data, source);
}

function normalizeItems(values: unknown[], source: PromptSource) {
    const seen = new Set<string>();
    const items: RawPrompt[] = [];
    values.forEach((value, index) => {
        const record = asRecord(value);
        const title = stringValue(record.title).trim();
        const prompt = stringValue(record.prompt).trim();
        if (!title || !prompt) return;
        const id = stringValue(record.id).trim() || `${source.id}-${leftPad(index + 1)}`;
        if (seen.has(id)) return;
        seen.add(id);
        const referenceImageUrls = stringArray(record.referenceImageUrls).map((url) => absoluteUrl(source.url, url));
        const coverUrl = absoluteUrl(source.url, stringValue(record.coverUrl)) || referenceImageUrls[0] || "";
        items.push({
            id,
            title,
            prompt,
            description: stringValue(record.description),
            coverUrl,
            referenceImageUrls,
            tags: stringArray(record.tags),
            preview: stringValue(record.preview),
            createdAt: stringValue(record.createdAt),
            updatedAt: stringValue(record.updatedAt),
            author: stringValue(record.author),
            sourceUrl: absoluteUrl(source.url, stringValue(record.sourceUrl)),
            sourceSite: optionalString(record.sourceSite),
            imageMode: optionalString(record.imageMode),
            imageModel: optionalString(record.imageModel),
            imageSize: optionalString(record.imageSize),
            imageCount: optionalNumber(record.imageCount),
        });
    });
    return items;
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(stringValue).map((item) => item.trim()).filter(Boolean) : [];
}

function optionalString(value: unknown) {
    const result = stringValue(value).trim();
    return result || undefined;
}

function optionalNumber(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : undefined;
}

function absoluteUrl(baseUrl: string, path: string) {
    if (!path) return "";
    try {
        return new URL(path, baseUrl).toString();
    } catch {
        return path;
    }
}

function leftPad(value: number) {
    return String(value).padStart(4, "0");
}
