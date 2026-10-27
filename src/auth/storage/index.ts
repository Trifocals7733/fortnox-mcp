export { getMemoryStorage, MemoryTokenStorage } from "./memory.js";
export { getUpstashRedisStorage, UpstashRedisTokenStorage } from "./redis.js";
export * from "./types.js";

import { MemoryTokenStorage } from "./memory.js";
import { UpstashRedisTokenStorage } from "./redis.js";
import type { ITokenStorage } from "./types.js";

export type StorageType = "memory" | "upstash-redis";

export function createTokenStorage(type: StorageType): ITokenStorage {
  switch (type) {
    case "upstash-redis":
      return new UpstashRedisTokenStorage();
    default:
      return new MemoryTokenStorage();
  }
}

export function getStorageFromEnv(): ITokenStorage {
  const storageType = process.env.TOKEN_STORAGE as StorageType | undefined;

  // Default to upstash-redis in production, memory in development
  if (storageType) {
    return createTokenStorage(storageType);
  }

  // Auto-detect based on environment
  if (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL) {
    return new UpstashRedisTokenStorage();
  }

  console.error("[Storage] Warning: Using in-memory storage. Tokens will be lost on restart.");
  return new MemoryTokenStorage();
}
