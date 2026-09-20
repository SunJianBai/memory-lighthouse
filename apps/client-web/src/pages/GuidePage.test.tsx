import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { hrefFor, resolveRoute } from "../app/navigation";
import { requiresFamilySession } from "../app/access-boundary";
import { GuidePage } from "./GuidePage";
import {
  guideCapabilities,
  guideFaqs,
  guideSections,
  quickStartSteps,
} from "./guide-content";
import companionSource from "./product/CompanionPage.tsx?raw";
import shellSource from "../components/ProductShell.tsx?raw";

describe("public illustrated guide", () => {
  it("renders without a user, workspace, or device session", () => {
    expect(requiresFamilySession("guide")).toBe(false);
    const html = renderToStaticMarkup(<GuidePage />);
    expect(html).toContain('id="guide-title">使用指南</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it("has a matching, unique destination for each table-of-contents link", () => {
    const html = renderToStaticMarkup(<GuidePage />);
    for (const section of guideSections) {
      expect(html).toContain(`href="#${section.id}"`);
      expect(html.split(`id="${section.id}"`)).toHaveLength(2);
    }
  });

  it("links all actions to real product routes under the deployment base", () => {
    const html = renderToStaticMarkup(<GuidePage />);
    for (const item of [...quickStartSteps, ...guideCapabilities]) {
      const href = hrefFor(item.route);
      expect(resolveRoute(href).route).toBe(item.route);
      expect(html).toContain(`href="${href}"`);
    }
  });

  it("keeps longer explanations collapsed with native keyboard controls", () => {
    const html = renderToStaticMarkup(<GuidePage />);
    expect(html.match(/<details\b/g)).toHaveLength(
      guideCapabilities.length + guideFaqs.length,
    );
    expect(html.match(/<summary\b/g)).toHaveLength(12);
    expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  });

  it("labels illustrations as examples and states key usage limits", () => {
    const html = renderToStaticMarkup(<GuidePage />);
    expect(html).toContain("不含真实激活信息");
    expect(html).toContain("示例数据，不展示真实家庭资料");
    expect(html.match(/role="img" aria-label=/g)).toHaveLength(2);
    expect(html).toContain("必须完成最后的家属确认");
    expect(html).toContain("现场接听");
    expect(html).toContain("不保证关闭页面后仍能提醒");
    expect(html).toContain("不是静默监控");
    expect(html).toContain("交回待认领");
    expect(html).toContain("事项仍未完成");
    expect(html).toContain("以下操作以 Web 端为例");
    expect(html).toContain("“陪伴麦克风”和“全模态模型处理”");
  });

  it("provides workspace help and opens companion help without leaving its session", () => {
    expect(shellSource).toContain(
      'className="product-help-link" href={hrefFor("guide")}',
    );
    expect(companionSource).toMatch(
      /className="companion-help-link"[^>]*href=\{hrefFor\("guide"\)\}[^>]*target="_blank"[^>]*rel="noopener noreferrer"/,
    );
  });
});
