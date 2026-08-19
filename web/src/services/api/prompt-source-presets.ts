import { nanoid } from "nanoid";

export type PromptSource = {
    id: string;
    name: string;
    url: string;
    homepage: string;
    enabled: boolean;
    builtIn: boolean;
    pagination?: "remote";
};

export const PROMPT_REGISTRY_HOMEPAGE = "https://github.com/yukkcat/image-prompts";
const PROMPT_REGISTRY_SOURCE_BASE = "https://raw.githubusercontent.com/yukkcat/image-prompts/main/dist/sources";
export const ROSE_IMAGE_PROMPTS_HOMEPAGE = "https://github.com/RoseKhlifa/Image-Prompts";

const ROSE_PROMPT_SOURCE_BASE = "/api/prompt-sources/rose-image-prompts?pageSize=24&sort=latest&fullIndex=true&sourceSite=";

export function createPromptSource(source?: Partial<PromptSource>): PromptSource {
    return {
        id: source?.id?.trim() || nanoid(),
        name: source?.name?.trim() || "",
        url: source?.url?.trim() || "",
        homepage: source?.homepage?.trim() || "",
        enabled: source?.enabled ?? true,
        builtIn: source?.builtIn ?? false,
    };
}

export const DEFAULT_PROMPT_SOURCES: PromptSource[] = [
    roseSource("rose-liblib-inspiration", "Liblib Inspiration", "Liblib Inspiration", "https://www.liblib.art/inspiration", true),
    roseSource("rose-youmind-gpt-image-2", "YouMind GPT Image 2 Prompts", "YouMind GPT Image 2 Prompts", "https://youmind.com/zh-CN/gpt-image-2-prompts"),
    roseSource("rose-ai2image-gpt-image-2", "AI2Image GPT Image 2", "AI2Image GPT Image 2", "https://www.ai2image.cn/category?cat=gptimage2"),
    roseSource("rose-nanobanana-website-vercel", "Nanobanana Website Vercel", "Nanobanana Website Vercel", "https://nanobanana-website.vercel.app/"),
    roseSource("rose-nanobananaprompt", "NanoBananaPrompt", "NanoBananaPrompt", "https://nanobananaprompt.co/zh/prompts"),
    registrySource("banana-prompt-quicker", "Banana Prompt Quicker", "https://glidea.github.io/banana-prompt-quicker/"),
    registrySource("davidwu-gpt-image2-prompts", "DavidWu GPT Image 2", "https://github.com/davidwuw0811-boop/awesome-gpt-image2-prompts"),
    registrySource("freestylefly-gpt-image-2", "Freestylefly GPT Image 2", "https://github.com/freestylefly/awesome-gpt-image-2"),
    registrySource("awesome-gpt-image", "Awesome GPT Image", "https://github.com/ZeroLu/awesome-gpt-image"),
    registrySource("awesome-gpt4o-image-prompts", "Awesome GPT-4o", "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts"),
    registrySource("youmind-gpt-image-2", "YouMind GPT Image 2", "https://github.com/YouMind-OpenLab/awesome-gpt-image-2"),
    registrySource("youmind-nano-banana-pro", "YouMind Nano Banana Pro", "https://github.com/YouMind-OpenLab/awesome-nano-banana-pro-prompts"),
];

function roseSource(id: string, name: string, sourceSite: string, homepage: string, enabled = false): PromptSource {
    return {
        id,
        name,
        url: `${ROSE_PROMPT_SOURCE_BASE}${encodeURIComponent(sourceSite)}`,
        homepage,
        enabled,
        builtIn: true,
        pagination: "remote",
    };
}

function registrySource(id: string, name: string, homepage: string): PromptSource {
    return { id, name, url: `${PROMPT_REGISTRY_SOURCE_BASE}/${id}.json`, homepage, enabled: false, builtIn: true };
}
