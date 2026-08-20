import { describe, expect, it } from "vitest";
import { createRealtimeSessionInit } from "./session-configuration";

describe("realtime session configuration", () => {
  it("sends the effective prompt with the concise cross-client default", () => {
    expect(createRealtimeSessionInit("服务端最终提示词", null)).toEqual({
      type: "session.init",
      payload: {
        system_prompt: "服务端最终提示词",
        config: { length_penalty: 1.0 },
      },
    });
  });
});
