import type { TokenStore, StoredTokens } from "./token-store.js";
import type { OAuthClient } from "./oauth.js";

export class AuthManager {
  constructor(
    private tokenStore: TokenStore,
    private oauthClient: OAuthClient
  ) {}

  async getAccessToken(): Promise<string | null> {
    const tokens = await this.tokenStore.load();
    if (!tokens) return null;

    if (!this.tokenStore.isAccessTokenExpired(tokens)) {
      return tokens.access_token;
    }

    try {
      const refreshed = await this.oauthClient.refreshAccessToken(tokens.refresh_token);
      await this.tokenStore.save(refreshed);
      return refreshed.access_token;
    } catch {
      return null;
    }
  }

  async handleTokenExpired(): Promise<void> {
    const tokens = await this.tokenStore.load();
    if (!tokens) return;

    try {
      const refreshed = await this.oauthClient.refreshAccessToken(tokens.refresh_token);
      await this.tokenStore.save(refreshed);
    } catch {
      await this.tokenStore.clear();
    }
  }

  private pendingAuth: Promise<void> | null = null;
  private lastAuthError: string | null = null;

  /**
   * Starts the browser sign-in and waits up to `waitMs` for it to finish.
   * The local callback listener keeps running in the background after this
   * returns, because remote tool calls can time out (~60s) long before a
   * person has signed in to Etsy and clicked "Allow access".
   */
  async authenticate(waitMs = 40_000): Promise<AuthResult> {
    const existing = await this.getAccessToken();
    if (existing) {
      return { status: "authenticated", message: "Already connected to Etsy." };
    }

    if (!this.pendingAuth) {
      this.lastAuthError = null;
      this.pendingAuth = (async () => {
        try {
          const { code, redirectUri, codeVerifier } = await this.oauthClient.startLocalAuthFlow();
          const tokens = await this.oauthClient.exchangeCode(code, codeVerifier, redirectUri);
          await this.tokenStore.save(tokens);
        } catch (err) {
          this.lastAuthError = err instanceof Error ? err.message : String(err);
          console.error("Etsy sign-in failed:", this.lastAuthError);
        } finally {
          this.pendingAuth = null;
        }
      })();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const finished = await Promise.race([
      this.pendingAuth.then(() => true),
      new Promise<boolean>((r) => { timer = setTimeout(() => r(false), waitMs); }),
    ]);
    clearTimeout(timer);

    if (finished) {
      if (await this.getAccessToken()) {
        return { status: "authenticated", message: "Successfully authenticated with Etsy!" };
      }
      return { status: "failed", message: `Authentication failed: ${this.lastAuthError ?? "unknown error"}` };
    }

    return {
      status: "pending",
      message:
        "Waiting for you to approve access in the browser. Sign in to Etsy if asked, then click \"Allow access\". " +
        "The sign-in stays open for 5 minutes. When the browser says \"Authorization successful\", run authenticate again to confirm.",
    };
  }
}

export interface AuthResult {
  status: "authenticated" | "pending" | "failed";
  message: string;
}
