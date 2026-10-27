import { Context, Effect, Layer } from "effect";
import { getTokenProvider } from "../auth/index.js";

/**
 * Access-token lookup. One Fortnox user per process: the token comes from
 * FORTNOX_REFRESH_TOKEN and is rotated into ~/.fortnox-mcp/tokens.json.
 */
export interface TokenProviderService {
  readonly accessToken: () => Effect.Effect<string, Error>;
}

export const TokenProviderService = Context.Service<TokenProviderService>("fortnox/TokenProvider");

export const tokenProviderLayer: Layer.Layer<TokenProviderService> = Layer.succeed(
  TokenProviderService,
  {
    accessToken: () =>
      Effect.tryPromise({
        try: () => getTokenProvider().getAccessToken(),
        catch: (error) => (error instanceof Error ? error : new Error(String(error)))
      })
  }
);

export const accessToken: Effect.Effect<string, Error, TokenProviderService> = Effect.gen(
  function* () {
    const provider = yield* TokenProviderService;
    return yield* provider.accessToken();
  }
);
