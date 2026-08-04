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

export type ClientRoute = ProductRoute;

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

const relativePath = (pathname: string, baseUrl: string): string => {
  const basePath = baseUrl.replace(/^\//, "").replace(/\/$/, "");
  const normalizedPathname = pathname.replace(/^\/+|\/+$/g, "");
  if (!basePath) return normalizedPathname;
  if (normalizedPathname === basePath) return "";
  return normalizedPathname.startsWith(`${basePath}/`)
    ? normalizedPathname.slice(basePath.length + 1)
    : "";
};

export type RouteResolution = {
  route: ClientRoute;
  canonicalHref?: string;
};

export const resolveRoute = (
  pathname: string,
  baseUrl: string = import.meta.env.BASE_URL,
): RouteResolution => {
  const path = relativePath(pathname, baseUrl);
  if (path === "demo" || path.startsWith("demo/")) {
    return {
      route: "home",
      canonicalHref: baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`,
    };
  }
  return { route: routesByPath.get(path) ?? "home" };
};

export const routeFromLocation = (): ClientRoute => {
  const resolution = resolveRoute(window.location.pathname);
  if (resolution.canonicalHref) {
    window.history.replaceState(null, "", resolution.canonicalHref);
  }
  return resolution.route;
};

export const hrefFor = (route: ClientRoute): string =>
  `${import.meta.env.BASE_URL}${paths[route]}`;

export function navigate(route: ClientRoute): void {
  window.history.pushState(null, "", hrefFor(route));
  window.dispatchEvent(new PopStateEvent("popstate"));
}
