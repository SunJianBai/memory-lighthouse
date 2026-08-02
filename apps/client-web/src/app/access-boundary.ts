import type { ClientRoute } from "./navigation";

export const requiresFamilySession = (route: ClientRoute): boolean =>
  route.startsWith("workspace-") || route === "accept-invitation";
