import { describe, expect, it } from "vitest";
import type { HouseholdMemberView } from "../../api/types";
import { authorityDraftFor, authorityRequestBody } from "./care-authority-model";

const member = (role: "OWNER" | "CAREGIVER" | "VIEWER"): HouseholdMemberView => ({
  id: `member-${role}`,
  householdId: "household-1",
  userId: `user-${role}`,
  displayName: role,
  status: "ACTIVE",
  roleCodes: [role],
  joinedAt: "2026-08-02T00:00:00.000Z",
  version: 0,
});

describe("care authority drafts", () => {
  it("does not grant high-risk capabilities to a new caregiver by default", () => {
    expect(authorityDraftFor(member("CAREGIVER"))).toMatchObject({
      canRemoteCall: false,
      canActivateDevice: false,
      canViewConversation: false,
      canManageRoutine: true,
    });
  });

  it("does not pre-grant event access to a new viewer", () => {
    expect(authorityDraftFor(member("VIEWER"))).toMatchObject({
      canViewEvents: false,
      canRemoteCall: false,
      canActivateDevice: false,
      canViewConversation: false,
    });
  });

  it("serializes an explicit password and optimistic version", () => {
    const draft = authorityDraftFor(member("VIEWER"));
    draft.relationshipLabel = "女儿";
    draft.contactPriority = "2";
    expect(authorityRequestBody(draft, "current-password", 4)).toMatchObject({
      relationshipLabel: "女儿",
      contactPriority: 2,
      version: 4,
      currentPassword: "current-password",
    });
  });

  it("preserves significant whitespace in the current password", () => {
    const draft = authorityDraftFor(member("VIEWER"));
    expect(authorityRequestBody(draft, " password with spaces ", 0)).toMatchObject({
      currentPassword: " password with spaces ",
    });
  });

  it("parses the complete numeric contact priority instead of a prefix", () => {
    const draft = authorityDraftFor(member("VIEWER"));
    draft.contactPriority = "1e2";
    expect(authorityRequestBody(draft, "current-password", 0)).toMatchObject({
      contactPriority: 100,
    });
  });
});
