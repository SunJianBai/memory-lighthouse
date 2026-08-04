import { describe, expect, it } from "vitest";
import { resolveRoute } from "./navigation";

describe("client navigation", () => {
  it("resolves the current authenticated memory workspace", () => {
    expect(resolveRoute("/openBMB/app/memories", "/openBMB/")).toEqual({
      route: "workspace-memories",
    });
  });

  it("removes every legacy competition demo URL and canonicalizes to home", () => {
    expect(resolveRoute("/openBMB/demo/memories", "/openBMB/")).toEqual({
      route: "home",
      canonicalHref: "/openBMB/",
    });
    expect(resolveRoute("/openBMB/demo", "/openBMB/")).toEqual({
      route: "home",
      canonicalHref: "/openBMB/",
    });
  });
});
