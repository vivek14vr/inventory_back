export function resolveAuthCookieBaseOptions(config: {
  AUTH_COOKIE_SECURE: boolean;
  AUTH_COOKIE_SAME_SITE: "lax" | "strict" | "none";
}) {
  return {
    // NODE_ENV does not tell us whether the browser is using HTTPS. The current
    // production host is served over HTTP, where a Secure cookie is discarded.
    // Enable this explicitly when TLS is configured at the public endpoint.
    secure: config.AUTH_COOKIE_SECURE,
    sameSite: config.AUTH_COOKIE_SAME_SITE,
    path: "/",
  } as const;
}
