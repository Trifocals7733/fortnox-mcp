export * from "./credentials.js";
export { EnvVarTokenProvider } from "./envVarProvider.js";
export * from "./types.js";

import { EnvVarTokenProvider } from "./envVarProvider.js";
import type { ITokenProvider } from "./types.js";

// Global token provider instance
let tokenProvider: ITokenProvider | null = null;

export function initializeTokenProvider(provider: ITokenProvider): void {
  tokenProvider = provider;
}

export function getTokenProvider(): ITokenProvider {
  if (!tokenProvider) {
    tokenProvider = new EnvVarTokenProvider();
  }
  return tokenProvider;
}
