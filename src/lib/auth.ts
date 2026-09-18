const SESSION_COOKIE = "ecom_pricing_session";
const SESSION_STORAGE_KEY = "ecom_pricing_session";
const SESSION_VALUE = "1";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7;

export const LOGIN_ID = "admin@ecompricing.local";
export const LOGIN_PASSWORD = "admin@123";

export function validateCredentials(id: string, password: string): boolean {
  return id.trim() === LOGIN_ID && password === LOGIN_PASSWORD;
}

function readCookie(): string | null {
  if (typeof document === "undefined") return null;
  const prefix = `${SESSION_COOKIE}=`;
  const match = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  return readStorage() === SESSION_VALUE || readCookie() === SESSION_VALUE;
}

export function login(id: string, password: string): boolean {
  if (!validateCredentials(id, password)) return false;
  try {
    window.localStorage.setItem(SESSION_STORAGE_KEY, SESSION_VALUE);
  } catch {
    /* ignore quota / private mode */
  }
  document.cookie = `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; Max-Age=${SESSION_MAX_AGE_SEC}; SameSite=Lax`;
  return true;
}

export function logout(): void {
  try {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") {
    document.cookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
  }
}
