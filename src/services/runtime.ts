import { Layer, ManagedRuntime } from "effect";
import { FetchHttpClient } from "effect/http";
import { RateLimiter, rateLimiterLayer } from "./rateLimiter.js";
import { TokenProviderService, tokenProviderLayer } from "./tokenProvider.js";

/**
 * The whole app's dependency graph, built once and reused for the life of the
 * process. Tool handlers still run inside a fresh Effect per call (they are
 * plain async functions until the domain conversion), but the services they
 * need - the rate limiter's window state and the HTTP client - are shared.
 */
const AppLayer = Layer.mergeAll(rateLimiterLayer(), tokenProviderLayer, FetchHttpClient.layer);

// The layer graph has no requirements of its own; the cast satisfies the
// build-time signature that cannot see that through mergeAll.
const makeRuntime = () =>
  ManagedRuntime.make(AppLayer as unknown as Parameters<typeof ManagedRuntime.make>[0]);
type AppRuntime = ReturnType<typeof makeRuntime>;

let runtime: AppRuntime | null = null;

export function getRuntime(): AppRuntime {
  if (!runtime) {
    runtime = makeRuntime();
  }
  return runtime;
}

/** Release the runtime (process shutdown, or between tests). */
export async function closeRuntime(): Promise<void> {
  if (runtime) {
    await runtime.dispose();
    runtime = null;
  }
}

export { RateLimiter, TokenProviderService };
