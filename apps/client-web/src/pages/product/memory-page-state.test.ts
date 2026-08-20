import { describe, expect, it } from "vitest";
import {
  createMemoryFormScope,
  isMemoryFormScopeCurrent,
  mergeMemoryPage,
} from "./memory-page-state";

describe("memory page state", () => {
  it("appends cursor pages without duplicating an updated memory", () => {
    const current = [
      { id: "memory-a", title: "A" },
      { id: "memory-b", title: "B old" },
    ];
    const incoming = [
      { id: "memory-b", title: "B current" },
      { id: "memory-c", title: "C" },
    ];

    expect(mergeMemoryPage(current, incoming, true)).toEqual([
      { id: "memory-a", title: "A" },
      { id: "memory-b", title: "B current" },
      { id: "memory-c", title: "C" },
    ]);
  });

  it("binds a create or edit form to the household and recipient that opened it", () => {
    const formScope = createMemoryFormScope(
      "household-a:recipient-a",
      "household-a",
      "recipient-a",
    );

    expect(
      isMemoryFormScopeCurrent(formScope, "household-a:recipient-a"),
    ).toBe(true);
    expect(
      isMemoryFormScopeCurrent(formScope, "household-a:recipient-b"),
    ).toBe(false);
    expect(formScope).toMatchObject({
      householdId: "household-a",
      recipientId: "recipient-a",
    });
  });
});
