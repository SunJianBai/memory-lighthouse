// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";

const fixture = vi.hoisted(() => ({
  auth: { status: "authenticated", user: { id: "user-a" } },
  request: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({ useAuth: () => fixture.auth }));
vi.mock("../api/api-client", () => ({
  apiClient: { request: fixture.request },
  readableError: (error: Error) => error.message,
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("workspace account and selection ownership", () => {
  let root: Root;
  let container: HTMLDivElement;
  let workspace: ReturnType<typeof useWorkspace>;
  const renders: Array<{ householdId: string; recipientId: string }> = [];
  function Probe() {
    workspace = useWorkspace();
    renders.push({
      householdId: workspace.householdId,
      recipientId: workspace.recipientId,
    });
    return (
      <span>
        {workspace.householdId}:{workspace.recipientId}
      </span>
    );
  }
  async function render(node: ReactNode = <Probe />) {
    await act(async () => {
      root.render(<WorkspaceProvider>{node}</WorkspaceProvider>);
    });
  }
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    localStorage.clear();
    fixture.auth = { status: "authenticated", user: { id: "user-a" } };
    fixture.request.mockReset();
    fixture.request.mockImplementation(async (path: string) => {
      if (path === "/households")
        return [{ id: `home-${fixture.auth.user.id}` }];
      if (path.endsWith("/care-recipients"))
        return [{ id: `${path.split("/")[2]}-recipient` }];
      if (path.endsWith("/companion-bindings")) return [];
      throw new Error(`Unexpected request: ${path}`);
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    renders.length = 0;
  });
  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("reloads the workspace when the user changes without an anonymous transition", async () => {
    await render();
    expect(workspace.householdId).toBe("home-user-a");
    fixture.auth = { status: "authenticated", user: { id: "user-b" } };
    renders.length = 0;
    await render();
    expect(workspace.householdId).toBe("home-user-b");
    expect(workspace.recipientId).toBe("home-user-b-recipient");
    expect(renders.some((value) => value.householdId === "home-user-a")).toBe(
      false,
    );
  });

  it("never publishes a remembered selection before the server authorizes it", async () => {
    localStorage.setItem("memory-lighthouse.selected-household", "stale-home");
    localStorage.setItem(
      "memory-lighthouse.selected-recipient",
      "stale-recipient",
    );
    await render();
    expect(
      renders.some(
        (value) =>
          value.householdId === "stale-home" ||
          value.recipientId === "stale-recipient",
      ),
    ).toBe(false);
    expect(workspace.householdId).toBe("home-user-a");
  });

  it("ignores an old user's delayed household response", async () => {
    const oldResponse = deferred<unknown[]>();
    fixture.request.mockImplementationOnce(() => oldResponse.promise);
    await render();
    fixture.auth = { status: "authenticated", user: { id: "user-b" } };
    await render();
    expect(workspace.householdId).toBe("home-user-b");
    await act(async () => {
      oldResponse.resolve([{ id: "home-user-a" }]);
    });
    expect(workspace.householdId).toBe("home-user-b");
  });

  it("clears old recipients and bindings while switching households", async () => {
    await render();
    const nextRecipients = deferred<unknown[]>();
    fixture.request.mockImplementation((path: string) =>
      path.endsWith("/care-recipients")
        ? nextRecipients.promise
        : Promise.resolve([]),
    );
    await act(async () => {
      workspace.selectHousehold("home-other");
    });
    expect(workspace.householdId).toBe("home-other");
    expect(workspace.recipientId).toBe("");
    expect(workspace.recipients).toEqual([]);
    expect(workspace.bindings).toEqual([]);
    await act(async () => {
      nextRecipients.resolve([{ id: "other-recipient" }]);
    });
    expect(workspace.recipientId).toBe("other-recipient");
  });
});
