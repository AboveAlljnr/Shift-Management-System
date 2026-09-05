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

/** Role constants aligned with @sms/shared and database role codes. */
export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  OWNER: 'owner',
  COMPANY_ADMIN: 'company_admin',
  ADMIN: 'admin',
  MANAGER: 'manager',
  DEPARTMENT_MANAGER: 'department_manager',
  HR_ADMIN: 'hr_admin',
  SHIFT_MANAGER: 'shift_manager',
  SUPERVISOR: 'supervisor',
  EMPLOYEE: 'employee',
} as const;

export type PersonaRole = 'OWNER' | 'MANAGER' | 'SUPERVISOR' | 'EMPLOYEE';

export interface PersonaInfo {
  role: PersonaRole;
  title: string;
  badgeLabel: string;
  tagline: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
  accentHex: string;
  iconName: string;
  description: string;
}

/** Display labels for UI role chips. */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  owner: 'Owner',
  company_admin: 'Company Admin',
  admin: 'Admin',
  manager: 'Manager',
  department_manager: 'Dept Manager',
  hr_admin: 'HR Admin',
  shift_manager: 'Supervisor',
  supervisor: 'Supervisor',
  employee: 'Employee',
};

/** Human-readable role label for a raw role code (unknown roles fall back to the code). */
export function roleLabel(role: string): string {
  const code = role.toLowerCase().trim();
  return ROLE_LABELS[code] ?? role;
}

/** Role aliases mapping to canonical groups. */
const ROLE_ALIASES: Record<string, string[]> = {
  owner: ['owner', 'company_admin', 'super_admin'],
  company_admin: ['owner', 'company_admin', 'super_admin'],
  admin: ['owner', 'company_admin', 'admin', 'super_admin'],
  manager: ['manager', 'department_manager', 'hr_admin', 'admin', 'owner', 'company_admin', 'super_admin'],
  shift_manager: ['shift_manager', 'supervisor', 'team_lead', 'manager', 'admin', 'owner', 'company_admin'],
  supervisor: ['shift_manager', 'supervisor', 'team_lead', 'manager', 'admin', 'owner', 'company_admin'],
  employee: ['employee', 'worker', 'staff'],
};

/** True when the current user holds at least one of the given roles. */
export function hasRole(user: AuthUser | null, roles: string[]): boolean {
  if (!user || !user.roles || user.roles.length === 0) return false;
  const owned = new Set(user.roles.map((r) => r.toLowerCase().trim()));

  for (const r of roles) {
    const target = r.toLowerCase().trim();
    if (owned.has(target)) return true;
    // Check aliases
    const aliases = ROLE_ALIASES[target] ?? [];
    if (aliases.some((a) => owned.has(a))) return true;
  }
  return false;
}

/** Determine the highest-privilege persona for the given user. */
export function getPrimaryRole(user: AuthUser | null): PersonaRole {
  if (!user || !user.roles || user.roles.length === 0) return 'EMPLOYEE';
  const owned = new Set(user.roles.map((r) => r.toLowerCase().trim()));

  // 1. Owner / Super Admin / Company Admin
  if (['owner', 'company_admin', 'super_admin', 'admin'].some((r) => owned.has(r))) {
    return 'OWNER';
  }
  // 2. Operations Manager / Dept Manager / HR Admin
  if (['manager', 'department_manager', 'hr_admin'].some((r) => owned.has(r))) {
    return 'MANAGER';
  }
  // 3. Shift Supervisor / Floor Lead
  if (['shift_manager', 'supervisor', 'team_lead'].some((r) => owned.has(r))) {
    return 'SUPERVISOR';
  }
  // 4. Default to Employee
  return 'EMPLOYEE';
}

export function isOwner(user: AuthUser | null): boolean {
  return getPrimaryRole(user) === 'OWNER';
}

export function isManager(user: AuthUser | null): boolean {
  const primary = getPrimaryRole(user);
  return primary === 'OWNER' || primary === 'MANAGER';
}

export function isSupervisor(user: AuthUser | null): boolean {
  const primary = getPrimaryRole(user);
  return primary === 'OWNER' || primary === 'MANAGER' || primary === 'SUPERVISOR';
}

export function isEmployeeOnly(user: AuthUser | null): boolean {
  return getPrimaryRole(user) === 'EMPLOYEE';
}

/** Get rich persona presentation info for UI badges, sidebars, and dashboards. */
export function getPersonaInfo(user: AuthUser | null): PersonaInfo {
  const role = getPrimaryRole(user);

  switch (role) {
    case 'OWNER':
      return {
        role: 'OWNER',
        title: 'Executive Owner',
        badgeLabel: 'OWNER / ADMIN',
        tagline: 'Company Governance & Executive Control',
        badgeBg: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
        badgeText: 'text-purple-300',
        badgeBorder: 'border-purple-500/30',
        accentHex: '#7C3AED',
        iconName: 'Building2',
        description: 'Full governance over organization hierarchy, workforce, system settings, billing, and compliance.',
      };
    case 'MANAGER':
      return {
        role: 'MANAGER',
        title: 'Operations Manager',
        badgeLabel: 'MANAGER',
        tagline: 'Schedule Optimization & Team Approvals',
        badgeBg: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
        badgeText: 'text-blue-300',
        badgeBorder: 'border-blue-500/30',
        accentHex: '#2563EB',
        iconName: 'BarChart3',
        description: 'Responsible for AI shift scheduling, leave approvals, availability management, and timesheets.',
      };
    case 'SUPERVISOR':
      return {
        role: 'SUPERVISOR',
        title: 'Shift Supervisor',
        badgeLabel: 'SUPERVISOR',
        tagline: 'Live Floor Execution & Presence Radar',
        badgeBg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        badgeText: 'text-emerald-300',
        badgeBorder: 'border-emerald-500/30',
        accentHex: '#059669',
        iconName: 'Shield',
        description: 'Monitors real-time shift check-ins, geofence verifications, on-duty headcount, and floor overrides.',
      };
    case 'EMPLOYEE':
    default:
      return {
        role: 'EMPLOYEE',
        title: 'Team Member',
        badgeLabel: 'EMPLOYEE',
        tagline: 'Personal Shifts & Self-Service Portal',
        badgeBg: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
        badgeText: 'text-sky-300',
        badgeBorder: 'border-sky-500/30',
        accentHex: '#0284C7',
        iconName: 'User',
        description: 'View assigned shifts, clock in/out with geofencing, submit availability, and request time off.',
      };
  }
}