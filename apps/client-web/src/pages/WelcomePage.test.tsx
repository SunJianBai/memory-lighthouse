// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WelcomePage } from "./WelcomePage";
import { GuidePage } from "./GuidePage";
import { hrefFor } from "../app/navigation";

const auth = vi.hoisted(() => ({ status: "authenticated" }));
vi.mock("../auth/auth-context", () => ({ useAuth: () => auth }));

describe("public homepage", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    auth.status = "authenticated";
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });
  function render() {
    act(() => root.render(<WelcomePage />));
  }
  function selectTab(index: number) {
    const tab =
      container.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index];
    act(() => tab.click());
    return tab;
  }

  it("labels sample data and AI imagery without claiming a live session", () => {
    const html = renderToStaticMarkup(<WelcomePage />);
    for (const content of [
      "连接陪伴设备",
      "首次使用",
      "进入家属工作区",
      "示例内容，不关联真实家庭",
      "AI 生成示意图",
      "MiniCPM-o 4.5 全双工全模态应用",
    ])
      expect(html).toContain(content);
    expect(html).not.toContain("设备尚未激活");
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("shows real route targets and preserves anonymous and restored-session entries", () => {
    for (const [status, label, href] of [
      ["anonymous", "登录家属工作区", hrefFor("login")],
      ["authenticated", "进入家属工作区", hrefFor("workspace-overview")],
    ]) {
      auth.status = status;
      render();
      expect(
        container
          .querySelector(".landing-intro-actions a")
          ?.getAttribute("href"),
      ).toBe(href);
      expect(container.textContent).toContain(label);
    }
    auth.status = "bootstrapping";
    render();
    expect(
      container.querySelector<HTMLButtonElement>('[aria-busy="true"]')
        ?.disabled,
    ).toBe(true);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it("has keyboard-operable preview tabs with one focus stop and valid panel references", () => {
    render();
    const tabs = [
      ...container.querySelectorAll<HTMLButtonElement>('[role="tab"]'),
    ];
    for (const tab of tabs)
      expect(
        document.getElementById(tab.getAttribute("aria-controls")!),
      ).not.toBeNull();
    act(() => {
      tabs[0].focus();
      tabs[0].dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
      "未连接模型或麦克风",
    );
    act(() =>
      tabs[1].dispatchEvent(
        new KeyboardEvent("keydown", { key: "End", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tabs[3]);
    expect(container.querySelector('[role="tabpanel"]')?.textContent).toContain(
      "现场接听",
    );
    act(() =>
      tabs[3].dispatchEvent(
        new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
      ),
    );
    expect(document.activeElement).toBe(tabs[0]);
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toHaveLength(1);
  });

  it("allows completing and undoing only the local demonstration task", () => {
    render();
    selectTab(2);
    const button = container.querySelector<HTMLButtonElement>(
      ".landing-demo-task button",
    )!;
    act(() => button.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "已完成（示例）",
    );
    expect(button.textContent).toContain("撤销完成");
    selectTab(0);
    selectTab(2);
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "已完成（示例）",
    );
    act(() =>
      container
        .querySelector<HTMLButtonElement>(".landing-demo-task button")!
        .click(),
    );
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      "小陈负责 · 待处理",
    );
  });

  it("cycles labelled preset conversations without claiming an AI response", () => {
    render();
    selectTab(1);
    const button = container.querySelector<HTMLButtonElement>(
      ".landing-text-action",
    )!;
    act(() => button.click());
    expect(container.textContent).toContain("这周的安排，可以请家属再确认一下");
    expect(container.textContent).toContain("预设示例，未连接模型或麦克风");
    act(() => button.click());
    expect(container.textContent).toContain("我下午想出去走走");
  });

  it("uses existing guide anchors and keeps usage limits in accessible disclosures", () => {
    render();
    const guideHtml = renderToStaticMarkup(<GuidePage />);
    for (const link of container.querySelectorAll<HTMLAnchorElement>(
      'a[href*="guide#"]',
    ))
      expect(guideHtml).toContain(`id="${link.hash.slice(1)}"`);
    expect(container.querySelectorAll("details > summary")).toHaveLength(3);
    expect(container.textContent).toContain("不识别药片与剂量");
    expect(
      container.querySelector<HTMLAnchorElement>(".landing-download")?.href,
    ).toContain("/releases/latest/download/memory-lighthouse-android.apk");
  });
});
