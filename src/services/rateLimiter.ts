import { Context, Duration, Effect, Layer, Ref } from "effect";
import { RATE_LIMIT_REQUESTS, RATE_LIMIT_WINDOW_MS } from "../constants.js";

/**
 * Fortnox allows 25 requests per 5 seconds. Effect 4 has no `RateLimiter`
 * module (v3 did), so this is a hand-built sliding-window gate.
 *
 * It lives in the app runtime, i.e. one per process — the limiter cannot
 * coordinate across processes.
 */
export interface RateLimiter {
  readonly acquire: Effect.Effect<void>;
}

export const RateLimiter = Context.Service<RateLimiter>("fortnox/RateLimiter");

export const rateLimiterLayer = (
  limit: number = RATE_LIMIT_REQUESTS,
  windowMs: number = RATE_LIMIT_WINDOW_MS
) =>
  Layer.effect(
    RateLimiter,
    Effect.gen(function* () {
      const timestamps = yield* Ref.make<number[]>([]);

      const acquire: Effect.Effect<void> = Effect.suspend(() =>
        Effect.gen(function* () {
          const now = Date.now();
          const waitMs = yield* Ref.modify(timestamps, (recent): readonly [number, number[]] => {
            const inWindow = recent.filter((ts) => now - ts < windowMs);
            if (inWindow.length >= limit) {
              // +50ms buffer, as the previous axios limiter had
              return [windowMs - (now - inWindow[0]) + 50, inWindow];
            }
            return [0, [...inWindow, now]];
          });

          if (waitMs > 0) {
            yield* Effect.sleep(Duration.millis(waitMs));
            return yield* acquire;
          }
        })
      );

      return { acquire };
    })
  );
