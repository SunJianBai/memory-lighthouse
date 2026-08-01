import type { AppRoute } from "../domain/types";

const routes = new Set<AppRoute>([
  "welcome",
  "onboarding",
  "care",
  "family",
  "memories",
  "demo",
  "settings",
]);

export const routeFromHash = (): AppRoute => {
  const value = window.location.hash.replace(/^#\/?/, "") as AppRoute;
  return routes.has(value) ? value : "welcome";
};

export const navigate = (route: AppRoute) => {
  window.location.hash = `/${route}`;
};
