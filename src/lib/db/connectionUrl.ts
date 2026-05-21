import type { DbDriver } from "./DbClient";

export interface StructuredConnectionAuth {
  username: string;
  password: string;
}

export function supportsStructuredAuth(driver: DbDriver): boolean {
  return driver !== "sqlite" && driver !== "p_i_historian" && driver !== "rest_api";
}

export function readStructuredAuthFromConnectionString(
  connectionString: string,
): StructuredConnectionAuth | null {
  try {
    const url = new URL(connectionString);
    return {
      username: decodeURIComponent(url.username ?? ""),
      password: decodeURIComponent(url.password ?? ""),
    };
  } catch {
    return null;
  }
}

export function applyStructuredAuthToConnectionString(
  connectionString: string,
  auth: StructuredConnectionAuth,
): string {
  try {
    const url = new URL(connectionString);
    url.username = auth.username ? encodeURIComponent(auth.username) : "";
    url.password = auth.password ? encodeURIComponent(auth.password) : "";
    return url.toString();
  } catch {
    return connectionString;
  }
}

export function stripPasswordFromConnectionString(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    url.password = "";
    return url.toString();
  } catch {
    return connectionString;
  }
}
