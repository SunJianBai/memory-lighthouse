import type { FamilyTaskView } from "./types";

export type FamilyTaskBoardItem = FamilyTaskView & {
  sourceTitle: string;
  sourceSummary: string;
  assigneeDisplayName: string | null;
  assignedToMe: boolean;
  canClaim: boolean;
  canFinish: boolean;
};

export const taskFilters = [
  { id: "unfinished", label: "全部未完成", empty: "暂无未完成待办" },
  { id: "unclaimed", label: "待认领", empty: "暂无待认领事项" },
  { id: "mine", label: "我负责", empty: "暂无由你负责的未完成事项" },
  { id: "ended", label: "已结束", empty: "暂无已结束事项" },
] as const;
export type TaskFilter = (typeof taskFilters)[number]["id"];
export function filterFamilyTasks(
  tasks: FamilyTaskBoardItem[],
  filter: TaskFilter,
) {
  return tasks.filter((task) => {
    const unfinished = task.status === "OPEN" || task.status === "CLAIMED";
    if (filter === "unclaimed")
      return task.status === "OPEN" && !task.assigneeMemberId;
    if (filter === "mine") return unfinished && task.assignedToMe;
    if (filter === "ended")
      return task.status === "RESOLVED" || task.status === "DISMISSED";
    return unfinished;
  });
}

const statusLabels = new Map([
  ["OPEN", "待认领"],
  ["CLAIMED", "处理中"],
  ["RESOLVED", "已完成"],
  ["DISMISSED", "不再处理"],
]);
const resolutionLabels = new Map([
  ["FAMILY_CONFIRMED", "家属已确认处理"],
  ["NOT_ACTIONABLE", "无需继续处理"],
  ["FAMILY_VERIFIED_COMPLETE", "家属核验为完成"],
  ["FAMILY_VERIFIED_NOT_COMPLETE", "家属核验为未完成"],
]);
const priorityLabels = new Map([
  ["LOW", "低优先级"],
  ["NORMAL", "普通"],
  ["HIGH", "高优先级"],
  ["URGENT", "紧急"],
]);
export const taskStatusLabel = (status: string) =>
  statusLabels.get(status) ?? "状态待核对";
export const taskResolutionLabel = (code: string | null) =>
  !code ? "未记录具体结果" : (resolutionLabels.get(code) ?? "已记录处理结果");

export const taskPriorityLabel = (priority: string) =>
  priorityLabels.get(priority) ?? "优先级待核对";

/** Validate before rendering. A malformed or foreign response is not an empty board. */
export function parseFamilyTaskBoard(
  value: unknown,
  householdId: string,
  recipientId: string,
): FamilyTaskBoardItem[] {
  const invalid = () => new Error("待办数据不完整或已变更，请刷新重试");
  if (!value || typeof value !== "object") throw invalid();
  const board = value as Record<string, unknown>;
  if (
    board.householdId !== householdId ||
    board.recipientId !== recipientId ||
    !Array.isArray(board.tasks)
  )
    throw invalid();
  const ids = new Set<string>();
  return board.tasks.map((value: unknown) => {
    if (!value || typeof value !== "object") throw invalid();
    const item = value as Record<string, unknown>;
    if (item.householdId !== householdId || item.recipientId !== recipientId)
      throw invalid();
    for (const key of [
      "id",
      "sourceEventId",
      "sourceTitle",
      "sourceSummary",
      "priority",
      "status",
      "createdAt",
      "updatedAt",
    ]) {
      if (typeof item[key] !== "string") throw invalid();
    }
    if (
      !(item.id as string).trim() ||
      !(item.sourceTitle as string).trim() ||
      ids.has(item.id as string)
    )
      throw invalid();
    ids.add(item.id as string);
    if (
      !["OPEN", "CLAIMED", "RESOLVED", "DISMISSED"].includes(
        item.status as string,
      )
    )
      throw invalid();
    for (const key of ["assignedToMe", "canClaim", "canFinish"])
      if (typeof item[key] !== "boolean") throw invalid();
    for (const key of [
      "assigneeMemberId",
      "assigneeDisplayName",
      "resolutionCode",
      "resolutionNote",
      "dueAt",
      "resolvedAt",
    ]) {
      if (item[key] !== null && typeof item[key] !== "string") throw invalid();
    }
    for (const key of ["dueAt", "resolvedAt", "createdAt", "updatedAt"]) {
      if (
        item[key] !== null &&
        !Number.isFinite(Date.parse(item[key] as string))
      )
        throw invalid();
    }
    if (!Number.isInteger(item.version) || (item.version as number) < 0)
      throw invalid();
    return item as FamilyTaskBoardItem;
  });
}
