const configuredApi: string = import.meta.env.PUBLIC_API_BASE_URL || 'http://127.0.0.1:8787';
export const API_BASE_URL = configuredApi.replace(/\/+$/, '');
export const BASE_PATH = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
export const STORAGE_NAMESPACE = `little-by-little:${API_BASE_URL}:${BASE_PATH}`;
const sessionKey = `${STORAGE_NAMESPACE}:session`;
export const SESSION_EXPIRED_EVENT = 'little-by-little:session-expired';

// eslint-disable-next-line functional/functional-parameters -- Read the ambient browser session from localStorage.
export function getSession(): string | null {
  // eslint-disable-next-line functional/no-try-statements -- Unavailable browser storage means this device has no readable session.
  try { return localStorage.getItem(sessionKey); } catch { return null; }
}
export function saveSession(token: string) { localStorage.setItem(sessionKey, token); }
// eslint-disable-next-line functional/functional-parameters -- Sign-out clears the ambient browser session.
export function clearSession() {
  // eslint-disable-next-line functional/no-try-statements -- Browser storage may be unavailable during sign-out.
  try { localStorage.removeItem(sessionKey); } catch { /* Already unavailable. */ }
}
export function sessionStorageKey(value: string) { return `${STORAGE_NAMESPACE}:${value}`; }

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'ApiError'; }
}
export async function api<T = { ok: boolean }>(path: string, method = 'GET', data?: unknown, token: string | null = getSession()): Promise<T> {
  const headers: Readonly<Record<string, string>> = {
    Accept: 'application/json',
    ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: data === undefined ? undefined : JSON.stringify(data), credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch { throw new ApiError('Unable to reach the service. Please try again.', 0); }
  let result: T & { error?: string };
  try { result = await response.json() as T & { error?: string }; }
  catch { throw new ApiError('The service returned an unexpected response. Please try again.', response.status); }
  if (!response.ok) {
    if (response.status === 401 && token && token === getSession()) {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(result.error || 'Unable to complete this request. Please try again.', response.status);
  }
  return result;
}
