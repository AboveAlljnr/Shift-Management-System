import type { AuthTokens, UUID } from '@sms/shared';

export const ACCESS_TOKEN_KEY = 'accessToken';
export const REFRESH_TOKEN_KEY = 'refreshToken';

export interface AuthUser {
  sub: UUID;
  email: string;
  companyId: UUID;
  membershipId: UUID;
  roles: string[];
  exp?: number;
}

function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  return decodeURIComponent(
    atob(padded)
      .split('')
      .map((c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
      .join(''),
  );
}

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(ACCESS_TOKEN_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

/** Decode the JWT payload (no signature verification — display purposes only). */
export function getAuthUser(token: string | null = getAccessToken()): AuthUser | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(decodeBase64Url(parts[1] as string)) as AuthUser;
  } catch {
    return null;
  }
}

export function isAuthenticated(): boolean {
  const user = getAuthUser();
  if (!user) return false;
  return !user.exp || user.exp * 1000 > Date.now();
}

/** Persist tokens to localStorage and mirror the access token to the cookie used by middleware. */
export function setAuthTokens(tokens: AuthTokens): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  document.cookie = `${ACCESS_TOKEN_KEY}=${tokens.accessToken}; path=/; SameSite=Lax`;
}

export function clearAuth(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  document.cookie = `${ACCESS_TOKEN_KEY}=; path=/; Max-Age=0`;
}

/** True when the current user holds at least one of the given roles. */
export function hasRole(user: AuthUser | null, roles: string[]): boolean {
  if (!user) return false;
  const owned = new Set(user.roles.map((r) => r.toLowerCase()));
  return roles.some((r) => owned.has(r));
}

/** Role constants aligned with @sms/shared USER_ROLES. */
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  SHIFT_MANAGER: 'shift_manager',
  EMPLOYEE: 'employee',
} as const;