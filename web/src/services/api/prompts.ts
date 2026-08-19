import localforage from "localforage";

import { runPromptSourcePage, type RawPrompt } from "./prompt-source-runtime";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import i18n from "@/i18n";
import type { PromptSource } from "./prompt-source-presets";

export type Prompt = RawPrompt & {
    sourceId: string;
    category: string;
    githubUrl: string;
};

export const ALL_PROMPTS_OPTION = "all";

export type PromptListResponse = {
    items: Prompt[];
    tags: string[];
    categories: string[];
    total: number;
    hasMore: boolean;
    totalExact: boolean;
};

export type PromptSourceStatus = {
    sourceId: string;
    count: number;
    lastSuccessAt: string;
    lastError: string;
    hasMore: boolean;
    total?: number;
};

export type PromptSourceRefreshResult = PromptSourceStatus & {
    sourceName: string;
    success: boolean;
};

export type PromptSourceRefreshSummary = {
    results: PromptSourceRefreshResult[];
    total: number;
    successCount: number;
    failureCount: number;
};

type SourceCache = PromptSourceStatus & {
    items: Prompt[];
    fetchedAt: number;
    signature: string;
    nextPage: number;
};

const cacheTtlMs = 1000 * 60 * 60;
const promptCacheStore = localforage.createInstance({ name: "infinite-canvas", storeName: "prompt_cache" });
const loadingSources = new Map<string, Promise<PromptSourceRefreshResult>>();
const loadingSourcePages = new Map<string, Promise<SourceCache>>();

function enabledSources() {
    return usePromptSourceStore.getState().sources.filter((source) => source.enabled);
}

function cacheKey(sourceId: string) {
    return `prompt-source:${sourceId}`;
}

function sourceSignature(source: PromptSource) {
    const value = `${source.name}\n${source.url}\n${source.homepage}\n${source.pagination || "static"}`;
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
    return `${value.length}:${hash}`;
}

function withSourceMeta(source: PromptSource, items: RawPrompt[]): Prompt[] {
    return items.map((item) => ({
        ...item,
        description: item.description || "",
        referenceImageUrls: Array.isArray(item.referenceImageUrls) ? item.referenceImageUrls : [],
        sourceId: source.id,
        category: source.name,
        githubUrl: item.sourceUrl || source.homepage,
    }));
}

function mergePromptItems(current: Prompt[], next: Prompt[]) {
    const known = new Set(current.map((item) => item.id));
    return [...current, ...next.filter((item) => !known.has(item.id))];
}

function toStatus(cache: SourceCache): PromptSourceRefreshResult {
    return {
        sourceId: cache.sourceId,
        sourceName: "",
        count: cache.count,
        lastSuccessAt: cache.lastSuccessAt,
        lastError: cache.lastError,
        hasMore: cache.hasMore,
        total: cache.total,
        success: true,
    };
}

async function readSourceCache(sourceId: string) {
    return promptCacheStore.getItem<SourceCache>(cacheKey(sourceId));
}

async function refreshSourceRecord(source: PromptSource): Promise<PromptSourceRefreshResult> {
    const previous = await readSourceCache(source.id);
    try {
        const page = await runPromptSourcePage(source);
        const items = withSourceMeta(source, page.items);
        const lastSuccessAt = new Date().toISOString();
        const cache: SourceCache = {
            sourceId: source.id,
            items,
            count: items.length,
            fetchedAt: Date.now(),
            lastSuccessAt,
            lastError: "",
            hasMore: page.hasMore,
            total: page.total ?? (page.hasMore ? undefined : items.length),
            nextPage: page.hasMore ? 2 : 1,
            signature: sourceSignature(source),
        };
        await promptCacheStore.setItem(cacheKey(source.id), cache);
        return { ...toStatus(cache), sourceName: source.name };
    } catch (error) {
        const lastError = error instanceof Error ? error.message : String(error);
        const cache: SourceCache = {
            sourceId: source.id,
            items: previous?.items || [],
            count: previous?.items?.length || 0,
            fetchedAt: previous?.fetchedAt || 0,
            lastSuccessAt: previous?.lastSuccessAt || "",
            lastError,
            hasMore: previous?.hasMore || false,
            total: previous?.total,
            nextPage: previous?.nextPage || 1,
            signature: previous?.signature || sourceSignature(source),
        };
        await promptCacheStore.setItem(cacheKey(source.id), cache);
        return { ...toStatus(cache), sourceName: source.name, success: false };
    }
}

async function loadNextSourcePage(source: PromptSource, current: SourceCache): Promise<SourceCache> {
    if (source.pagination !== "remote" || !current.hasMore) return current;
    const loading = loadingSourcePages.get(source.id);
    if (loading) return loading;
    const next = (async () => {
        const page = await runPromptSourcePage(source, current.nextPage || 2);
        const items = mergePromptItems(current.items, withSourceMeta(source, page.items));
        const cache: SourceCache = {
            ...current,
            items,
            count: items.length,
            fetchedAt: Date.now(),
            lastSuccessAt: new Date().toISOString(),
            lastError: "",
            hasMore: page.hasMore,
            total: page.total ?? current.total,
            nextPage: page.hasMore ? current.nextPage + 1 : current.nextPage,
            signature: sourceSignature(source),
        };
        await promptCacheStore.setItem(cacheKey(source.id), cache);
        return cache;
    })().finally(() => loadingSourcePages.delete(source.id));
    loadingSourcePages.set(source.id, next);
    return next;
}

function getOrStartRefresh(source: PromptSource) {
    const current = loadingSources.get(source.id);
    if (current) return current;
    const loading = refreshSourceRecord(source).finally(() => loadingSources.delete(source.id));
    loadingSources.set(source.id, loading);
    return loading;
}

async function getSourcePrompts(source: PromptSource, minimumItems = 0): Promise<Prompt[]> {
    let cached = await readSourceCache(source.id);
    if (cached) {
        const stale = cached.signature !== sourceSignature(source) || Date.now() - cached.fetchedAt >= cacheTtlMs;
        if (stale && source.pagination === "remote") {
            const result = await getOrStartRefresh(source);
            if (!result.success) throw new Error(result.lastError);
            cached = await readSourceCache(source.id);
        } else if (stale) {
            void getOrStartRefresh(source).catch(() => undefined);
        }
    } else {
        const result = await getOrStartRefresh(source);
        if (!result.success) throw new Error(result.lastError);
        cached = await readSourceCache(source.id);
    }
    while (cached && source.pagination === "remote" && cached.hasMore && cached.items.length < minimumItems) {
        cached = await loadNextSourcePage(source, cached);
    }
    return cached ? withSourceMeta(source, cached.items) : [];
}

async function getAllPrompts(minimumItemsPerSource = 0): Promise<Prompt[]> {
    const settled = await Promise.all(
        enabledSources().map(async (source) => {
            try {
                return await getSourcePrompts(source, minimumItemsPerSource);
            } catch {
                return [];
            }
        }),
    );
    return settled.flat();
}

export async function fetchPrompts({ keyword = "", tag = [], category = ALL_PROMPTS_OPTION, page = 1, pageSize = 20 }: { keyword?: string; tag?: string[]; category?: string; page?: number; pageSize?: number } = {}) {
    const normalizedPage = Math.max(1, page);
    const normalizedPageSize = Math.max(1, Math.min(100, pageSize));
    const items = await getAllPrompts(normalizedPage * normalizedPageSize);
    const normalizedKeyword = keyword.trim().toLowerCase();
    const withoutTagFilter = filterPrompts(items, { keyword: normalizedKeyword, category, tags: [] });
    const filtered = filterPrompts(items, { keyword: normalizedKeyword, category, tags: tag });
    const categories = enabledSources().map((source) => source.name);
    const sourceCaches = await Promise.all(enabledSources().map((source) => readSourceCache(source.id)));
    const hasMore = sourceCaches.some((cache) => cache?.hasMore);
    const exactTotal = !normalizedKeyword && tag.length === 0 && category === ALL_PROMPTS_OPTION && sourceCaches.every((cache) => typeof cache?.total === "number");
    const total = exactTotal
        ? sourceCaches.reduce((sum, cache) => sum + (cache?.total || 0), 0)
        : filtered.length;

    return {
        items: filtered.slice((normalizedPage - 1) * normalizedPageSize, normalizedPage * normalizedPageSize),
        tags: collectTags(withoutTagFilter),
        categories,
        total,
        hasMore,
        totalExact: exactTotal,
    };
}

export async function fetchSourcePrompts(sourceId: string): Promise<Prompt[]> {
    const source = usePromptSourceStore.getState().sources.find((item) => item.id === sourceId);
    if (!source) throw new Error(i18n.t("prompts.sourceMissing"));
    return getSourcePrompts(source, source.pagination === "remote" ? 60 : 0);
}

export async function refreshSource(sourceId: string): Promise<PromptSourceRefreshResult> {
    const source = usePromptSourceStore.getState().sources.find((item) => item.id === sourceId);
    if (!source) throw new Error(i18n.t("prompts.sourceMissing"));
    const result = await getOrStartRefresh(source);
    if (!result.success) throw new Error(result.lastError);
    return result;
}

export async function refreshAllSources(): Promise<PromptSourceRefreshSummary> {
    const results = await Promise.all(enabledSources().map(getOrStartRefresh));
    return summarizeRefresh(results);
}

export async function refreshDueSources(maxAgeMs: number): Promise<PromptSourceRefreshSummary> {
    const sources = await Promise.all(
        enabledSources().map(async (source) => {
            const cached = await readSourceCache(source.id);
            const lastSuccess = cached?.lastSuccessAt ? new Date(cached.lastSuccessAt).getTime() : 0;
            return !lastSuccess || Boolean(cached?.lastError) || Date.now() - lastSuccess >= maxAgeMs || cached?.signature !== sourceSignature(source) ? source : null;
        }),
    );
    const results = await Promise.all(sources.filter((source): source is PromptSource => Boolean(source)).map(getOrStartRefresh));
    return summarizeRefresh(results);
}

export async function fetchPromptSourceStatuses(): Promise<Record<string, PromptSourceStatus>> {
    const entries = await Promise.all(
        usePromptSourceStore.getState().sources.map(async (source) => {
            let cache = await readSourceCache(source.id);
            const stale = cache?.signature !== sourceSignature(source);
            if (source.enabled && source.pagination === "remote" && (!cache?.total || stale)) {
                try {
                    await getSourcePrompts(source);
                    cache = await readSourceCache(source.id);
                } catch {
                    // 状态查询失败时保留已有缓存和错误信息。
                }
            }
            return [source.id, {
                sourceId: source.id,
                count: cache?.items?.length || 0,
                lastSuccessAt: cache?.lastSuccessAt || "",
                lastError: cache?.lastError || "",
                hasMore: source.pagination === "remote" && (Boolean(stale) || cache?.hasMore === true),
                total: cache?.total,
            }] as const;
        }),
    );
    return Object.fromEntries(entries);
}

function summarizeRefresh(results: PromptSourceRefreshResult[]): PromptSourceRefreshSummary {
    return {
        results,
        total: results.reduce((total, item) => total + (item.total ?? item.count), 0),
        successCount: results.filter((item) => item.success).length,
        failureCount: results.filter((item) => !item.success).length,
    };
}

function filterPrompts(items: Prompt[], options: { keyword: string; category: string; tags: string[] }) {
    return items.filter((item) => {
        if (isActiveOption(options.category) && item.category !== options.category) return false;
        if (options.tags.length && !options.tags.some((tag) => item.tags.includes(tag))) return false;
        if (!options.keyword) return true;
        return [item.title, item.prompt, item.description, item.category, ...item.tags].join(" ").toLowerCase().includes(options.keyword);
    });
}

function collectTags(items: Prompt[]) {
    return Array.from(new Set(items.flatMap((item) => item.tags).filter(Boolean)));
}

function isActiveOption(value: string) {
    return value && value !== ALL_PROMPTS_OPTION && value !== "all";
}

export function formatPromptDate(value: string, locale?: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
