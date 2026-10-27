import { Context, Effect, Layer } from "effect";
import { getTokenProvider } from "../auth/index.js";

/**
 * The requesting Fortnox user. Empty in local mode (single-user env token);
 * set per request in remote mode from the authenticated MCP session.
 */
export interface CurrentUser {
  readonly userId?: string | undefined;
}

export const CurrentUser = Context.Service<CurrentUser>("fortnox/CurrentUser");

/**
 * Access-token lookup, backed by whichever ITokenProvider the process is in
 * (env-var in local mode, per-user storage in remote mode).
 */
export interface TokenProviderService {
  readonly accessToken: (userId?: string) => Effect.Effect<string, Error>;
}

export const TokenProviderService = Context.Service<TokenProviderService>(
  "fortnox/TokenProvider"
);

export const tokenProviderLayer: Layer.Layer<TokenProviderService> = Layer.succeed(
  TokenProviderService,
  {
    accessToken: (userId?: string) =>
      Effect.tryPromise({
        try: () => getTokenProvider().getAccessToken(userId),
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
  }
);

/** Resolve the access token for the current request's user. */
export const accessToken: Effect.Effect<string, Error, TokenProviderService | CurrentUser> =
  Effect.gen(function* () {
    const { userId } = yield* CurrentUser;
    const provider = yield* TokenProviderService;
    return yield* provider.accessToken(userId);
  });
