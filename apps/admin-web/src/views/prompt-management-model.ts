import type {
  CompanionPrompt,
  PublishCompanionPromptInput,
} from "../types/platform";

export const PROMPT_TEMPLATE_MAX_CHARACTERS = 4_000;
export const PROMPT_REASON_MAX_CHARACTERS = 100;

export function normalizePromptContent(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const permittedWhitespace =
      codePoint === 0x09 || codePoint === 0x0a || codePoint === 0x0d;
    return (codePoint <= 0x1f && !permittedWhitespace) || codePoint === 0x7f
      ? " "
      : character;
  })
    .join("")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

export function promptCharacterCount(value: string): number {
  return Array.from(normalizePromptContent(value)).length;
}

export function promptReasonCharacterCount(value: string): number {
  return Array.from(value.trim()).length;
}

export function promptHasUnsavedChanges(
  current: CompanionPrompt | null,
  draft: string,
): boolean {
  return current !== null && normalizePromptContent(draft) !== current.content;
}

export function promptCanBePublished(
  current: CompanionPrompt | null,
  draft: string,
  reason: string,
): boolean {
  if (!current) return false;
  const content = normalizePromptContent(draft);
  const normalizedReason = reason.trim();
  return (
    content.length > 0 &&
    Array.from(content).length <= PROMPT_TEMPLATE_MAX_CHARACTERS &&
    content !== current.content &&
    normalizedReason.length > 0 &&
    promptReasonCharacterCount(normalizedReason) <= PROMPT_REASON_MAX_CHARACTERS
  );
}

export function buildPromptPublication(
  current: CompanionPrompt,
  draft: string,
  reason: string,
): PublishCompanionPromptInput {
  return {
    expectedCurrentPromptId: current.id,
    content: normalizePromptContent(draft),
    reason: reason.trim(),
  };
}
