import { describe, expect, it } from "vitest";
import {
  createWorkspaceOperationOwner,
  isWorkspaceOperationOwnerCurrent,
  LatestScopedRequest,
  WorkspaceScopeTracker,
  workspaceScopeKey,
} from "./workspace-scope";

describe("workspace scope identity", () => {
  it("keeps the epoch stable until the selected household or recipient changes", () => {
    const tracker = new WorkspaceScopeTracker();

    expect(tracker.observe(workspaceScopeKey("household-a", "recipient-a"))).toEqual({
      key: "household-a:recipient-a",
      epoch: 1,
    });
    expect(tracker.observe(workspaceScopeKey("household-a", "recipient-a"))).toEqual({
      key: "household-a:recipient-a",
      epoch: 1,
    });
    expect(tracker.observe(workspaceScopeKey("household-a", "recipient-b"))).toEqual({
      key: "household-a:recipient-b",
      epoch: 2,
    });
  });

  it("allows only the latest request in the current scope to commit", () => {
    const requests = new LatestScopedRequest();
    const first = requests.begin("household-a");
    const second = requests.begin("household-a");

    expect(requests.isCurrent(first)).toBe(false);
    expect(requests.isCurrent(second)).toBe(true);

    const otherHousehold = requests.begin("household-b");
    expect(requests.isCurrent(second)).toBe(false);
    expect(requests.isCurrent(otherHousehold)).toBe(true);
  });
});

describe("workspace operation ownership", () => {
  it("keeps an operation bound to the household and recipient where it began", () => {
    const owner = createWorkspaceOperationOwner(
      workspaceScopeKey("household-a", "recipient-a"),
      "household-a",
      "recipient-a",
    );

    expect(owner).toEqual({
      scopeKey: "household-a:recipient-a",
      householdId: "household-a",
      recipientId: "recipient-a",
    });
    expect(
      isWorkspaceOperationOwnerCurrent(
        owner,
        workspaceScopeKey("household-a", "recipient-a"),
      ),
    ).toBe(true);
    expect(
      isWorkspaceOperationOwnerCurrent(
        owner,
        workspaceScopeKey("household-a", "recipient-b"),
      ),
    ).toBe(false);
  });
});
