import { describe, expect, it } from "vitest";

import {
  buildPromptPublication,
  promptCanBePublished,
  promptHasUnsavedChanges,
  promptReasonCharacterCount,
} from "./prompt-management-model";

const current = {
  id: "01K1P000000000000000000001",
  code: "COMPANION_SYSTEM",
  composerVersion: 3,
  provider: "modelbest",
  model: "openbmb/MiniCPM-o-4_5",
  content: "当前提示词",
  contentHash: "abcd",
  publishedAt: "2026-08-24T08:00:00.000Z",
};

describe("prompt management form", () => {
  it("requires a changed non-empty prompt and a publication reason", () => {
    expect(promptCanBePublished(current, "当前提示词", "调整回复")).toBe(false);
    expect(promptCanBePublished(current, "新的提示词", "")).toBe(false);
    expect(promptCanBePublished(current, "   ", "调整回复")).toBe(false);
    expect(promptCanBePublished(current, "新的提示词", "调整回复")).toBe(true);
  });

  it("builds a stale-write-safe publication command", () => {
    expect(
      buildPromptPublication(
        current,
        "  新的提示词\r\n第二行  ",
        "  减少冗长  ",
      ),
    ).toEqual({
      expectedCurrentPromptId: current.id,
      content: "新的提示词\n第二行",
      reason: "减少冗长",
    });
  });

  it("uses Unicode characters for the 100-character publication reason limit", () => {
    const accepted = "🙂".repeat(100);
    expect(promptReasonCharacterCount(accepted)).toBe(100);
    expect(promptCanBePublished(current, "新的提示词", accepted)).toBe(true);
    expect(promptCanBePublished(current, "新的提示词", `${accepted}🙂`)).toBe(
      false,
    );
  });

  it("does not mark line-ending-only edits as an unsaved draft", () => {
    const multiline = { ...current, content: "第一行\n第二行" };
    expect(promptHasUnsavedChanges(multiline, "  第一行\r\n第二行  ")).toBe(
      false,
    );
    expect(promptHasUnsavedChanges(multiline, "第一行\n新内容")).toBe(true);
  });
});
