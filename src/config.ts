export type TransportMode = "stdio" | "http";

export interface ServerConfig {
  transport: TransportMode;
  port: number;
}

export function loadConfig(): ServerConfig {
  return {
    transport: (process.env.TRANSPORT as TransportMode) || "stdio",
    port: parseInt(process.env.PORT || "3000", 10)
  };
}
