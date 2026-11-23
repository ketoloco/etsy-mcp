import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { StoredTokens } from "./token-store.js";

const ETSY_AUTH_URL = "https://www.etsy.com/oauth/connect";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

export interface OAuthConfig {
  apiKey: string;
  sharedSecret: string;
  scopes: string[];
}

export class OAuthClient {
  private config: OAuthConfig;

  constructor(config: OAuthConfig) {
    this.config = config;
  }

  generateCodeVerifier(): string {
    return randomBytes(32).toString("base64url");
  }

  async generateCodeChallenge(verifier: string): Promise<string> {
    const hash = createHash("sha256").update(verifier).digest();
    return hash.toString("base64url");
  }

  async buildAuthorizationUrl(
    redirectUri: string
  ): Promise<{ url: string; codeVerifier: string; state: string }> {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = await this.generateCodeChallenge(codeVerifier);
    const state = randomBytes(16).toString("hex");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.apiKey,
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    return {
      url: `${ETSY_AUTH_URL}?${params.toString().replace(/\+/g, "%20")}`,
      codeVerifier,
      state,
    };
  }

  async exchangeCode(
    code: string,
    codeVerifier: string,
    redirectUri: string
  ): Promise<StoredTokens> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: this.config.apiKey,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    });

    const response = await fetch(ETSY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<StoredTokens> {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: this.config.apiKey,
      refresh_token: refreshToken,
    });

    const response = await fetch(ETSY_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Token refresh failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + data.expires_in * 1000,
    };
  }

  async startLocalAuthFlow(): Promise<{ code: string; redirectUri: string; codeVerifier: string }> {
    // Etsy only accepts a callback URL that exactly matches one registered on the app,
    // so the port must be fixed (default 3003, override with ETSY_CALLBACK_PORT).
    const port = Number(process.env.ETSY_CALLBACK_PORT) || 3003;
    const redirectUri = `http://localhost:${port}/callback`;

    return new Promise((resolve, reject) => {
      let expectedState: string;
      let codeVerifier: string;

      const finish = () => {
        clearTimeout(timeout);
        server.close();
      };

      const server = createServer(
        (req: IncomingMessage, res: ServerResponse) => {
          const url = new URL(req.url!, `http://localhost`);
          if (url.pathname !== "/callback") {
            // Ignore stray browser requests such as /favicon.ico
            res.writeHead(404);
            res.end();
            return;
          }
          const code = url.searchParams.get("code");
          const returnedState = url.searchParams.get("state");

          if (!code) {
            res.writeHead(400, { "Content-Type": "text/html" });
            res.end("<html><body><h1>Authorization failed</h1></body></html>");
            finish();
            reject(new Error(`OAuth callback missing code. State: ${returnedState}`));
            return;
          }

          if (returnedState !== expectedState) {
            res.writeHead(403, { "Content-Type": "text/html" });
            res.end("<html><body><h1>State mismatch — possible CSRF attack</h1></body></html>");
            finish();
            reject(new Error("OAuth state mismatch: possible CSRF attack"));
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body style=\"font-family:sans-serif\"><h1>Authorization successful!</h1><p>You can close this tab and go back to Claude.</p></body></html>"
          );
          finish();
          resolve({ code, redirectUri, codeVerifier });
        }
      );

      server.on("error", (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout);
        reject(
          err.code === "EADDRINUSE"
            ? new Error(`Port ${port} is in use. Set ETSY_CALLBACK_PORT to a free port and register that callback URL on your Etsy app.`)
            : err
        );
      });

      // Loopback only: the callback comes from the browser on this machine, and
      // binding to 127.0.0.1 avoids the Windows Firewall prompt.
      server.listen(port, "127.0.0.1", async () => {
        const authData = await this.buildAuthorizationUrl(redirectUri);
        codeVerifier = authData.codeVerifier;
        expectedState = authData.state;

        console.error(`\nOpen this URL to authorize:\n${authData.url}\n`);
        try {
          const { default: open } = await import("open");
          await open(authData.url);
        } catch (err) {
          // Not fatal: the URL is logged above and the listener keeps waiting.
          console.error("Could not open a browser automatically:", err);
        }
      });

      const timeout = setTimeout(() => {
        server.close();
        reject(new Error("Sign-in timed out after 5 minutes"));
      }, 300_000);
    });
  }
}
