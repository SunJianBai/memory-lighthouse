import { describe, expect, it } from "vitest";
import type { ModelConnectionView } from "../../api/types";
import { resolveCompanionSessionConfiguration } from "./companion-session-config";

const modelResponse = {
  session: { id: "model-1", companionSessionId: "companion-1", status: "CREATED" },
  connection: {
    realtimeUrl: "wss://server.example.com/v1/realtime",
    model: "MiniCPM-o-4.5",
  },
  prompt: {
    id: "prompt-3",
    code: "COMPANION_SYSTEM",
    version: 3,
    content: "服务端最终提示词（含本次照护上下文）",
  },
  careSnapshot: {
    capturedAt: "2026-08-20T08:00:00.000Z",
    memories: [{ id: "memory-1" }, { id: "memory-2" }],
    occurrences: [{ id: "occurrence-1" }],
  },
  consent: { decisions: {} },
} as unknown as ModelConnectionView;

describe("companion session configuration", () => {
  it("uses the server effective prompt and connection without rebuilding either locally", () => {
    const resolved = resolveCompanionSessionConfiguration(modelResponse);

    expect(resolved.runtime).toEqual({
      prompt: "服务端最终提示词（含本次照护上下文）",
      realtimeWs: "wss://server.example.com/v1/realtime",
      model: "MiniCPM-o-4.5",
    });
    expect(resolved.summary).toBe("已准备 2 条记忆和 1 项日程");
  });

  it("rejects an empty effective prompt instead of silently falling back to client text", () => {
    expect(() =>
      resolveCompanionSessionConfiguration({
        ...modelResponse,
        prompt: { ...modelResponse.prompt, content: "   " },
      }),
    ).toThrow("服务器未返回有效的陪伴配置");
  });
});
