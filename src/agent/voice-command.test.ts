import { describe, expect, it } from "vitest";
import { classifyVoiceCommand } from "./voice-command";

describe("classifyVoiceCommand", () => {
  it.each([
    ["我已经完成了", "confirm"],
    ["刚才没听清，再说一遍", "repeat"],
    ["帮我联系女儿", "family"],
    ["我还没完成了", null],
    ["我不确定是不是已经完成了", null],
    ["完成了吗", null],
    ["不要联系女儿", null],
    ["先别重复一遍", null],
    ["我没完成，帮我联系女儿", "family"],
    ["今天天气怎么样", null],
  ])("classifies %s", (transcript, expected) => {
    expect(classifyVoiceCommand(transcript)).toBe(expected);
  });
});
