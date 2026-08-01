import { describe, expect, it } from "vitest";
import { createDemoState } from "../domain/demo-data";
import { buildAgentPrompt } from "./prompt-builder";

describe("buildAgentPrompt", () => {
  it("includes relevant memories and explicit safety boundaries", () => {
    const state = createDemoState();
    const prompt = buildAgentPrompt(state, state.routines[0]);

    expect(prompt).toContain("林阿姨");
    expect(prompt).toContain("早 · 08:30");
    expect(prompt).toContain("不识别药片");
    expect(prompt).toContain("待家属查看");
  });

  it("excludes sensitive medication and person memories after consent is revoked", () => {
    const state = createDemoState();
    state.consent.sensitiveMemoryApproved = false;
    const prompt = buildAgentPrompt(state, state.routines[0]);

    expect(prompt).not.toContain("早上的白盒");
    expect(prompt).not.toContain("第一联系人，每周三");
    expect(prompt).toContain("眼镜通常放在");
  });
});
