import assert from "node:assert/strict";
import { test } from "node:test";

import { channelProtocolProbe } from "./channel-protocol";

test("Anthropic 协议使用 /v1/models 和 Anthropic 请求头", () => {
    const probe = channelProtocolProbe({
        apiFormat: "anthropic",
        baseUrl: "https://sub2api.leefun.top",
        apiKey: "test-key",
    });

    assert.equal(probe.url, "https://sub2api.leefun.top/v1/models");
    assert.deepEqual(probe.headers, {
        "x-api-key": "test-key",
        "anthropic-version": "2023-06-01",
    });
});

test("Gemini 协议使用原生 v1beta 模型地址", () => {
    const probe = channelProtocolProbe({
        apiFormat: "gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        apiKey: "test-key",
    });

    assert.equal(probe.url, "https://generativelanguage.googleapis.com/v1beta/models?key=test-key");
});
