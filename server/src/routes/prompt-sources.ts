import type { Express, NextFunction, Request, Response } from "express";

const ROSE_IMAGE_PROMPTS_API = "https://prompts.sorry.ink/api/prompts";
const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;
const MAX_SOURCE_SCAN_PAGES = 600;

const SOURCE_SITE_ALIASES: Record<string, string[]> = {
  "Liblib Inspiration": ["Liblib Inspiration"],
  "YouMind GPT Image 2 Prompts": ["YouMind GPT Image 2 Prompts"],
  "AI2Image GPT Image 2": ["AI2Image GPT Image 2", "AI2Image GPT Image 2 分类页"],
  "Nanobanana Website Vercel": ["Nanobanana Website Vercel"],
  NanoBananaPrompt: ["NanoBananaPrompt"],
};

type JsonRecord = Record<string, unknown>;

type RemoteImage = {
  remoteUrl?: string | null;
  width?: number | null;
  height?: number | null;
};

type RemotePromptSummary = {
  id?: string;
  slug?: string;
  title?: unknown;
  category?: { slug?: string; name?: unknown };
  tags?: Array<{ slug?: string; name?: unknown }>;
  aspectRatio?: string | null;
  primaryImage?: RemoteImage | null;
  contributor?: { name?: string | null } | null;
  sourceSite?: string | null;
  sourceUrl?: string | null;
};

type RemotePromptDetail = RemotePromptSummary & {
  prompt?: unknown;
  negativePrompt?: unknown;
  notes?: unknown;
  images?: Array<RemoteImage & { altText?: string | null }>;
  createdAt?: string;
  updatedAt?: string;
  approvedAt?: string;
};

type SourceIndex = {
  summaries: RemotePromptSummary[];
  nextRemotePage: number;
  complete: boolean;
  loading: Promise<void> | null;
};

const sourceIndexes = new Map<string, SourceIndex>();
const promptDetails = new Map<string, Promise<RemotePromptDetail>>();

class PromptSourceError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "PromptSourceError";
  }
}

function route(handler: (request: Request, response: Response) => Promise<void>) {
  return (request: Request, response: Response, next: NextFunction) => {
    void handler(request, response).catch(next);
  };
}

async function readJson(response: globalThis.Response): Promise<JsonRecord> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    return { message: text };
  }
}

async function fetchJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": "infinite-canvas-prompt-source" },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await readJson(response);
  if (!response.ok) {
    const message = typeof payload.message === "string" ? payload.message : `Image-Prompts 请求失败（${response.status}）`;
    throw new PromptSourceError(502, message);
  }
  return payload;
}

function queryValue(request: Request, key: string) {
  const value = request.query[key];
  return typeof value === "string" ? value.trim() : "";
}

function remoteListUrl(request: Request, pageOverride?: number, pageSizeOverride?: number) {
  const url = new URL(ROSE_IMAGE_PROMPTS_API);
  const page = pageOverride ?? Math.max(1, Number.parseInt(queryValue(request, "page") || "1", 10) || 1);
  const requestedPageSize = Number.parseInt(queryValue(request, "pageSize") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const pageSize = pageSizeOverride ?? Math.max(1, Math.min(MAX_PAGE_SIZE, requestedPageSize));
  url.searchParams.set("page", String(page));
  url.searchParams.set("pageSize", String(pageSize));
  for (const key of ["category", "tag", "aspect", "sort", "q"]) {
    const value = queryValue(request, key);
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

function requestedPage(request: Request) {
  return Math.max(1, Number.parseInt(queryValue(request, "page") || "1", 10) || 1);
}

function requestedPageSize(request: Request) {
  const value = Number.parseInt(queryValue(request, "pageSize") || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, value));
}

function sourceIndexKey(request: Request, sourceSite: string) {
  const filters = ["category", "tag", "aspect", "sort", "q"].map((key) => `${key}=${queryValue(request, key)}`);
  return `${sourceSite}\n${filters.join("\n")}`;
}

function appendSourceSummaries(index: SourceIndex, sourceSite: string, pageItems: RemotePromptSummary[]) {
  const known = new Set(index.summaries.map((summary) => String(summary.id || summary.slug || "")));
  for (const summary of pageItems) {
    const key = String(summary.id || summary.slug || "");
    if (sourceMatches(summary, sourceSite) && key && !known.has(key)) {
      known.add(key);
      index.summaries.push(summary);
    }
  }
}

function sourceMatches(summary: RemotePromptSummary, sourceSite: string) {
  const aliases = SOURCE_SITE_ALIASES[sourceSite] || [sourceSite];
  const actual = typeof summary.sourceSite === "string" ? summary.sourceSite.trim().toLocaleLowerCase() : "";
  return aliases.some((alias) => actual === alias.toLocaleLowerCase());
}

async function loadNextSourceIndexPage(request: Request, sourceSite: string, index: SourceIndex) {
  if (index.complete || index.nextRemotePage > MAX_SOURCE_SCAN_PAGES) {
    index.complete = true;
    return;
  }
  const listPayload = await fetchJson(remoteListUrl(request, index.nextRemotePage, MAX_PAGE_SIZE).toString());
  index.nextRemotePage += 1;
  const pageItems = Array.isArray(listPayload.items) ? listPayload.items as RemotePromptSummary[] : [];
  appendSourceSummaries(index, sourceSite, pageItems);
  if (pageItems.length < MAX_PAGE_SIZE || listPayload.hasMore === false) index.complete = true;
}

async function sourceIndexUntil(request: Request, sourceSite: string, itemCount: number) {
  const key = sourceIndexKey(request, sourceSite);
  const index = sourceIndexes.get(key) || {
    summaries: [],
    nextRemotePage: 1,
    complete: false,
    loading: null,
  };
  sourceIndexes.set(key, index);
  while (!index.complete && index.summaries.length < itemCount) {
    if (!index.loading) {
      index.loading = loadNextSourceIndexPage(request, sourceSite, index).finally(() => {
        index.loading = null;
      });
    }
    await index.loading;
  }
  return index;
}

async function completeSourceIndex(request: Request, sourceSite: string) {
  const key = sourceIndexKey(request, sourceSite);
  const index = sourceIndexes.get(key) || {
    summaries: [],
    nextRemotePage: 1,
    complete: false,
    loading: null,
  };
  sourceIndexes.set(key, index);
  if (index.complete) return index;
  if (!index.loading) {
    index.loading = (async () => {
      const firstPayload = await fetchJson(remoteListUrl(request, 1, MAX_PAGE_SIZE).toString());
      const firstItems = Array.isArray(firstPayload.items) ? firstPayload.items as RemotePromptSummary[] : [];
      const total = typeof firstPayload.total === "number" ? firstPayload.total : 0;
      const totalPages = total > 0 ? Math.ceil(total / MAX_PAGE_SIZE) : 1;
      const pageNumbers = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 2);
      const pages = await mapWithConcurrency(pageNumbers, 20, async (page) => {
        const payload = await fetchJson(remoteListUrl(request, page, MAX_PAGE_SIZE).toString());
        return Array.isArray(payload.items) ? payload.items as RemotePromptSummary[] : [];
      });
      index.summaries = [];
      appendSourceSummaries(index, sourceSite, firstItems);
      pages.forEach((pageItems) => appendSourceSummaries(index, sourceSite, pageItems));
      index.nextRemotePage = totalPages + 1;
      index.complete = true;
    })().finally(() => {
      index.loading = null;
    });
  }
  await index.loading;
  return index;
}

function bilingualText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const record = value as JsonRecord;
  const zh = typeof record.zh === "string" ? record.zh.trim() : "";
  const en = typeof record.en === "string" ? record.en.trim() : "";
  if (zh && en && zh !== en) return `${zh}\n\n${en}`;
  return zh || en;
}

function imageUrl(image: RemoteImage | null | undefined) {
  return typeof image?.remoteUrl === "string" && /^https?:\/\//i.test(image.remoteUrl) ? image.remoteUrl : "";
}

function sourceUrl(summary: RemotePromptSummary, detail: RemotePromptDetail) {
  if (detail.sourceUrl || summary.sourceUrl) return detail.sourceUrl || summary.sourceUrl || "";
  const slug = detail.slug || summary.slug;
  return slug ? `https://prompts.sorry.ink/zh/prompts/${encodeURIComponent(slug)}` : "https://prompts.sorry.ink/";
}

function normalizePrompt(summary: RemotePromptSummary, detail: RemotePromptDetail) {
  const images = (detail.images || []).map(imageUrl).filter(Boolean);
  const coverUrl = imageUrl(detail.primaryImage) || imageUrl(summary.primaryImage) || images[0] || "";
  const category = detail.category || summary.category;
  const categoryName = bilingualText(category?.name);
  const categorySlug = typeof category?.slug === "string" ? category.slug.trim() : "";
  const tags = (detail.tags || summary.tags || []).flatMap((tag) => {
    const name = bilingualText(tag.name);
    const slug = typeof tag.slug === "string" ? tag.slug.trim() : "";
    return [name, slug].filter(Boolean);
  });
  const prompt = bilingualText(detail.prompt);
  const title = bilingualText(detail.title || summary.title);
  if (!title || !prompt) return null;
  return {
    id: detail.id || summary.id || detail.slug || summary.slug || "",
    title,
    prompt,
    description: bilingualText(detail.notes),
    coverUrl,
    referenceImageUrls: images,
    tags: Array.from(new Set([categoryName, categorySlug, ...tags].filter(Boolean))),
    preview: coverUrl,
    createdAt: detail.createdAt || detail.approvedAt || "",
    updatedAt: detail.updatedAt || detail.approvedAt || detail.createdAt || "",
    author: typeof detail.contributor === "object" && detail.contributor && typeof (detail.contributor as JsonRecord).name === "string" ? String((detail.contributor as JsonRecord).name) : "",
    sourceUrl: sourceUrl(summary, detail),
    sourceSite: detail.sourceSite || summary.sourceSite || "",
    imageSize: detail.aspectRatio || summary.aspectRatio || undefined,
  };
}

async function mapWithConcurrency<T, R>(values: T[], limit: number, mapper: (value: T) => Promise<R | null>) {
  const result: Array<R | null> = Array.from({ length: values.length }, () => null);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      const value = await mapper(values[index]);
      result[index] = value;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return result.filter((value): value is R => Boolean(value));
}

function fetchPromptDetail(slug: string) {
  const current = promptDetails.get(slug);
  if (current) return current;
  const request = fetchJson(`${ROSE_IMAGE_PROMPTS_API}/${encodeURIComponent(slug)}`) as Promise<RemotePromptDetail>;
  promptDetails.set(slug, request);
  return request;
}

async function fetchRosePrompts(request: Request, response: Response) {
  const sourceSite = queryValue(request, "sourceSite");
  const pageSize = requestedPageSize(request);
  const page = requestedPage(request);
  let summaries: RemotePromptSummary[] = [];
  if (sourceSite) {
    const offset = (page - 1) * pageSize;
    const index = queryValue(request, "fullIndex") === "true"
      ? await completeSourceIndex(request, sourceSite)
      : await sourceIndexUntil(request, sourceSite, offset + pageSize + 1);
    summaries = index.summaries.slice(offset, offset + pageSize);
    response.set("x-prompt-source-has-more", String(!index.complete || index.summaries.length > offset + pageSize));
    if (index.complete) response.set("x-prompt-source-total", String(index.summaries.length));
  } else {
    const listPayload = await fetchJson(remoteListUrl(request).toString());
    summaries = Array.isArray(listPayload.items) ? listPayload.items as RemotePromptSummary[] : [];
  }
  if (!summaries.length) {
    response.json([]);
    return;
  }
  const items = await mapWithConcurrency(summaries, 6, async (summary) => {
    const slug = typeof summary.slug === "string" ? summary.slug.trim() : "";
    if (!slug) return null;
    try {
      const detail = await fetchPromptDetail(slug);
      return normalizePrompt(summary, detail);
    } catch {
      return null;
    }
  });
  if (!items.length) throw new PromptSourceError(502, "Image-Prompts 没有返回可用提示词详情");
  response.set("cache-control", "public, max-age=300").json(items);
}

export function registerPromptSourceRoutes(app: Express) {
  app.get("/api/prompt-sources/rose-image-prompts", route(fetchRosePrompts));
}
