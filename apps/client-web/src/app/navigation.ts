import type { AppRoute as DemoRoute } from "../domain/types";

export type ProductRoute =
  | "home"
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password"
  | "verify-email"
  | "accept-invitation"
  | "workspace-overview"
  | "workspace-memories"
  | "workspace-routines"
  | "workspace-devices"
  | "workspace-privacy"
  | "workspace-remote"
  | "workspace-settings"
  | "companion";

export type ClientRoute = ProductRoute | `demo-${DemoRoute}`;

const paths: Record<ClientRoute, string> = {
  home: "",
  login: "login",
  register: "register",
  "forgot-password": "forgot-password",
  "reset-password": "auth/reset-password",
  "verify-email": "auth/verify-email",
  "accept-invitation": "invitations/accept",
  "workspace-overview": "app/overview",
  "workspace-memories": "app/memories",
  "workspace-routines": "app/routines",
  "workspace-devices": "app/devices",
  "workspace-privacy": "app/privacy",
  "workspace-remote": "app/remote",
  "workspace-settings": "app/settings",
  companion: "companion",
  "demo-welcome": "demo",
  "demo-onboarding": "demo/onboarding",
  "demo-care": "demo/care",
  "demo-family": "demo/family",
  "demo-memories": "demo/memories",
  "demo-demo": "demo/showcase",
  "demo-settings": "demo/settings",
};

const routesByPath = new Map(
  Object.entries(paths).map(([route, path]) => [path, route as ClientRoute]),
);

// Keep pre-refactor bookmarks usable while newly generated routes use the
// canonical paths above. Email verification now uses an entered code rather
// than a token-bearing mail link.
routesByPath.set("reset-password", "reset-password");
routesByPath.set("verify-email", "verify-email");
routesByPath.set("accept-invitation", "accept-invitation");

const legacyDemoMap: Record<DemoRoute, ClientRoute> = {
  welcome: "demo-welcome",
  onboarding: "demo-onboarding",
  care: "demo-care",
  family: "demo-family",
  memories: "demo-memories",
  demo: "demo-demo",
  settings: "demo-settings",
};

const basePath = import.meta.env.BASE_URL.replace(/^\//, "").replace(/\/$/, "");

const relativePath = (): string => {
  const pathname = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (!basePath) return pathname;
  if (pathname === basePath) return "";
  return pathname.startsWith(`${basePath}/`)
    ? pathname.slice(basePath.length + 1)
    : "";
};

export const routeFromLocation = (): ClientRoute =>
  routesByPath.get(relativePath()) ?? "home";

export const routeFromHash = (): DemoRoute => {
  const route = routeFromLocation();
  return route.startsWith("demo-")
    ? (route.slice(5) as DemoRoute)
    : "welcome";
};

export const hrefFor = (route: ClientRoute): string =>
  `${import.meta.env.BASE_URL}${paths[route]}`;

export function navigate(route: DemoRoute | ProductRoute | ClientRoute): void {
  const normalized = route in legacyDemoMap
    ? legacyDemoMap[route as DemoRoute]
    : (route as ClientRoute);
  window.history.pushState(null, "", hrefFor(normalized));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
