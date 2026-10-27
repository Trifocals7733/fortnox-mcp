export interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
}

/**
 * Local mode has exactly one user: the token in FORTNOX_REFRESH_TOKEN (and its
 * rotated copy in ~/.fortnox-mcp/tokens.json).
 */
export interface ITokenProvider {
  getAccessToken(): Promise<string>;
  isAuthenticated(): boolean;
  getTokenInfo(): TokenInfo | null;
}

export class AuthRequiredError extends Error {
  constructor() {
    super("Authentication required. Set FORTNOX_REFRESH_TOKEN environment variable.");
    this.name = "AuthRequiredError";
  }
}
