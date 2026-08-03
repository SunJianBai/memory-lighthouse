export type SensitiveFragmentAction = {
  kind: "reset-password" | "accept-invitation";
  token: string;
};

/**
 * Read one-time tokens before React mounts, then immediately remove the
 * fragment from browser history so it cannot be copied or retained there.
 */
export const consumeSensitiveFragment = (): SensitiveFragmentAction | null => {
  const fragment = window.location.hash.replace(/^#/, "");
  if (!fragment) return null;
  const token = new URLSearchParams(fragment).get("token")?.trim();
  if (!token) return null;

  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );

  const path = window.location.pathname.toLowerCase();
  const kind = path.endsWith("/reset-password")
    ? "reset-password"
    : path.endsWith("/invitations/accept") || path.endsWith("/accept-invitation")
      ? "accept-invitation"
      : null;
  if (!kind) return null;
  return { kind, token };
};
