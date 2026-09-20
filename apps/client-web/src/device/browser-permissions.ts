export type BrowserMediaPermission =
  PermissionState | "unsupported" | "unavailable" | "insecure" | "error";

export async function inspectBrowserPermission(
  name: "microphone" | "camera",
): Promise<BrowserMediaPermission> {
  if (!globalThis.isSecureContext) return "insecure";
  if (!navigator.mediaDevices?.getUserMedia) return "unavailable";
  if (!navigator.permissions?.query) return "unsupported";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      navigator.permissions.query({ name: name as PermissionName }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 1_000);
      }),
    ]);
    if (!result) return "error";
    return ["granted", "prompt", "denied"].includes(result.state)
      ? result.state
      : "error";
  } catch (error) {
    return error instanceof TypeError ? "unsupported" : "error";
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const browserPermissionMessage = (
  state?: BrowserMediaPermission,
): string => {
  switch (state) {
    case "granted":
      return "权限已允许，采集未检查";
    case "denied":
      return "已拒绝，请在此网站的权限设置中允许访问";
    case "prompt":
      return "尚未允许，开始陪伴时按提示授权";
    case "unsupported":
      return "浏览器不支持查询，开始陪伴时按提示授权";
    case "unavailable":
      return "此浏览器不支持媒体采集，请更换浏览器";
    case "insecure":
      return "需要安全连接，请使用 HTTPS 地址";
    case "error":
      return "暂时无法确认，请重新检查或查看网站权限设置";
    default:
      return "未检查";
  }
};
