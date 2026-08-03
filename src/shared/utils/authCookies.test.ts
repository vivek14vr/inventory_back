import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveAuthCookieBaseOptions } from "./authCookieOptions.js";

describe("resolveAuthCookieBaseOptions", () => {
  it("allows cookies on an explicitly configured HTTP deployment", () => {
    assert.deepEqual(
      resolveAuthCookieBaseOptions({
        AUTH_COOKIE_SECURE: false,
        AUTH_COOKIE_SAME_SITE: "lax",
      }),
      { secure: false, sameSite: "lax", path: "/" }
    );
  });

  it("uses Secure cookies when HTTPS is explicitly configured", () => {
    assert.deepEqual(
      resolveAuthCookieBaseOptions({
        AUTH_COOKIE_SECURE: true,
        AUTH_COOKIE_SAME_SITE: "strict",
      }),
      { secure: true, sameSite: "strict", path: "/" }
    );
  });
});
