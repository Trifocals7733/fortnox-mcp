import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { getRuntime } from "./runtime.js";

/**
 * Failure from Fortnox's OAuth token endpoint. Carries the status and decoded
 * body so callers can turn 400/401 into the "re-authorize" guidance users need.
 */
export class TokenRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "TokenRequestError";
  }
}

/**
 * POST an x-www-form-urlencoded token request (authorization_code or
 * refresh_token grant) to Fortnox's OAuth endpoint.
 */
export async function postTokenRequest<T>(
  tokenUrl: string,
  form: Record<string, string>,
  basicAuth: string
): Promise<T> {
  const program = Effect.gen(function* () {
    const request = HttpClientRequest.post(tokenUrl).pipe(
      HttpClientRequest.setHeader("Authorization", `Basic ${basicAuth}`),
      HttpClientRequest.setHeader("Content-Type", "application/x-www-form-urlencoded"),
      HttpClientRequest.setHeader("Accept", "application/json"),
      HttpClientRequest.bodyUrlParams(form)
    );

    const response = yield* HttpClient.execute(request);
    const body =
      response.status === 204
        ? undefined
        : yield* HttpIncomingMessage.schemaBodyJson(Schema.Unknown)(response);

    if (response.status >= 400) {
      return yield* Effect.fail(
        new TokenRequestError(`Token endpoint returned ${response.status}`, response.status, body)
      );
    }

    return body as T;
  }).pipe(Effect.timeout("30 seconds"));

  return getRuntime().runPromise(program);
}
