import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generatePKCE, buildAuthUrl, exchangeCodeForTokens, refreshAccessToken } from "./googleOAuth";

describe("generatePKCE", () => {
  it("produces a code_verifier of 43–128 chars, URL-safe base64", async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge.length).toBeGreaterThan(0);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("code_challenge is BASE64URL(SHA-256(code_verifier))", async () => {
    const { codeVerifier, codeChallenge } = await generatePKCE();
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const hash = await crypto.subtle.digest("SHA-256", data);
    const expected = btoa(String.fromCharCode(...new Uint8Array(hash)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    expect(codeChallenge).toBe(expected);
  });

  it("each call produces a unique verifier", async () => {
    const a = await generatePKCE();
    const b = await generatePKCE();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe("buildAuthUrl", () => {
  it("includes all required OAuth params", () => {
    const url = buildAuthUrl({
      clientId: "test-client-id",
      redirectUri: "http://127.0.0.1:8888/callback",
      codeChallenge: "abc123",
      state: "xyz",
    });
    expect(url).toContain("accounts.google.com/o/oauth2/v2/auth");
    expect(url).toContain("client_id=test-client-id");
    expect(url).toContain("redirect_uri=http");
    expect(url).toContain("code_challenge=abc123");
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=xyz");
    expect(url).toContain("response_type=code");
    expect(url).toContain("access_type=offline");
    expect(url).toContain("generative-language");
  });
});

describe("refreshAccessToken", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts refresh_token grant and returns new access_token", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: "new_access_token",
        expires_in: 3600,
      }),
    } as Response);

    const result = await refreshAccessToken({
      clientId: "test-client-id",
      refreshToken: "my-refresh-token",
    });

    expect(result.accessToken).toBe("new_access_token");
    expect(result.expiresAt).toBeGreaterThan(Date.now());

    const callArgs = mockFetch.mock.calls[0];
    const body = new URLSearchParams(callArgs[1]?.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("my-refresh-token");
    expect(body.get("client_id")).toBe("test-client-id");
  });

  it("throws on non-ok response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad Request",
    } as Response);

    await expect(
      refreshAccessToken({ clientId: "test-client-id", refreshToken: "bad-token" })
    ).rejects.toThrow("Token refresh failed");
  });
});
