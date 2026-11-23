import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuthManager } from "../../../src/auth/auth-manager.js";
import type { TokenStore, StoredTokens } from "../../../src/auth/token-store.js";
import type { OAuthClient } from "../../../src/auth/oauth.js";

function createMockTokenStore(): TokenStore {
  let stored: StoredTokens | null = null;
  return {
    load: vi.fn(async () => stored),
    save: vi.fn(async (tokens: StoredTokens) => { stored = tokens; }),
    clear: vi.fn(async () => { stored = null; }),
    isAccessTokenExpired: vi.fn((tokens: StoredTokens) => Date.now() >= tokens.expires_at),
    filePath: "/tmp/test-tokens.json",
  } as unknown as TokenStore;
}

function createMockOAuthClient(): OAuthClient {
  return {
    refreshAccessToken: vi.fn(async () => ({
      access_token: "refreshed-token",
      refresh_token: "new-refresh",
      expires_at: Date.now() + 3600_000,
    })),
    startLocalAuthFlow: vi.fn(async () => ({
      code: "test-code",
      redirectUri: "http://localhost:1234/callback",
      codeVerifier: "test-verifier",
    })),
    exchangeCode: vi.fn(async () => ({
      access_token: "new-token",
      refresh_token: "new-refresh",
      expires_at: Date.now() + 3600_000,
    })),
  } as unknown as OAuthClient;
}

describe("AuthManager", () => {
  let manager: AuthManager;
  let tokenStore: ReturnType<typeof createMockTokenStore>;
  let oauthClient: ReturnType<typeof createMockOAuthClient>;

  beforeEach(() => {
    tokenStore = createMockTokenStore();
    oauthClient = createMockOAuthClient();
    manager = new AuthManager(tokenStore, oauthClient);
  });

  it("returns null when no tokens exist", async () => {
    const token = await manager.getAccessToken();
    expect(token).toBeNull();
  });

  it("returns valid stored token", async () => {
    const validTokens: StoredTokens = {
      access_token: "valid-token",
      refresh_token: "refresh",
      expires_at: Date.now() + 3600_000,
    };
    await tokenStore.save(validTokens);
    const token = await manager.getAccessToken();
    expect(token).toBe("valid-token");
  });

  it("refreshes expired token automatically", async () => {
    const expiredTokens: StoredTokens = {
      access_token: "expired",
      refresh_token: "still-valid-refresh",
      expires_at: Date.now() - 1000,
    };
    await tokenStore.save(expiredTokens);
    const token = await manager.getAccessToken();
    expect(token).toBe("refreshed-token");
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledWith("still-valid-refresh");
  });

  it("handleTokenExpired triggers refresh", async () => {
    const tokens: StoredTokens = {
      access_token: "old",
      refresh_token: "valid-refresh",
      expires_at: Date.now() + 3600_000,
    };
    await tokenStore.save(tokens);
    await manager.handleTokenExpired();
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledWith("valid-refresh");
  });

  it("authenticate returns immediately when already signed in", async () => {
    await tokenStore.save({ access_token: "ok", refresh_token: "r", expires_at: Date.now() + 3600_000 });
    const result = await manager.authenticate();
    expect(result.status).toBe("authenticated");
    expect(oauthClient.startLocalAuthFlow).not.toHaveBeenCalled();
  });

  it("authenticate completes and saves tokens when the user approves in time", async () => {
    const result = await manager.authenticate(1000);
    expect(result.status).toBe("authenticated");
    expect(tokenStore.save).toHaveBeenCalled();
  });

  it("authenticate keeps waiting in the background past the tool-call wait", async () => {
    let approve!: () => void;
    (oauthClient.startLocalAuthFlow as any).mockImplementation(
      () => new Promise((resolve) => { approve = () => resolve({ code: "c", redirectUri: "http://localhost:3003/callback", codeVerifier: "v" }); })
    );
    const first = await manager.authenticate(20);
    expect(first.status).toBe("pending");

    // A second call while waiting must not start another listener on the same port
    const second = await manager.authenticate(20);
    expect(second.status).toBe("pending");
    expect(oauthClient.startLocalAuthFlow).toHaveBeenCalledTimes(1);

    approve();
    const third = await manager.authenticate(1000);
    expect(third.status).toBe("authenticated");
    expect(await manager.getAccessToken()).toBe("new-token");
  });

  it("authenticate reports a failed token exchange", async () => {
    (oauthClient.exchangeCode as any).mockRejectedValue(new Error("invalid_grant"));
    const result = await manager.authenticate(1000);
    expect(result.status).toBe("failed");
    expect(result.message).toContain("invalid_grant");
  });
});
