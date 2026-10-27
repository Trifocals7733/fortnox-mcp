import { Duration, Effect, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpIncomingMessage } from "effect/http";
import { getCurrentUserId } from "../auth/context.js";
import {
  FORTNOX_API_BASE_URL,
  MAX_FETCH_ALL_RESULTS,
  MAX_FETCH_ALL_PAGES,
  FETCH_ALL_PAGE_SIZE,
  FETCH_ALL_DELAY_MS
} from "../constants.js";
import { RateLimiter } from "./rateLimiter.js";
import { getRuntime } from "./runtime.js";
import { accessToken, CurrentUser } from "./tokenProvider.js";

type Method = "GET" | "POST" | "PUT" | "DELETE";

/** A Fortnox failure with the same wording the tools have always surfaced. */
export class FortnoxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "FortnoxError";
  }
}

function messageForStatus(
  status: number | undefined,
  fortnoxMessage: string | undefined,
  prefix: string
): { message: string; retryable: boolean } {
  switch (status) {
    case 400:
      return {
        message:
          `${prefix}Bad request: ${fortnoxMessage || "Invalid parameters"}. ` +
          `Check that all required fields are provided and values are valid.`,
        retryable: false
      };
    case 401:
      return {
        message: `${prefix}Authentication failed. The access token may be expired or invalid. Try refreshing authentication.`,
        retryable: false
      };
    case 403:
      return {
        message: `${prefix}Permission denied. Your API credentials don't have access to this resource. Check your Fortnox app scopes.`,
        retryable: false
      };
    case 404:
      return {
        message: `${prefix}Resource not found. The requested item does not exist or has been deleted.`,
        retryable: false
      };
    case 429:
      return {
        message: `${prefix}Rate limit exceeded. Fortnox allows 25 requests per 5 seconds. Please wait before retrying.`,
        retryable: true
      };
    case 500:
    case 502:
    case 503:
      return {
        message: `${prefix}Fortnox server error (${status}). The service may be temporarily unavailable. Please try again later.`,
        retryable: true
      };
    default:
      return {
        message: `${prefix}API error ${status}: ${fortnoxMessage ?? "no message"}`,
        retryable: false
      };
  }
}

function describe(error: unknown, context?: string): Error {
  const prefix = context ? `[${context}] ` : "";

  if (error instanceof FortnoxError) return error;

  if (error instanceof Error) {
    if (error.message.includes("ECONNABORTED") || error.message.includes("timeout")) {
      return new FortnoxError(
        `${prefix}Request timed out. The Fortnox API is not responding. Please try again.`
      );
    }
    if (error.message.includes("ENOTFOUND") || error.message.includes("ECONNREFUSED")) {
      return new FortnoxError(
        `${prefix}Cannot connect to Fortnox API. Check your internet connection.`
      );
    }
    return new FortnoxError(`${prefix}${error.message}`);
  }

  return new FortnoxError(`${prefix}Unexpected error: ${String(error)}`);
}

/** Public for callers that wrap their own errors in tool handlers. */
export function handleApiError(error: unknown, context?: string): Error {
  return describe(error, context);
}

function buildUrl(
  endpoint: string,
  params?: Record<string, string | number | boolean | undefined>
): string {
  const url = new URL(`${FORTNOX_API_BASE_URL}${endpoint}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function buildRequest(url: string, method: Method, data?: unknown): HttpClientRequest.HttpClientRequest {
  const base =
    method === "GET"
      ? HttpClientRequest.get(url)
      : method === "POST"
        ? HttpClientRequest.post(url)
        : method === "PUT"
          ? HttpClientRequest.put(url)
          : HttpClientRequest.make("DELETE")(url);

  return data === undefined
    ? base
    : HttpClientRequest.bodyJsonUnsafe(base, data);
}

/**
 * Make an authenticated request to the Fortnox API.
 *
 * Runs inside the app runtime: the rate limiter gate and the HTTP client are
 * shared process-wide, and the access token comes from the token provider for
 * the current request's user.
 */
export async function fortnoxRequest<T>(
  endpoint: string,
  method: Method = "GET",
  data?: unknown,
  params?: Record<string, string | number | boolean | undefined>
): Promise<T> {
  const userId = getCurrentUserId();
  const url = buildUrl(endpoint, params);

  const program = Effect.gen(function* () {
    const limiter = yield* RateLimiter;
    yield* limiter.acquire;

    const token = yield* accessToken;
    const request = buildRequest(url, method, data).pipe(
      HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
      HttpClientRequest.setHeader("Accept", "application/json")
    );

    const response = yield* HttpClient.execute(request);
    const body =
      response.status === 204
        ? undefined
        : yield* HttpIncomingMessage.schemaBodyJson(Schema.Unknown)(response);

    if (response.status >= 400) {
      const fortnoxMessage =
        (body as any)?.ErrorInformation?.message ??
        (body as any)?.ErrorInformation?.Message ??
        (body as any)?.message ??
        (body as any)?.error;
      const { message, retryable } = messageForStatus(
        response.status,
        fortnoxMessage,
        `[${endpoint}] `
      );
      return yield* Effect.fail(new FortnoxError(message, response.status, retryable));
    }

    return body as T;
  }).pipe(
    Effect.timeout("30 seconds"),
    Effect.mapError((error) => describe(error, endpoint) as FortnoxError),
    Effect.retry({
      schedule: Schedule.exponential(Duration.millis(250)),
      times: 3,
      while: (error: FortnoxError) => error.retryable
    })
  );

  return getRuntime().runPromise(program.pipe(Effect.provideService(CurrentUser, { userId })));
}

/**
 * Format a date for Fortnox API (YYYY-MM-DD)
 */
export function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * Parse a Fortnox date string to Date object
 */
export function parseDate(dateStr: string): Date {
  return new Date(dateStr);
}

/**
 * Configuration for fetchAllPages
 */
export interface FetchAllConfig {
  /** Maximum total results to fetch (default: MAX_FETCH_ALL_RESULTS) */
  maxResults?: number;
  /** Maximum pages to fetch (default: MAX_FETCH_ALL_PAGES) */
  maxPages?: number;
  /** Page size for each request (default: FETCH_ALL_PAGE_SIZE) */
  pageSize?: number;
  /** Delay between page requests in ms (default: FETCH_ALL_DELAY_MS) */
  delayBetweenPages?: number;
}

/**
 * Result from fetchAllPages
 */
export interface FetchAllResult<T> {
  /** All items fetched */
  items: T[];
  /** Total count from API (may be higher than items.length if truncated) */
  total: number;
  /** Number of pages fetched */
  pagesFetched: number;
  /** Whether results were truncated due to limits */
  truncated: boolean;
  /** Reason for truncation if truncated is true */
  truncationReason?: string;
}

/**
 * Delay execution for specified milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch all pages of a paginated Fortnox API endpoint
 *
 * It includes safety limits to prevent runaway queries and respects rate limits.
 *
 * @param endpoint - API endpoint (e.g., "/3/invoices")
 * @param params - Query parameters to pass to each request
 * @param extractItems - Function to extract items array from response
 * @param extractTotal - Function to extract total count from response
 * @param config - Optional configuration for limits and delays
 * @returns All items fetched with metadata about the fetch operation
 */
export async function fetchAllPages<T, R>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  extractItems: (response: R) => T[],
  extractTotal: (response: R) => number,
  config?: FetchAllConfig
): Promise<FetchAllResult<T>> {
  const maxResults = config?.maxResults ?? MAX_FETCH_ALL_RESULTS;
  const maxPages = config?.maxPages ?? MAX_FETCH_ALL_PAGES;
  const pageSize = config?.pageSize ?? FETCH_ALL_PAGE_SIZE;
  const delayMs = config?.delayBetweenPages ?? FETCH_ALL_DELAY_MS;

  const allItems: T[] = [];
  let page = 1;
  let total = 0;
  let hasMore = true;
  let truncated = false;
  let truncationReason: string | undefined;

  while (hasMore) {
    // Check page limit
    if (page > maxPages) {
      truncated = true;
      truncationReason = `Reached maximum page limit (${maxPages} pages). Use filters to narrow results.`;
      break;
    }

    // Check result limit
    if (allItems.length >= maxResults) {
      truncated = true;
      truncationReason = `Reached maximum result limit (${maxResults} items). Use filters to narrow results.`;
      break;
    }

    // Make request
    const response = await fortnoxRequest<R>(endpoint, "GET", undefined, {
      ...params,
      limit: pageSize,
      page
    });

    const items = extractItems(response);
    total = extractTotal(response);

    if (items.length === 0) {
      hasMore = false;
    } else {
      allItems.push(...items);

      // Check if we've fetched all available items
      if (allItems.length >= total) {
        hasMore = false;
      } else {
        page++;
        // Delay to respect rate limits (except on last page)
        if (hasMore) {
          await delay(delayMs);
        }
      }
    }
  }

  return {
    items: allItems,
    total,
    pagesFetched: page,
    truncated,
    truncationReason
  };
}
