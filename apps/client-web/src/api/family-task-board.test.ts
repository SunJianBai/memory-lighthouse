import { describe, expect, it } from "vitest";
import {
  filterFamilyTasks,
  parseFamilyTaskBoard,
  taskPriorityLabel,
  taskStatusLabel,
  type FamilyTaskBoardItem,
} from "./family-task-board";

export const taskFixture = (
  overrides: Partial<FamilyTaskBoardItem> = {},
): FamilyTaskBoardItem => ({
  id: "task-1",
  householdId: "home",
  recipientId: "elder",
  sourceEventId: "event",
  assigneeMemberId: null,
  status: "OPEN",
  priority: "NORMAL",
  dueAt: null,
  resolvedAt: null,
  resolutionCode: null,
  resolutionNote: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  version: 0,
  sourceTitle: "请联系长者",
  sourceSummary: "核对是否需要帮助",
  assigneeDisplayName: null,
  assignedToMe: false,
  canClaim: true,
  canFinish: true,
  ...overrides,
});
const board = (tasks = [taskFixture()]) => ({
  householdId: "home",
  recipientId: "elder",
  tasks,
});
describe("family task board contract", () => {
  it("keeps priority meanings distinct and aligned with Android", () => {
    expect(["LOW", "NORMAL", "HIGH", "URGENT"].map(taskPriorityLabel)).toEqual([
      "低优先级",
      "普通",
      "高优先级",
      "紧急",
    ]);
    expect(taskPriorityLabel("UNKNOWN")).toBe("优先级待核对");
    for (const unknown of ["__proto__", "constructor", "toString"]) {
      expect(taskPriorityLabel(unknown)).toBe("优先级待核对");
      expect(taskStatusLabel(unknown)).toBe("状态待核对");
    }
  });
  it("accepts a real empty board and does not infer totals from status labels", () => {
    expect(parseFamilyTaskBoard(board([]), "home", "elder")).toEqual([]);
    expect(parseFamilyTaskBoard(board(), "home", "elder")[0].sourceTitle).toBe(
      "请联系长者",
    );
  });
  it("rejects cross-scope snapshots and individual tasks", () => {
    expect(() => parseFamilyTaskBoard(board(), "home-2", "elder")).toThrow();
    expect(() =>
      parseFamilyTaskBoard(
        board([taskFixture({ recipientId: "other" })]),
        "home",
        "elder",
      ),
    ).toThrow();
  });
  it.each([
    { status: "UNKNOWN" },
    { canFinish: "true" },
    { dueAt: "tomorrow" },
    { version: -1 },
    { sourceTitle: "" },
  ])("rejects invalid data %j", (invalid) => {
    expect(() =>
      parseFamilyTaskBoard(
        { ...board(), tasks: [{ ...taskFixture(), ...invalid }] },
        "home",
        "elder",
      ),
    ).toThrow();
  });
  it("rejects duplicate task keys", () => {
    expect(() =>
      parseFamilyTaskBoard(
        board([taskFixture(), taskFixture()]),
        "home",
        "elder",
      ),
    ).toThrow();
  });
  it("filters mine, unclaimed and ended without treating claimed as finished", () => {
    const tasks = [
      taskFixture(),
      taskFixture({
        id: "mine",
        status: "CLAIMED",
        assignedToMe: true,
        assigneeMemberId: "me",
      }),
      taskFixture({
        id: "other",
        status: "CLAIMED",
        assigneeMemberId: "other",
      }),
      taskFixture({ id: "done", status: "RESOLVED", assignedToMe: true }),
      taskFixture({ id: "dismissed", status: "DISMISSED" }),
    ];
    expect(filterFamilyTasks(tasks, "unfinished").map((t) => t.id)).toEqual([
      "task-1",
      "mine",
      "other",
    ]);
    expect(filterFamilyTasks(tasks, "unclaimed").map((t) => t.id)).toEqual([
      "task-1",
    ]);
    expect(filterFamilyTasks(tasks, "mine").map((t) => t.id)).toEqual(["mine"]);
    expect(filterFamilyTasks(tasks, "ended").map((t) => t.id)).toEqual([
      "done",
      "dismissed",
    ]);
  });
});
