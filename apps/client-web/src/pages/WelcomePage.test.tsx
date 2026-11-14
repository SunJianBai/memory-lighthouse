import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { WelcomePage } from "./WelcomePage";

vi.mock("../auth/auth-context", () => ({ useAuth: () => ({ status: "authenticated" }) }));

describe("welcome product introduction", () => {
  it("does not present an illustrative device as a real activation status", () => {
    const html = renderToStaticMarkup(<WelcomePage />);
    expect(html).toContain("连接陪伴设备");
    expect(html).toContain("首次使用");
    expect(html).not.toContain("设备尚未激活");
    expect(html).toContain("进入家属工作区");
  });
});
