import { Button, Drawer, Input, Segmented, Select, Space } from "antd";
import { CheckCircle2, ExternalLink, ListPlus, Loader2, Radar, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchChannelProbe } from "@/services/api/channel-protocol";
import { defaultBaseUrlForApiFormat, guessCapability, keyApplicationUrlForApiFormat, normalizeChannelModels, recommendedChannelModels, type ApiCallFormat, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";
import { ModelScriptEditor } from "./model-script-editor";
import { ModelSelectModal } from "./model-select-modal";

type ScriptTarget = { name: string; capability: ModelCapability; value: string };
type TestState = { kind: "idle" | "testing" | "success" | "error"; action?: "address" | "protocol"; message?: string };

export function ChannelEditorDrawer({ open, channel, onSave, onClose }: { open: boolean; channel: ModelChannel | null; onSave: (channel: ModelChannel) => void; onClose: () => void }) {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ModelChannel | null>(channel);
    const [selectOpen, setSelectOpen] = useState(false);
    const [scriptTarget, setScriptTarget] = useState<ScriptTarget | null>(null);
    const [testState, setTestState] = useState<TestState>({ kind: "idle" });
    const apiFormatOptions: Array<{ label: string; value: ApiCallFormat }> = [
        { label: "OpenAI", value: "openai" },
        { label: "Anthropic", value: "anthropic" },
        { label: "Gemini", value: "gemini" },
        { label: "ModelScope 免费/试用推荐", value: "modelscope" },
        { label: "Agnes AI", value: "agnes" },
    ];
    const capabilityOptions: Array<{ label: string; value: ModelCapability }> = ["image", "video", "text", "audio"].map((value) => ({ label: t(`config.channelEditor.capabilities.${value}`), value: value as ModelCapability }));

    useEffect(() => {
        if (open && channel) setDraft(channel);
        if (open) setTestState({ kind: "idle" });
    }, [open, channel]);

    if (!draft) return null;

    const patch = (value: Partial<ModelChannel>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const setModels = (models: ChannelModel[]) => patch({ models });
    const keyApplicationUrl = keyApplicationUrlForApiFormat(draft.apiFormat);

    const changeApiFormat = (apiFormat: ApiCallFormat) => {
        const baseUrl = !draft.baseUrl.trim() || draft.baseUrl.trim() === defaultBaseUrlForApiFormat(draft.apiFormat) ? defaultBaseUrlForApiFormat(apiFormat) : draft.baseUrl;
        patch({ apiFormat, baseUrl, models: draft.models.length ? draft.models : recommendedChannelModels(apiFormat) });
        setTestState({ kind: "idle" });
    };

    const runProbe = async (action: "address" | "protocol") => {
        if (!draft.baseUrl.trim()) {
            setTestState({ kind: "error", action, message: "请先填写请求地址" });
            return;
        }
        if (!draft.apiKey.trim()) {
            setTestState({ kind: "error", action, message: "请先填写 API Key" });
            return;
        }
        setTestState({ kind: "testing", action });
        try {
            const result = await fetchChannelProbe(draft);
            if (action === "address" && result.models.length) {
                const existing = new Map(draft.models.map((model) => [model.name, model]));
                setModels(result.models.map((name) => existing.get(name) || { name, capability: guessCapability(name) }));
            }
            setTestState({ kind: "success", action, message: `${action === "address" ? "地址" : "协议"}验证通过 · 返回 ${result.count} 个模型` });
        } catch (error) {
            setTestState({ kind: "error", action, message: error instanceof Error ? error.message : "验证失败，请检查地址、Key 和协议" });
        }
    };

    const applySelection = (names: string[]) => {
        const map = new Map(draft.models.map((model) => [model.name, model]));
        setModels(names.map((name) => map.get(name) || { name, capability: guessCapability(name) }));
    };

    const setCapability = (name: string, capability: ModelCapability) => setModels(draft.models.map((model) => (model.name === name ? { ...model, capability } : model)));
    const setScript = (name: string, script: string) => setModels(draft.models.map((model) => (model.name === name ? { ...model, script: script || undefined } : model)));
    const removeModel = (name: string) => setModels(draft.models.filter((model) => model.name !== name));

    const save = () => {
        onSave({ ...draft, name: draft.name.trim() || t("config.channels.unnamed"), models: normalizeChannelModels(draft.models) });
        onClose();
    };

    return (
        <Drawer
            open={open}
            width={720}
            title={t("config.channelEditor.title")}
            onClose={onClose}
            styles={{ body: { paddingTop: 16, background: "var(--ant-color-bg-layout)" } }}
            extra={
                <Space>
                    <Button onClick={onClose}>{t("common.cancel")}</Button>
                    <Button type="primary" onClick={save}>
                        {t("common.save")}
                    </Button>
                </Space>
            }
        >
            <div className="space-y-4">
                <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
                    <div className="mb-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                        <div className="text-xs font-black uppercase tracking-[0.12em]">基本信息</div>
                        <div className="mt-1 text-xs text-stone-500">平台名称、协议和请求地址</div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-stone-500">平台名称</span>
                            <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} placeholder="例如：我的中转站" />
                            <span className="mt-1 block text-[11px] text-stone-500">
                                平台 ID：<code>{draft.id}</code>
                            </span>
                        </label>
                        <label className="block">
                            <span className="mb-1 block text-xs font-semibold text-stone-500">协议</span>
                            <Select className="w-full" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                        </label>
                        <label className="block md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold text-stone-500">请求地址</span>
                            <Input value={draft.baseUrl} onChange={(event) => patch({ baseUrl: event.target.value })} placeholder="https://sub2api.leefun.top" />
                        </label>
                    </div>
                </section>

                <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
                    <div className="mb-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                        <div className="text-xs font-black uppercase tracking-[0.12em]">API Key</div>
                        <div className="mt-1 text-xs text-stone-500">Key 只保存在当前浏览器配置中</div>
                    </div>
                    <div className="flex gap-2">
                        <Input.Password className="flex-1" value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} placeholder="输入 API Key" />
                        {keyApplicationUrl ? (
                            <Button icon={<ExternalLink className="size-3.5" />} href={keyApplicationUrl} target="_blank" rel="noreferrer">
                                {t("config.channelEditor.applyKey")}
                            </Button>
                        ) : null}
                    </div>
                </section>

                <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
                    <div className="mb-3 border-b border-stone-200 pb-3 dark:border-stone-800">
                        <div className="text-xs font-black uppercase tracking-[0.12em]">连接测试</div>
                        <div className="mt-1 text-xs text-stone-500">先验证地址，再确认所选协议能返回模型列表</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button
                            icon={testState.kind === "testing" && testState.action === "address" ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}
                            loading={testState.kind === "testing" && testState.action === "address"}
                            onClick={() => void runProbe("address")}
                        >
                            验证地址
                        </Button>
                        <Button
                            icon={testState.kind === "testing" && testState.action === "protocol" ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />}
                            loading={testState.kind === "testing" && testState.action === "protocol"}
                            onClick={() => void runProbe("protocol")}
                        >
                            验证协议
                        </Button>
                        <Select className="min-w-48" value={draft.apiFormat} options={apiFormatOptions} onChange={changeApiFormat} />
                    </div>
                    {testState.kind !== "idle" && testState.kind !== "testing" ? (
                        <div
                            className={`mt-3 rounded-lg border px-3 py-2 text-xs font-semibold ${testState.kind === "success" ? "border-green-200 bg-green-50 text-green-700 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-300" : "border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-300"}`}
                        >
                            {testState.message}
                        </div>
                    ) : null}
                </section>

                <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm dark:border-stone-800 dark:bg-stone-950">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 pb-3 dark:border-stone-800">
                        <div>
                            <div className="text-xs font-black uppercase tracking-[0.12em]">{t("config.channelEditor.models")}</div>
                            <div className="mt-1 text-xs text-stone-500">{t("config.channelEditor.modelDescription", { count: draft.models.length })}</div>
                        </div>
                        <Button type="primary" icon={<ListPlus className="size-4" />} onClick={() => setSelectOpen(true)}>
                            {t("config.channelEditor.selectModels")}
                        </Button>
                    </div>
                    <div className="space-y-2 rounded-lg border border-stone-200 p-2 dark:border-stone-800">
                        {draft.models.length ? (
                            draft.models.map((model) => (
                                <div key={model.name} className="flex flex-wrap items-center gap-3 rounded-md px-2 py-1.5 hover:bg-stone-50 dark:hover:bg-stone-900/40">
                                    <span className="min-w-0 flex-1 truncate text-sm" title={model.name}>
                                        {model.name}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-2">
                                        <Segmented size="small" value={model.capability} options={capabilityOptions} onChange={(value) => setCapability(model.name, value as ModelCapability)} />
                                        <Button size="small" type={model.script ? "primary" : "default"} ghost={Boolean(model.script)} onClick={() => setScriptTarget({ name: model.name, capability: model.capability, value: model.script || "" })}>
                                            {t(model.script ? "config.channelEditor.scriptReady" : "config.channelEditor.script")}
                                        </Button>
                                        <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => removeModel(model.name)} />
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div className="px-2 py-8 text-center text-sm text-stone-500">{t("config.channelEditor.empty")}</div>
                        )}
                    </div>
                </section>
            </div>

            <ModelSelectModal open={selectOpen} channel={draft} selectedNames={draft.models.map((model) => model.name)} onConfirm={applySelection} onClose={() => setSelectOpen(false)} />
            <ModelScriptEditor
                open={Boolean(scriptTarget)}
                capability={scriptTarget?.capability || "text"}
                modelName={scriptTarget?.name || ""}
                value={scriptTarget?.value || ""}
                onSave={(script) => scriptTarget && setScript(scriptTarget.name, script)}
                onClose={() => setScriptTarget(null)}
            />
        </Drawer>
    );
}
