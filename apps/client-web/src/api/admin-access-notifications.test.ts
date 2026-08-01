import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_ACCESS_POLL_INTERVAL_MS,
  appendAdminAccessPage,
  applyAdminAccessRead,
  isHouseholdOwner,
  loadAdminAccessNotifications,
  markAdminAccessNotificationRead,
  mergeAdminAccessRefresh,
  type AdminAccessPage,
  type AdminAccessRecord,
  type AdminAccessRequest,
} from "./admin-access-notifications";

const record = (
  position: number,
  notificationState: AdminAccessRecord["notificationState"] = "UNREAD",
): AdminAccessRecord => ({
  id: `inspection-${String(position).padStart(3, "0")}`,
  occurredAt: new Date(Date.UTC(2026, 7, 2, 12, 0, 0) - position * 1_000)
    .toISOString(),
  category: "UTTERANCE",
  categoryLabel: "对话原文",
  reason: `reason-${position}`,
  notificationState,
  readAt: notificationState === "READ" ? "2026-08-02T13:00:00.000Z" : null,
});

const page = (
  positions: number[],
  nextCursor: string | null,
  unreadCount = positions.length,
): AdminAccessPage => ({
  items: positions.map((position) => record(position)),
  nextCursor,
  unreadCount,
});

describe("admin access notification authorization boundary", () => {
  it("recognizes only an explicit household OWNER role", () => {
    expect(isHouseholdOwner(["OWNER"])).toBe(true);
    expect(isHouseholdOwner(["CAREGIVER", "VIEWER"])).toBe(false);
    expect(isHouseholdOwner(undefined)).toBe(false);
  });

  it("never requests records or read mutations for a non-owner", async () => {
    const request = vi.fn() as unknown as AdminAccessRequest;

    await expect(
      loadAdminAccessNotifications("household-1", ["CAREGIVER"], {
        cursor: "inspection-020",
        request,
      }),
    ).resolves.toBeNull();
    await expect(
      markAdminAccessNotificationRead(
        "household-1",
        "inspection-1",
        ["VIEWER"],
        request,
      ),
    ).resolves.toBeNull();

    expect(request).not.toHaveBeenCalled();
  });

  it("uses the owner endpoints, encodes the cursor, and keeps the mutation body empty", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({ items: [], nextCursor: null, unreadCount: 0 })
      .mockResolvedValueOnce({
        inspectionId: "inspection-1",
        readAt: "2026-08-02T08:00:00.000Z",
      }) as unknown as AdminAccessRequest;

    await loadAdminAccessNotifications("household-1", ["OWNER"], {
      cursor: "inspection/20 + next",
      request,
    });
    await markAdminAccessNotificationRead(
      "household-1",
      "inspection-1",
      ["OWNER"],
      request,
    );

    expect(request).toHaveBeenNthCalledWith(
      1,
      "/households/household-1/privacy/admin-accesses?limit=20&cursor=inspection%2F20+%2B+next",
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/households/household-1/privacy/admin-accesses/inspection-1/read",
      { method: "POST" },
    );
  });
});

describe("admin access feed pagination and reconciliation", () => {
  it("uses a 30 second polling interval", () => {
    expect(ADMIN_ACCESS_POLL_INTERVAL_MS).toBe(30_000);
  });

  it("appends older pages without losing the latest unread count", () => {
    const first = page(
      Array.from({ length: 20 }, (_, index) => index + 1),
      "inspection-020",
      37,
    );
    const older = page(
      Array.from({ length: 20 }, (_, index) => index + 21),
      "inspection-040",
      39,
    );

    const merged = appendAdminAccessPage(first, older);

    expect(merged.items).toHaveLength(40);
    expect(merged.items[0]?.id).toBe("inspection-001");
    expect(merged.items.at(-1)?.id).toBe("inspection-040");
    expect(merged.nextCursor).toBe("inspection-040");
    expect(merged.unreadCount).toBe(37);
  });

  it("keeps loaded history when a poll refreshes the newest page", () => {
    const loaded = page(
      Array.from({ length: 40 }, (_, index) => index + 1),
      "inspection-040",
      40,
    );
    const refreshed = page(
      [0, ...Array.from({ length: 19 }, (_, index) => index + 1)],
      "inspection-019",
      41,
    );

    const merged = mergeAdminAccessRefresh(loaded, refreshed);

    expect(merged.items).toHaveLength(41);
    expect(merged.items[0]?.id).toBe("inspection-000");
    expect(merged.items.at(-1)?.id).toBe("inspection-040");
    expect(merged.nextCursor).toBe("inspection-040");
    expect(merged.unreadCount).toBe(41);
  });

  it("uses the new boundary when a full refreshed window no longer overlaps", () => {
    const loaded = page(
      Array.from({ length: 40 }, (_, index) => index + 40),
      "inspection-079",
      40,
    );
    const refreshed = page(
      Array.from({ length: 20 }, (_, index) => index),
      "inspection-019",
      60,
    );

    const merged = mergeAdminAccessRefresh(loaded, refreshed);

    expect(merged.items).toHaveLength(60);
    expect(merged.nextCursor).toBe("inspection-019");
  });

  it("does not let a stale poll revert a confirmed read or its unread count", () => {
    const initial = page([1, 2, 3], null, 3);
    const read = applyAdminAccessRead(initial, {
      inspectionId: "inspection-001",
      readAt: "2026-08-02T13:30:00.000Z",
    });
    const stalePoll = page([1, 2, 3], null, 3);

    const merged = mergeAdminAccessRefresh(read, stalePoll, true);

    expect(merged.unreadCount).toBe(2);
    expect(merged.items[0]).toMatchObject({
      id: "inspection-001",
      notificationState: "READ",
      readAt: "2026-08-02T13:30:00.000Z",
    });
  });

  it("can mark more than one page of unread records individually", () => {
    const initial = page(
      Array.from({ length: 45 }, (_, index) => index + 1),
      null,
      45,
    );
    const afterReads = initial.items.slice(0, 25).reduce(
      (current, item, index) =>
        applyAdminAccessRead(current, {
          inspectionId: item.id,
          readAt: new Date(Date.UTC(2026, 7, 2, 14, 0, index)).toISOString(),
        }),
      initial,
    );

    expect(afterReads.unreadCount).toBe(20);
    expect(
      afterReads.items.filter((item) => item.notificationState === "READ"),
    ).toHaveLength(25);
    expect(
      afterReads.items.filter((item) => item.notificationState === "UNREAD"),
    ).toHaveLength(20);
  });
});
