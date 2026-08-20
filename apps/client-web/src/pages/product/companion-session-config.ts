import type { ModelConnectionView } from "../../api/types";

export type CompanionRuntimeConfiguration = {
  runtime: {
    prompt: string;
    realtimeWs: string;
    model: string;
  };
  summary: string;
};

export const formatCompanionContextSummary = (
  memoryCount: number,
  routineCount: number,
): string =>
  memoryCount > 0 && routineCount > 0
    ? `已准备 ${memoryCount} 条记忆和 ${routineCount} 项日程`
    : memoryCount > 0
      ? `已准备 ${memoryCount} 条记忆`
      : routineCount > 0
        ? `已准备 ${routineCount} 项日程`
        : "陪伴已准备";

export const resolveCompanionSessionConfiguration = (
  response: ModelConnectionView,
): CompanionRuntimeConfiguration => {
  if (!response.prompt.content.trim()) {
    throw new Error("服务器未返回有效的陪伴配置");
  }
  const snapshot = response.careSnapshot as
    | ModelConnectionView["careSnapshot"]
    | undefined;
  const memoryCount = snapshot?.memories.length ?? 0;
  const routineCount = snapshot?.occurrences.length ?? 0;
  const summary = formatCompanionContextSummary(memoryCount, routineCount);

  return {
    runtime: {
      prompt: response.prompt.content,
      realtimeWs: response.connection.realtimeUrl,
      model: response.connection.model,
    },
    summary,
  };
};
