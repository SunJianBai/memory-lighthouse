import { describe, expect, it } from "vitest";
import {
  createWorkspaceOperationOwner,
  isWorkspaceOperationOwnerCurrent,
  WorkspaceScopeTracker,
  workspaceScopeKey,
} from "../../workspace/workspace-scope";
import {
  createScopedPageState,
  createScopedMutationOwner,
  isScopedMutationOwnerCurrent,
  pageValueForScope,
} from "./family-page-state";

describe("family page workspace ownership", () => {
  it("hides resource data that belongs to the previously selected recipient", () => {
    const previousRecipient = createScopedPageState(
      "household-a:recipient-a",
      { routines: ["routine-a"], tasks: ["task-a"] },
    );

    expect(
      pageValueForScope(previousRecipient, "household-a:recipient-b", {
        routines: [],
        tasks: [],
      }),
    ).toEqual({ routines: [], tasks: [] });
    expect(
      pageValueForScope(previousRecipient, "household-a:recipient-a", {
        routines: [],
        tasks: [],
      }),
    ).toEqual({ routines: ["routine-a"], tasks: ["task-a"] });
  });

  it("keeps a routine draft bound to the household and recipient where it opened", () => {
    const formOwner = createWorkspaceOperationOwner(
      "household-a:recipient-a",
      "household-a",
      "recipient-a",
    );

    expect(
      isWorkspaceOperationOwnerCurrent(
        formOwner,
        "household-a:recipient-b",
      ),
    ).toBe(false);
    expect(formOwner).toMatchObject({
      householdId: "household-a",
      recipientId: "recipient-a",
    });
  });

  it("rejects a mutation from an earlier visit after switching A to B to A", () => {
    const scopeTracker = new WorkspaceScopeTracker();
    const firstA = scopeTracker.observe(
      workspaceScopeKey("household-a", "recipient-a"),
    );
    const mutationOwner = createScopedMutationOwner(
      firstA,
      "household-a",
      "recipient-a",
    );

    scopeTracker.observe(workspaceScopeKey("household-a", "recipient-b"));
    const secondA = scopeTracker.observe(
      workspaceScopeKey("household-a", "recipient-a"),
    );

    expect(
      isScopedMutationOwnerCurrent(mutationOwner, secondA),
    ).toBe(false);
  });

  it("allows independent mutations started during the same scope visit", () => {
    const scopeTracker = new WorkspaceScopeTracker();
    const scope = scopeTracker.observe(
      workspaceScopeKey("household-a", "recipient-a"),
    );
    const firstOwner = createScopedMutationOwner(
      scope,
      "household-a",
      "recipient-a",
    );
    const secondOwner = createScopedMutationOwner(
      scope,
      "household-a",
      "recipient-a",
    );

    expect(isScopedMutationOwnerCurrent(firstOwner, scope)).toBe(true);
    expect(isScopedMutationOwnerCurrent(secondOwner, scope)).toBe(true);
  });
});
